import crypto from "crypto";
import { UserRole, UserStatus, OnboardingStatus, InvitationStatus, NotificationType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { hashPassword } from "../../utils/password";
import { generateAuthTokens } from "../../utils/jwt";
import { sendWelcomeInvitationEmail } from "../../utils/email";
import { generateNextClientNumber } from "../../utils/client-number.util";
import {
  CreateInvitationInput,
  AcceptInvitationInput,
  SaveOnboardingProgressInput,
} from "./invitation.validation";
import {
  createNotification,
  notifyAdmins,
} from "../notification/notification.service";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Send Welcome Invitation to Client
 */
export async function sendWelcomeInvitation(
  adminUserId: string,
  input: CreateInvitationInput
) {
  const email = input.email.trim().toLowerCase();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const expiresInDays = input.expiresInDays || 7;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  // Revoke any previous pending invitations for this email
  await (prisma.invitation.updateMany as any)({
    where: {
      email,
      status: InvitationStatus.PENDING,
    },
    data: {
      status: InvitationStatus.REVOKED,
    },
  });

  // Create new invitation record
  const invitation = await (prisma.invitation.create as any)({
    data: {
      email,
      clientId: input.clientId || null,
      tokenHash,
      status: InvitationStatus.PENDING,
      expiresAt,
      createdByUserId: adminUserId,
    },
    include: {
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const invitationLink = `${frontendUrl}/register?token=${rawToken}&email=${encodeURIComponent(email)}`;
  const clientName = input.firstName
    ? `${input.firstName} ${input.lastName || ""}`.trim()
    : "Valued Member";

  // Dispatch welcome invitation email unless skipped
  if (!input.skipEmail) {
    try {
      await sendWelcomeInvitationEmail({
        to: email,
        clientName,
        invitationLink,
        expiresAt,
        state: input.state,
        planName: input.planName || undefined,
      });
    } catch (emailErr) {
      console.warn("[WARN] Invitation email delivery failed (link still generated):", emailErr);
    }
  }

  // Audit Log
  try {
    await (prisma.auditLog.create as any)({
      data: {
        actorUserId: adminUserId,
        action: "INVITATION_SENT",
        entityType: "INVITATION",
        entityId: invitation.id,
        metadata: {
          recipientEmail: email,
          state: input.state,
          planName: input.planName,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
  } catch (err) {
    console.warn("⚠️ Audit log creation notice:", err);
  }

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    },
    invitationLink,
  };
}

/**
 * Verify invitation token
 */
export async function verifyInvitationToken(token: string) {
  if (!token) {
    throw new Error("Invitation token is missing.");
  }

  const tokenHash = hashToken(token);
  const invitation = await (prisma.invitation.findUnique as any)({
    where: { tokenHash },
    include: {
      client: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!invitation) {
    throw new Error("Invalid or unrecognized invitation link.");
  }

  if (invitation.status === InvitationStatus.ACCEPTED) {
    throw new Error("This invitation has already been accepted and completed.");
  }

  if (invitation.status === InvitationStatus.REVOKED) {
    throw new Error("This invitation has been revoked. Please request a new invitation link.");
  }

  if (invitation.expiresAt < new Date()) {
    await (prisma.invitation.update as any)({
      where: { id: invitation.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    throw new Error("This invitation link has expired. Please contact support or request a new invitation.");
  }

  return {
    valid: true,
    email: invitation.email,
    clientId: invitation.clientId,
    expiresAt: invitation.expiresAt,
    prefillData: invitation.client
      ? {
          firstName: invitation.client.user?.firstName || "",
          lastName: invitation.client.user?.lastName || "",
          phone: invitation.client.user?.phone || "",
          state: invitation.client.state || "RI",
          address: invitation.client.address || "",
          city: invitation.client.city || "",
          postalCode: invitation.client.postalCode || "",
        }
      : null,
  };
}

/**
 * Accept invitation and register account
 */
export async function acceptInvitation(input: AcceptInvitationInput) {
  const tokenHash = hashToken(input.token);
  const invitation = await (prisma.invitation.findUnique as any)({
    where: { tokenHash },
  });

  if (!invitation) {
    throw new Error("Invalid or unrecognized invitation token.");
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    throw new Error(`Invitation is ${invitation.status.toLowerCase()} and cannot be used.`);
  }

  if (invitation.expiresAt < new Date()) {
    await (prisma.invitation.update as any)({
      where: { id: invitation.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    throw new Error("Invitation has expired.");
  }

  const email = input.email.trim().toLowerCase();

  // Check if User already exists
  let user = await prisma.user.findUnique({
    where: { email },
    include: { client: true },
  });

  if (user) {
    throw new Error(`An account with email ${email} already exists. Please log in.`);
  }

  // Create User & Client
  const passwordHash = await hashPassword(input.password);
  let attempts = 0;
  const maxAttempts = 5;
  while (attempts < maxAttempts) {
    try {
      const clientNumber = await generateNextClientNumber();
      user = await (prisma.user.create as any)({
        data: {
          email,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          phone: input.phone.trim(),
          role: UserRole.CLIENT,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          client: {
            create: {
              clientNumber,
              address: input.address?.trim() || "TBD",
              city: input.city?.trim() || "Providence",
              state: input.state?.trim() || "RI",
              postalCode: input.postalCode?.trim() || "02906",
              country: "USA",
              onboardingStatus: OnboardingStatus.ACCOUNT_CREATED,
              onboardingStep: 1,
            },
          },
        },
        include: {
          client: true,
        },
      });
      break;
    } catch (err: any) {
      attempts++;
      if (
        (err?.code === "P2002" || err?.message?.includes("Unique constraint failed")) &&
        attempts < maxAttempts
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 40)));
        continue;
      }
      throw err;
    }
  }

  if (!user) {
    throw new Error("Failed to create member account.");
  }

  // Mark invitation as ACCEPTED
  await (prisma.invitation.update as any)({
    where: { id: invitation.id },
    data: {
      status: InvitationStatus.ACCEPTED,
      acceptedAt: new Date(),
      clientId: user.client?.id,
    },
  });

  // Generate tokens
  const tokens = generateAuthTokens({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  // Notifications & Audit Log
  try {
    await createNotification({
      userId: user.id,
      type: "ACCOUNT_CREATED",
      title: "Welcome to AgeWellRI",
      message: "Your member account was successfully created via welcome invitation. Please complete your service agreement.",
      metadata: { clientId: user.client?.id },
    });

    await notifyAdmins({
      type: "ACCOUNT_CREATED",
      title: "New Client Registration (Invitation Accepted)",
      message: `New client registration received for ${input.firstName} ${input.lastName}.`,
      metadata: { clientId: user.client?.id, email: user.email },
    });

    await (prisma.auditLog.create as any)({
      data: {
        actorUserId: user.id,
        action: "INVITATION_ACCEPTED",
        entityType: "CLIENT",
        entityId: user.client?.id || user.id,
        metadata: {
          invitationId: invitation.id,
          email: user.email,
        },
      },
    });
  } catch (err) {
    console.warn("⚠️ Notification/Audit log creation notice:", err);
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      client: user.client,
      hasCompletedAgreement: false,
      requiresAgreement: true,
    },
    tokens,
  };
}

/**
 * Get Admin Invitations List
 */
export async function getAdminInvitations() {
  return (prisma.invitation.findMany as any)({
    orderBy: { createdAt: "desc" },
    include: {
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      client: {
        select: {
          id: true,
          clientNumber: true,
          state: true,
          onboardingStatus: true,
        },
      },
    },
  });
}

/**
 * Revoke Invitation
 */
export async function revokeInvitation(adminUserId: string, invitationId: string) {
  const invitation = await (prisma.invitation.update as any)({
    where: { id: invitationId },
    data: { status: InvitationStatus.REVOKED },
  });

  try {
    await (prisma.auditLog.create as any)({
      data: {
        actorUserId: adminUserId,
        action: "INVITATION_REVOKED",
        entityType: "INVITATION",
        entityId: invitationId,
      },
    });
  } catch (err) {
    console.warn("⚠️ Audit log creation notice:", err);
  }

  return invitation;
}

/**
 * Resend Invitation
 */
export async function resendInvitation(adminUserId: string, invitationId: string) {
  const oldInvitation = await (prisma.invitation.findUnique as any)({
    where: { id: invitationId },
  });

  if (!oldInvitation) {
    throw new Error("Invitation not found.");
  }

  return sendWelcomeInvitation(adminUserId, {
    email: oldInvitation.email,
    clientId: oldInvitation.clientId,
    state: "RI",
    planName: (oldInvitation as any).client?.selectedPlan || undefined,
    expiresInDays: 7,
  });
}

/**
 * Get Client Onboarding State (For Resume / Save)
 */
export async function getOnboardingState(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!user || !user.client) {
    throw new Error("Client account profile not found.");
  }

  const client = user.client;
  const agreement = client.agreements?.[0] || null;

  return {
    userId: user.id,
    clientId: client.id,
    clientNumber: client.clientNumber,
    onboardingStatus: client.onboardingStatus,
    onboardingStep: (client as any).onboardingStep || 1,
    onboardingData: (client as any).onboardingData || null,
    hasCompletedAgreement: client.hasCompletedAgreement,
    primaryClient: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      address: client.address,
      city: client.city,
      state: client.state,
      postalCode: client.postalCode,
      dateOfBirth: client.dateOfBirth,
    },
    signer: {
      signerRole: client.signerRole,
      legalAuthority: client.legalAuthority,
      legalAuthorityOther: (client as any).legalAuthorityOther || null,
    },
    emergencyContact: {
      name: client.emergencyContactName,
      phone: client.emergencyContactPhone,
      email: (client as any).emergencyContactEmail || null,
      relation: client.emergencyContactRelation,
    },
    homeAccess: {
      type: client.homeAccessType,
      instructions: client.homeAccessInstructions,
      code: client.homeAccessCode,
    },
    agreement: agreement
      ? {
          id: agreement.id,
          status: agreement.status,
          state: agreement.state,
          templateVersion: agreement.templateVersion,
          cancellationDeadline: agreement.cancellationDeadline,
          signedAt: agreement.signedAt,
          executedAt: agreement.executedAt,
        }
      : null,
  };
}

/**
 * Save Partial Onboarding Progress (Auto-save / Resume)
 */
export async function saveOnboardingProgress(
  userId: string,
  input: SaveOnboardingProgressInput
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { client: true },
  });

  if (!user || !user.client) {
    throw new Error("Client account not found.");
  }

  const updatedClient = await (prisma.client.update as any)({
    where: { id: user.client.id },
    data: {
      onboardingStep: input.step,
      onboardingData: input.onboardingData,
    },
  });

  return {
    success: true,
    step: updatedClient.onboardingStep,
    message: "Onboarding progress saved successfully.",
  };
}
