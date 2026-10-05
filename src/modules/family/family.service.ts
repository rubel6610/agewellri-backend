import crypto from "crypto";
import path from "path";
import fs from "fs";
import { UserRole, UserStatus, InvitationStatus, NotificationType } from "@prisma/client";
import prisma from "../../lib/prisma";
const db = prisma as any;
import { hashPassword } from "../../utils/password";
import { generateAuthTokens } from "../../utils/jwt";
import {
  sendFamilyMemberInvitationEmail,
  sendFamilyMemberCredentialsEmail,
  sendReportToFamilyRecipientEmail,
} from "../../utils/email";
import { deleteUploadedFile } from "../../utils/fileStorage";
import {
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
  AcceptFamilyInviteInput,
  SendReportToFamilyInput,
  SendCredentialsInput,
} from "./family.validation";
import { createNotification } from "../notification/notification.service";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export interface UserClientContext {
  client: any;
  isPrimary: boolean;
  familyMember?: any;
  permissions: {
    reportAccess: boolean;
    portalAccess: boolean;
    billingAccess: boolean;
  };
}

/**
 * Resolves whether a logged-in user is a Primary Client or an Authorized Family Member.
 */
export async function resolveClientForUser(userId: string): Promise<UserClientContext | null> {
  // 1. Check if user is Primary Client
  const primaryClient = await db.client.findFirst({
    where: {
      OR: [{ userId }, { id: userId }],
    },
    include: {
      user: true,
    },
  });

  if (primaryClient) {
    return {
      client: primaryClient,
      isPrimary: true,
      permissions: {
        reportAccess: true,
        portalAccess: true,
        billingAccess: true,
      },
    };
  }

  // 2. Check if user is an Authorized Family Member with active portal access
  const familyMember = await db.familyMember.findFirst({
    where: {
      userId,
      invitationStatus: InvitationStatus.ACCEPTED,
      portalAccess: true,
    },
    include: {
      client: {
        include: {
          user: true,
        },
      },
    },
  });

  if (familyMember && familyMember.client) {
    return {
      client: familyMember.client,
      isPrimary: false,
      familyMember,
      permissions: {
        reportAccess: familyMember.reportAccess,
        portalAccess: familyMember.portalAccess,
        billingAccess: familyMember.billingAccess,
      },
    };
  }

  return null;
}

/**
 * Get all Family Members for the active client.
 * Auto-syncs from onboardingData and client profile (emergency contacts, coordinators, and authorized recipients).
 */
export async function getFamilyMembers(userId: string) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  const clientId = context.client.id;
  const client = context.client;

  let familyMembers = await db.familyMember.findMany({
    where: { clientId },
    orderBy: { createdAt: "asc" },
  });

  const clientUserFullName = `${client.user?.firstName || ""} ${client.user?.lastName || ""}`.trim().toLowerCase();
  const clientUserEmail = (client.user?.email || "").trim().toLowerCase();

  const existingEmails = new Set(familyMembers.map((m: any) => m.email.toLowerCase()));
  const existingNames = new Set(familyMembers.map((m: any) => m.name.toLowerCase()));

  // 1. Auto-sync Emergency Contact / Family Coordinator from Client Profile ONLY if different from the primary client
  if (client.emergencyContactName && client.emergencyContactName.trim()) {
    const emName = client.emergencyContactName.trim();
    const emEmail = (client.emergencyContactEmail?.trim() || "").toLowerCase() || `${emName.toLowerCase().replace(/[^a-z0-9]/g, ".")}@family.contact`;
    
    // Do not sync if the emergency contact is the primary client himself
    const isOwnerContact =
      emName.toLowerCase() === clientUserFullName ||
      emEmail === clientUserEmail;

    if (!isOwnerContact && !existingNames.has(emName.toLowerCase()) && !existingEmails.has(emEmail)) {
      try {
        const createdEm = await db.familyMember.create({
          data: {
            clientId,
            name: emName,
            relationship: client.emergencyContactRelation?.trim() || "Emergency Contact & Coordinator",
            email: emEmail,
            phone: client.emergencyContactPhone?.trim() || null,
            reportAccess: true,
            portalAccess: false,
            billingAccess: false,
            isEmergencyContact: true,
            invitationStatus: InvitationStatus.PENDING,
          },
        });
        familyMembers.push(createdEm);
        existingEmails.add(emEmail);
        existingNames.add(emName.toLowerCase());
      } catch (err) {
        console.warn("⚠️ Emergency contact auto-sync notice:", err);
      }
    }
  }

  // 2. Auto-sync Representative from Signing Data (Track B) if present and distinct from client
  const onboarding = (client.onboardingData as any) || {};
  const signingData = onboarding.signingData || {};
  const repName = (signingData.repFullName || onboarding.repFullName || "").trim();

  if (repName) {
    if (repName.toLowerCase() !== clientUserFullName && !existingNames.has(repName.toLowerCase())) {
      const repEmail = (
        signingData.repEmail ||
        onboarding.repEmail ||
        (client.emergencyContactName?.toLowerCase() === repName.toLowerCase() ? client.emergencyContactEmail : null) ||
        `${repName.toLowerCase().replace(/[^a-z0-9]/g, ".")}@representative.contact`
      ).trim().toLowerCase();

      const repPhone =
        signingData.repPhone ||
        onboarding.repPhone ||
        (client.emergencyContactName?.toLowerCase() === repName.toLowerCase() ? client.emergencyContactPhone : null) ||
        client.user?.phone ||
        null;

      if (repEmail !== clientUserEmail && !existingEmails.has(repEmail)) {
        try {
          const createdRep = await db.familyMember.create({
            data: {
              clientId,
              name: repName,
              relationship:
                signingData.repRelationship?.trim() ||
                onboarding.repRelationship?.trim() ||
                signingData.repCapacity ||
                "Legal Representative",
              email: repEmail,
              phone: repPhone,
              legalCapacity: signingData.repCapacity || onboarding.representativeCapacity || null,
              authorityDocumentUrl:
                signingData.authorityDocumentUrl || onboarding.authorityDocumentUrl || null,
              authorityDocumentName:
                signingData.authorityDocumentName || onboarding.authorityDocumentName || null,
              reportAccess: true,
              portalAccess: false,
              billingAccess: true,
              isEmergencyContact: true,
              invitationStatus: InvitationStatus.PENDING,
            },
          });
          familyMembers.push(createdRep);
          existingEmails.add(repEmail);
          existingNames.add(repName.toLowerCase());
        } catch (err) {
          console.warn("⚠️ Representative auto-sync notice:", err);
        }
      }
    }
  }

  // 3. Auto-sync Authorized Report Recipients from Onboarding Data
  const onboardingRecipients = (client.onboardingData as any)?.authorizedRecipients;
  if (Array.isArray(onboardingRecipients) && onboardingRecipients.length > 0) {
    for (const rec of onboardingRecipients) {
      if (rec && rec.name && rec.email) {
        const cleanEmail = rec.email.trim().toLowerCase();
        const cleanName = rec.name.trim();

        if (
          cleanEmail !== clientUserEmail &&
          cleanName.toLowerCase() !== clientUserFullName &&
          !existingEmails.has(cleanEmail) &&
          !existingNames.has(cleanName.toLowerCase())
        ) {
          try {
            const createdRec = await db.familyMember.create({
              data: {
                clientId,
                name: cleanName,
                relationship: rec.relationship?.trim() || "Family Member",
                email: cleanEmail,
                phone: rec.phone?.trim() || null,
                reportAccess: true,
                portalAccess: false,
                billingAccess: false,
                isEmergencyContact: false,
                invitationStatus: InvitationStatus.PENDING,
              },
            });
            familyMembers.push(createdRec);
            existingEmails.add(cleanEmail);
            existingNames.add(cleanName.toLowerCase());
          } catch (createErr) {
            console.warn("⚠️ Authorized recipient auto-sync notice:", createErr);
          }
        }
      }
    }
  }

  // Filter out any primary client / owner record so they NEVER appear in their own representatives / family list
  const sanitizedFamilyMembers = familyMembers.filter((m: any) => {
    if (m.userId && client.userId && m.userId === client.userId) return false;
    if (m.email && m.email.toLowerCase() === clientUserEmail) return false;
    if (
      m.name &&
      m.name.trim().toLowerCase() === clientUserFullName &&
      !m.authorityDocumentUrl &&
      !m.legalCapacity
    ) {
      return false;
    }
    return true;
  });

  return {
    client: {
      id: context.client.id,
      clientNumber: context.client.clientNumber,
      clientName: `${context.client.user?.firstName || ""} ${context.client.user?.lastName || ""}`.trim(),
      emergencyContactName: context.client.emergencyContactName || null,
      emergencyContactPhone: context.client.emergencyContactPhone || null,
      emergencyContactEmail: context.client.emergencyContactEmail || null,
      emergencyContactRelation: context.client.emergencyContactRelation || null,
    },
    isPrimary: context.isPrimary,
    permissions: context.permissions,
    familyMembers: sanitizedFamilyMembers,
  };
}

/**
 * Get single Family Member by ID (verified against client ownership).
 */
export async function getFamilyMemberById(userId: string, memberId: string) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  const member = await db.familyMember.findFirst({
    where: {
      id: memberId,
      clientId: context.client.id,
    },
  });

  if (!member) {
    throw new Error("Family member not found.");
  }

  return member;
}

function generateFriendlyPassword(): string {
  return "Agewell@" + Math.floor(1000 + Math.random() * 9000);
}

/**
 * Add a new Family Member.
 */
export async function createFamilyMember(userId: string, input: CreateFamilyMemberInput) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  if (!context.isPrimary) {
    throw new Error("Only the primary account holder can add new family members.");
  }

  const email = input.email.trim().toLowerCase();
  const clientId = context.client.id;

  // Check if already exists for this client
  const existing = await db.familyMember.findFirst({
    where: {
      clientId,
      email,
    },
  });

  if (existing) {
    throw new Error(`A family member with email ${email} is already registered on your account.`);
  }

  let linkedUserId: string | null = null;
  const plainPassword = input.password?.trim() || generateFriendlyPassword();

  // If portal access is enabled or password is provided, provision the User account immediately
  if (input.portalAccess || input.password) {
    let user = await prisma.user.findUnique({ where: { email } });
    const passwordHash = await hashPassword(plainPassword);

    if (!user) {
      const nameParts = input.name.trim().split(" ");
      const firstName = nameParts[0] || "Family";
      const lastName = nameParts.slice(1).join(" ") || "Member";

      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          phone: input.phone?.trim() || null,
          role: UserRole.CLIENT,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
    }
    linkedUserId = user.id;
  }

  const isPortalActive = !!input.portalAccess;

  const member = await db.familyMember.create({
    data: {
      clientId,
      userId: linkedUserId,
      name: input.name.trim(),
      relationship: input.relationship.trim(),
      email,
      phone: input.phone?.trim() || null,
      legalCapacity: input.legalCapacity?.trim() || null,
      authorityDocumentUrl: input.authorityDocumentUrl?.trim() || null,
      authorityDocumentName: input.authorityDocumentName?.trim() || null,
      reportAccess: input.reportAccess ?? true,
      portalAccess: isPortalActive,
      billingAccess: isPortalActive ? (input.billingAccess ?? false) : false,
      isEmergencyContact: input.isEmergencyContact ?? false,
      invitationStatus: isPortalActive ? InvitationStatus.ACCEPTED : InvitationStatus.PENDING,
      acceptedAt: isPortalActive ? new Date() : null,
    },
  });

  // Sync Client emergency contact fields if representative/emergency contact created
  if (member.isEmergencyContact) {
    try {
      await db.client.update({
        where: { id: clientId },
        data: {
          emergencyContactName: member.name,
          emergencyContactPhone: member.phone || null,
          emergencyContactEmail: member.email,
          emergencyContactRelation: member.relationship,
        },
      });
    } catch (clientSyncErr) {
      console.warn("⚠️ Client emergency contact sync error on create:", clientSyncErr);
    }
  }

  // If portal credentials should be emailed
  if (isPortalActive && input.sendCredentialsNow !== false) {
    const clientName = `${context.client.user?.firstName || ""} ${context.client.user?.lastName || ""}`.trim() || "AgeWellRI Member";
    try {
      await sendFamilyMemberCredentialsEmail({
        to: email,
        familyMemberName: input.name.trim(),
        clientName,
        relationship: input.relationship.trim(),
        loginEmail: email,
        password: plainPassword,
      });
    } catch (emailErr) {
      console.warn("⚠️ Family member credentials email notice:", emailErr);
    }
  }

  // In-App Notification for Primary Account Holder
  try {
    if (context.client?.userId) {
      await createNotification({
        userId: context.client.userId,
        type: "FAMILY_MEMBER_ADDED",
        title: "Family Member Added",
        message: `${input.name.trim()} (${input.relationship.trim()}) has been added to your safety circle.`,
        metadata: {
          familyMemberId: member.id,
          clientId,
        },
      });
    }
  } catch (notifErr: any) {
    console.warn("⚠️ Failed to dispatch family member in-app notification:", notifErr.message);
  }

  // Audit Log
  try {
    await db.auditLog.create({
      data: {
        actorUserId: userId,
        action: "FAMILY_MEMBER_CREATED",
        entityType: "FamilyMember",
        entityId: member.id,
        metadata: {
          clientId,
          name: member.name,
          relationship: member.relationship,
          email: member.email,
        },
      },
    });
  } catch (err) {
    console.warn("Audit log notice:", err);
  }

  return db.familyMember.findUnique({
    where: { id: member.id },
  });
}

/**
 * Edit an existing Family Member.
 */
export async function updateFamilyMember(
  userId: string,
  memberId: string,
  input: UpdateFamilyMemberInput
) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  if (!context.isPrimary) {
    throw new Error("Only the primary account holder can modify family members.");
  }

  const member = await db.familyMember.findFirst({
    where: {
      id: memberId,
      clientId: context.client.id,
    },
  });

  if (!member) {
    throw new Error("Family member not found.");
  }

  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.relationship !== undefined) updateData.relationship = input.relationship.trim();
  if (input.email !== undefined) updateData.email = input.email.trim().toLowerCase();
  if (input.phone !== undefined) updateData.phone = input.phone ? input.phone.trim() : null;
  if (input.legalCapacity !== undefined) updateData.legalCapacity = input.legalCapacity ? input.legalCapacity.trim() : null;
  if (input.authorityDocumentUrl !== undefined) updateData.authorityDocumentUrl = input.authorityDocumentUrl ? input.authorityDocumentUrl.trim() : null;
  if (input.authorityDocumentName !== undefined) updateData.authorityDocumentName = input.authorityDocumentName ? input.authorityDocumentName.trim() : null;
  if (input.reportAccess !== undefined) updateData.reportAccess = input.reportAccess;
  if (input.isEmergencyContact !== undefined) updateData.isEmergencyContact = input.isEmergencyContact;

  if (input.portalAccess !== undefined) {
    updateData.portalAccess = input.portalAccess;
    if (!input.portalAccess) {
      updateData.billingAccess = false;
      updateData.invitationStatus = InvitationStatus.REVOKED;
    }
  }
  if (input.billingAccess !== undefined) {
    updateData.billingAccess = input.portalAccess === false ? false : input.billingAccess;
  }

  let plainPassword = input.password?.trim();

  // If password provided or portal access enabled without user account, update/link user
  if (plainPassword || (input.portalAccess && !member.userId)) {
    if (!plainPassword) {
      plainPassword = generateFriendlyPassword();
    }
    const cleanEmail = updateData.email || member.email;
    const passwordHash = await hashPassword(plainPassword);

    let user = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      const nameParts = (updateData.name || member.name).trim().split(" ");
      const firstName = nameParts[0] || "Family";
      const lastName = nameParts.slice(1).join(" ") || "Member";

      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          passwordHash,
          firstName,
          lastName,
          phone: updateData.phone || member.phone || null,
          role: UserRole.CLIENT,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });
    }

    updateData.userId = user.id;
    updateData.portalAccess = true;
    updateData.invitationStatus = InvitationStatus.ACCEPTED;
    updateData.acceptedAt = new Date();

    if (input.sendCredentialsNow) {
      const clientName = `${context.client.user?.firstName || ""} ${context.client.user?.lastName || ""}`.trim() || "AgeWellRI Member";
      try {
        await sendFamilyMemberCredentialsEmail({
          to: cleanEmail,
          familyMemberName: updateData.name || member.name,
          clientName,
          relationship: updateData.relationship || member.relationship,
          loginEmail: cleanEmail,
          password: plainPassword,
        });
      } catch (err) {
        console.warn("Credentials email warning:", err);
      }
    }
  }

  const updated = await db.familyMember.update({
    where: { id: memberId },
    data: updateData,
  });

  // Sync Client emergency contact fields if representative details changed
  if (updated.isEmergencyContact) {
    try {
      await db.client.update({
        where: { id: context.client.id },
        data: {
          emergencyContactName: updated.name,
          emergencyContactPhone: updated.phone || null,
          emergencyContactEmail: updated.email,
          emergencyContactRelation: updated.relationship,
        },
      });
    } catch (clientSyncErr) {
      console.warn("⚠️ Client emergency contact sync error:", clientSyncErr);
    }
  }

  return updated;
}

/**
 * Delete a Family Member (removes relationship without deleting global user account).
 */
export async function deleteFamilyMember(userId: string, memberId: string) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  if (!context.isPrimary) {
    throw new Error("Only the primary account holder can remove family members.");
  }

  const member = await db.familyMember.findFirst({
    where: {
      id: memberId,
      clientId: context.client.id,
    },
  });

  if (!member) {
    throw new Error("Family member not found.");
  }

  if (member.authorityDocumentUrl) {
    await deleteUploadedFile(member.authorityDocumentUrl);
  }

  await db.familyMember.delete({
    where: { id: memberId },
  });

  // Deactivate linked User account so they cannot log in to the portal
  if (member.userId) {
    try {
      const isLinkedToOtherFamily = await db.familyMember.findFirst({
        where: { userId: member.userId },
      });
      const isPrimaryClientUser = await db.client.findFirst({
        where: { userId: member.userId },
      });

      if (!isLinkedToOtherFamily && !isPrimaryClientUser) {
        await db.user.update({
          where: { id: member.userId },
          data: { status: UserStatus.INACTIVE },
        });
      }
    } catch (userErr) {
      console.warn("⚠️ User account deactivation notice:", userErr);
    }
  }

  // Remove from onboardingData if present (prevents auto-resyncing)
  try {
    const rawClient = await db.client.findUnique({
      where: { id: context.client.id },
      select: { onboardingData: true },
    });

    if (rawClient?.onboardingData && typeof rawClient.onboardingData === "object") {
      let changed = false;
      const updatedOnboarding = { ...(rawClient.onboardingData as any) };

      if (Array.isArray(updatedOnboarding.authorizedRecipients)) {
        const initialLen = updatedOnboarding.authorizedRecipients.length;
        updatedOnboarding.authorizedRecipients = updatedOnboarding.authorizedRecipients.filter(
          (rec: any) =>
            rec?.email?.trim().toLowerCase() !== member.email?.trim().toLowerCase() &&
            rec?.name?.trim().toLowerCase() !== member.name?.trim().toLowerCase()
        );
        if (updatedOnboarding.authorizedRecipients.length !== initialLen) {
          changed = true;
        }
      }

      if (
        updatedOnboarding.signingData?.repEmail?.trim().toLowerCase() ===
        member.email?.trim().toLowerCase()
      ) {
        updatedOnboarding.signingData.repEmail = null;
        updatedOnboarding.signingData.repFullName = null;
        changed = true;
      }

      if (changed) {
        await db.client.update({
          where: { id: context.client.id },
          data: { onboardingData: updatedOnboarding },
        });
      }
    }
  } catch (onboardingCleanErr) {
    console.warn("⚠️ Onboarding data clean notice:", onboardingCleanErr);
  }

  // If deleted member was the primary emergency contact, sync with remaining emergency contacts or null
  if (member.isEmergencyContact || context.client.emergencyContactEmail === member.email) {
    try {
      const remainingEmergency = await db.familyMember.findFirst({
        where: { clientId: context.client.id, isEmergencyContact: true },
        orderBy: { createdAt: "asc" },
      });
      await db.client.update({
        where: { id: context.client.id },
        data: {
          emergencyContactName: remainingEmergency?.name || null,
          emergencyContactPhone: remainingEmergency?.phone || null,
          emergencyContactEmail: remainingEmergency?.email || null,
          emergencyContactRelation: remainingEmergency?.relationship || null,
        },
      });
    } catch (syncErr) {
      console.warn("⚠️ Emergency contact clear sync error:", syncErr);
    }
  }

  // Audit Log
  try {
    await db.auditLog.create({
      data: {
        actorUserId: userId,
        action: "FAMILY_MEMBER_DELETED",
        entityType: "FamilyMember",
        entityId: memberId,
        metadata: {
          clientId: context.client.id,
          name: member.name,
          email: member.email,
        },
      },
    });
  } catch (err) {
    console.warn("Audit log notice:", err);
  }

  return { success: true, message: `${member.name} was removed from your family members list.` };
}

/**
 * Send or Reset Family Member Portal Login Credentials directly to their email.
 */
export async function inviteFamilyMember(userId: string, memberId: string, passwordInput?: string) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  if (!context.isPrimary) {
    throw new Error("Only the primary account holder can manage family credentials.");
  }

  const member = await db.familyMember.findFirst({
    where: {
      id: memberId,
      clientId: context.client.id,
    },
    include: {
      client: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!member) {
    throw new Error("Family member not found.");
  }

  const plainPassword = passwordInput?.trim() || generateFriendlyPassword();
  const passwordHash = await hashPassword(plainPassword);
  const cleanEmail = member.email.trim().toLowerCase();

  let user = await prisma.user.findUnique({ where: { email: cleanEmail } });

  if (!user) {
    const nameParts = member.name.trim().split(" ");
    const firstName = nameParts[0] || "Family";
    const lastName = nameParts.slice(1).join(" ") || "Member";

    user = await prisma.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        firstName,
        lastName,
        phone: member.phone?.trim() || null,
        role: UserRole.CLIENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: UserStatus.ACTIVE,
      },
    });
  }

  const updatedMember = await db.familyMember.update({
    where: { id: memberId },
    data: {
      userId: user.id,
      portalAccess: true,
      invitationStatus: InvitationStatus.ACCEPTED,
      acceptedAt: new Date(),
      invitedAt: new Date(),
    },
  });

  const clientName = `${member.client?.user?.firstName || ""} ${member.client?.user?.lastName || ""}`.trim() || "AgeWellRI Member";

  try {
    await sendFamilyMemberCredentialsEmail({
      to: cleanEmail,
      familyMemberName: member.name,
      clientName,
      relationship: member.relationship,
      loginEmail: cleanEmail,
      password: plainPassword,
    });
  } catch (emailErr) {
    console.warn("⚠️ Family member credentials email delivery warning:", emailErr);
  }

  return {
    member: updatedMember,
    password: plainPassword,
    message: `Login credentials successfully emailed to ${member.email}.`,
  };
}

/**
 * Resend Family Member Login Credentials.
 */
export async function resendFamilyInvite(userId: string, memberId: string, passwordInput?: string) {
  return inviteFamilyMember(userId, memberId, passwordInput);
}

/**
 * Revoke Family Member Portal Access.
 */
export async function revokeFamilyAccess(userId: string, memberId: string) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  if (!context.isPrimary) {
    throw new Error("Only the primary account holder can revoke access.");
  }

  const member = await db.familyMember.findFirst({
    where: {
      id: memberId,
      clientId: context.client.id,
    },
  });

  if (!member) {
    throw new Error("Family member not found.");
  }

  const updated = await db.familyMember.update({
    where: { id: memberId },
    data: {
      portalAccess: false,
      billingAccess: false,
      invitationStatus: InvitationStatus.REVOKED,
      invitationTokenHash: null,
    },
  });

  return {
    member: updated,
    message: `Portal access has been revoked for ${member.name}.`,
  };
}

/**
 * Verify Family Member Invitation Token (Public).
 */
export async function verifyFamilyInvite(token: string, email?: string) {
  const tokenHash = hashToken(token);
  const whereClause: any = {
    invitationTokenHash: tokenHash,
  };
  if (email && email.trim()) {
    whereClause.email = email.trim().toLowerCase();
  }

  const member = await db.familyMember.findFirst({
    where: whereClause,
    include: {
      client: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (!member) {
    throw new Error("Invalid invitation token or email address.");
  }

  if (member.invitationStatus === InvitationStatus.ACCEPTED) {
    throw new Error("This invitation has already been accepted. Please log in.");
  }

  if (member.invitationStatus === InvitationStatus.REVOKED) {
    throw new Error("This portal invitation has been revoked by the account holder.");
  }

  if (member.invitationExpiresAt && new Date() > new Date(member.invitationExpiresAt)) {
    throw new Error("This invitation link has expired. Please ask the account holder to resend the invite.");
  }

  const clientName = `${member.client?.user?.firstName || ""} ${member.client?.user?.lastName || ""}`.trim() || "AgeWellRI Member";

  return {
    valid: true,
    familyMember: {
      id: member.id,
      name: member.name,
      relationship: member.relationship,
      email: member.email,
      phone: member.phone,
      reportAccess: member.reportAccess,
      portalAccess: member.portalAccess,
      billingAccess: member.billingAccess,
    },
    clientName,
  };
}

/**
 * Accept Family Member Invitation & Activate Portal Account (Public).
 */
export async function acceptFamilyInvite(input: AcceptFamilyInviteInput) {
  const tokenHash = hashToken(input.token);
  const whereClause: any = {
    invitationTokenHash: tokenHash,
  };
  if (input.email && input.email.trim()) {
    whereClause.email = input.email.trim().toLowerCase();
  }

  const member = await db.familyMember.findFirst({
    where: whereClause,
    include: {
      client: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!member) {
    throw new Error("Invalid or expired invitation token.");
  }

  const cleanEmail = member.email.trim().toLowerCase();

  if (member.invitationExpiresAt && new Date() > new Date(member.invitationExpiresAt)) {
    throw new Error("This invitation has expired. Please request a new invitation.");
  }

  // Check if User account already exists
  let user = await prisma.user.findUnique({
    where: { email: cleanEmail },
  });

  if (!user) {
    const passwordHash = await hashPassword(input.password);
    user = await prisma.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        phone: input.phone?.trim() || member.phone || null,
        role: UserRole.CLIENT,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
  } else {
    // If existing user, update status and names if missing
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.ACTIVE,
        emailVerifiedAt: user.emailVerifiedAt || new Date(),
      },
    });
  }

  // Update FamilyMember record to link to User
  await db.familyMember.update({
    where: { id: member.id },
    data: {
      userId: user.id,
      invitationStatus: InvitationStatus.ACCEPTED,
      portalAccess: true,
      acceptedAt: new Date(),
      invitationTokenHash: null,
    },
  });

  // Generate JWT auth tokens
  const tokens = generateAuthTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const clientName = `${member.client?.user?.firstName || ""} ${member.client?.user?.lastName || ""}`.trim();

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    },
    tokens,
    clientName,
    message: `Welcome to the AgeWellRI Family Portal for ${clientName}!`,
  };
}

/**
 * Dispatch an existing Safety Report to selected family members with reportAccess = true.
 */
export async function sendReportToFamilyRecipients(
  userId: string,
  reportId: string,
  input: SendReportToFamilyInput
) {
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    throw new Error("Client account not found.");
  }

  if (!context.permissions.reportAccess) {
    throw new Error("You do not have permission to view or share reports.");
  }

  const report = await db.report.findFirst({
    where: {
      id: reportId,
      clientId: context.client.id,
    },
    include: {
      visit: {
        include: {
          technician: true,
        },
      },
    },
  });

  if (!report) {
    throw new Error("Report not found or not accessible.");
  }

  // Find authorized family members
  const authorizedMembers = await db.familyMember.findMany({
    where: {
      id: { in: input.familyMemberIds },
      clientId: context.client.id,
      reportAccess: true,
    },
  });

  if (authorizedMembers.length === 0) {
    throw new Error("No eligible authorized report recipients were found among the selections.");
  }

  const clientName = `${context.client.user?.firstName || ""} ${context.client.user?.lastName || ""}`.trim() || "AgeWellRI Resident";
  const specialistName = report.visit?.technician?.name || "AgeWellRI Safety Specialist";

  let pdfPath: string | undefined = undefined;
  let downloadUrl: string | undefined = undefined;
  if (report.fileUrl) {
    const filename = path.basename(report.fileUrl);
    const fullPath = path.join(process.cwd(), "uploads", "reports", filename);
    if (fs.existsSync(fullPath)) {
      pdfPath = fullPath;
    }
    const backendBase = (process.env.BACKEND_URL || "https://khatash5173.ilmifygroup.com").replace(/\/$/, "");
    downloadUrl = `${backendBase}/uploads/reports/${filename}`;
  }

  let sentCount = 0;
  for (const member of authorizedMembers) {
    try {
      await sendReportToFamilyRecipientEmail({
        to: member.email,
        recipientName: member.name,
        clientName,
        serviceType: report.reportType === "CLEANING_CHECKLIST" ? "Home Refresh & Cleaning" : "Home Safety Visit",
        visitDate: report.visit?.completedAt || report.createdAt,
        specialistName,
        reportTitle: report.title || "Safety Visit Report",
        customNote: input.customNote || null,
        reportId: report.id,
        pdfPath,
        downloadUrl,
      });
      sentCount++;
    } catch (emailErr) {
      console.warn(`Failed to send report email to ${member.email}:`, emailErr);
    }
  }

  return {
    success: true,
    sentCount,
    message: `Report successfully dispatched to ${sentCount} authorized family member(s).`,
  };
}
