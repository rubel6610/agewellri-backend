import { UserRole, OnboardingStatus, NotificationType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { CancellationDeadlineService } from "./cancellation-deadline.service";
import { sendAgreementExecutedEmail, sendPlanPurchaseConfirmationEmail, sendWelcomeInvitationEmail } from "../../utils/email";
import { processAgreementPayment } from "../payment/payment.service";
import { SubmitAgreementInput, CreateAgreementTemplateInput } from "./agreement.validation";

/**
 * Seed Default State Agreement Templates & Versions (RI, CT, MA)
 */
export async function seedDefaultAgreementTemplates() {
  const templates = [
    {
      state: "RI",
      title: "Rhode Island Client Service Agreement",
      description: "Official AgeWellRI home safety & care coordination membership contract for Rhode Island residents.",
      versionNumber: "v2.0",
      statutoryReference: "Rhode Island General Laws § 6-28-3",
      content: "Standard Rhode Island senior home safety & wellness coordination agreement with 3-business-day cancellation notice.",
    },
    {
      state: "CT",
      title: "Connecticut Client Service Agreement",
      description: "Official AgeWellRI home safety & care coordination membership contract for Connecticut residents.",
      versionNumber: "v1.0",
      statutoryReference: "Connecticut General Statutes § 42-134a",
      content: "Standard Connecticut senior home safety & wellness coordination agreement with 3-business-day cancellation notice.",
    },
    {
      state: "MA",
      title: "Massachusetts Client Service Agreement",
      description: "Official AgeWellRI home safety & care coordination membership contract for Massachusetts residents.",
      versionNumber: "v1.0",
      statutoryReference: "Massachusetts General Laws ch. 93 § 48",
      content: "Standard Massachusetts senior home safety & wellness coordination agreement with 3-business-day cancellation notice.",
    },
  ];

  for (const t of templates) {
    let template = await ((prisma as any).agreementTemplate.findUnique as any)({
      where: { state: t.state },
    });

    if (!template) {
      template = await ((prisma as any).agreementTemplate.create as any)({
        data: {
          state: t.state,
          title: t.title,
          description: t.description,
          isActive: true,
        },
      });
    }

    const existingVersion = await ((prisma as any).agreementVersion.findFirst as any)({
      where: {
        templateId: template.id,
        versionNumber: t.versionNumber,
      },
    });

    if (!existingVersion) {
      await ((prisma as any).agreementVersion.create as any)({
        data: {
          templateId: template.id,
          versionNumber: t.versionNumber,
          state: t.state,
          title: `${t.title} (${t.versionNumber})`,
          statutoryReference: t.statutoryReference,
          content: t.content,
          status: "ACTIVE",
          isDefault: true,
        },
      });
    }
  }

  console.log("✅ Seeded State Agreement Templates for RI, CT, MA.");
}

/**
 * Get All Agreement Templates & Versions
 */
export async function getAgreementTemplates() {
  return ((prisma as any).agreementTemplate.findMany as any)({
    where: { isActive: true },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        orderBy: { versionNumber: "desc" },
      },
    },
  });
}

/**
 * Get Agreement Template & Version by State
 */
export async function getAgreementTemplateByState(stateInput?: string) {
  const state = (stateInput || "RI").toUpperCase().trim();

  let template = await ((prisma as any).agreementTemplate.findUnique as any)({
    where: { state },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        orderBy: { versionNumber: "desc" },
      },
    },
  });

  // Fallback to RI if requested state not yet configured
  if (!template) {
    template = await ((prisma as any).agreementTemplate.findUnique as any)({
      where: { state: "RI" },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { versionNumber: "desc" },
        },
      },
    });
  }

  const activeVersion = template?.versions?.[0] || null;

  return {
    template,
    activeVersion,
    state: template?.state || state,
    statutoryReference:
      activeVersion?.statutoryReference ||
      (state === "CT"
        ? "Connecticut General Statutes § 42-134a"
        : state === "MA"
        ? "Massachusetts General Laws ch. 93 § 48"
        : "Rhode Island General Laws § 6-28-3"),
  };
}

/**
 * Calculate 3-Business-Day Cancellation Deadline
 */
export async function calculateCancellationDeadline(state?: string, date?: string | Date) {
  return CancellationDeadlineService.calculateDeadline(state, date);
}

/**
 * Submit & Execute Service Agreement
 */
export async function submitServiceAgreement(userId: string, input: SubmitAgreementInput) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User account not found.");
  }

  if (user.role !== UserRole.CLIENT) {
    throw new Error("Only client accounts sign the Client Service Agreement.");
  }

  const state = (input.state || "RI").toUpperCase().trim();
  const signerRole = input.signerRole || "RESIDENT";
  const isRepresentative = signerRole !== "RESIDENT";

  const signerName = isRepresentative
    ? (input.signerName || input.authorizedRepName || input.clientPrintedName).trim()
    : (input.clientPrintedName || input.clientFullName).trim();

  // 1. Resolve Dynamic Plan & PlanVersion
  let targetPlan: any = null;
  let targetVersion: any = null;

  if (input.planId) {
    targetPlan = await ((prisma as any).servicePlan.findUnique as any)({
      where: { id: input.planId },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { planServices: { include: { serviceType: true } } },
        },
      },
    });
    targetVersion = targetPlan?.versions?.[0];
  } else if (input.planVersionId) {
    targetVersion = await ((prisma as any).planVersion.findUnique as any)({
      where: { id: input.planVersionId },
      include: {
        plan: true,
        planServices: { include: { serviceType: true } },
      },
    });
    targetPlan = targetVersion?.plan;
  } else {
    targetPlan = await ((prisma as any).servicePlan.findFirst as any)({
      where: {
        OR: [
          { code: input.selectedPlan.toUpperCase() },
          { name: { equals: input.selectedPlan, mode: "insensitive" } },
        ],
      },
      include: {
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: { planServices: { include: { serviceType: true } } },
        },
      },
    });
    targetVersion = targetPlan?.versions?.[0];
  }

  const basePrice = targetVersion?.price ?? targetPlan?.price ?? 995;
  const finalPrice = input.hasCleaningAddon ? basePrice + 60 : basePrice;

  // 2. Server-side 3-Business-Day Cancellation Deadline Calculation
  const deadlineResult = CancellationDeadlineService.calculateDeadline(
    state,
    input.agreementDate
  );

  // 3. Resolve active Agreement Version for state
  const templateConfig = await getAgreementTemplateByState(state);
  const agreementVersionId = templateConfig.activeVersion?.id || null;
  const templateVersion = templateConfig.activeVersion?.versionNumber || "v2.0";

  // 4. Update or Create Client Profile
  let clientId = user.client?.id;
  const homeAccessType = input.homeAccessType || "RESIDENT_ANSWERS";

  if (!clientId) {
    const clientCount = await prisma.client.count();
    const clientNumber = `AW-${1001 + clientCount}`;
    const newClient = await ((prisma as any).client.create as any)({
      data: {
        userId: user.id,
        clientNumber,
        address: input.address,
        city: input.city,
        state,
        postalCode: input.postalCode,
        country: "USA",
        dateOfBirth: input.dob,
        signerRole,
        legalAuthority: isRepresentative ? input.legalAuthority || null : null,
        legalAuthorityOther: isRepresentative && input.legalAuthority === "OTHER" ? input.legalAuthorityOther || null : null,
        primaryContactName: input.primaryContactName || input.clientFullName,
        primaryContactPhone: input.primaryContactPhone || input.phone,
        primaryContactEmail: input.primaryContactEmail || input.email || user.email,
        primaryContactRelation: input.primaryContactRelation || (isRepresentative ? "Authorized Signer" : "Self"),
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactEmail: input.emergencyContactEmail || null,
        emergencyContactRelation: input.emergencyContactRelation || null,
        homeAccessType,
        homeAccessInstructions: input.homeAccessInstructions || null,
        homeAccessCode: input.homeAccessCode || null,
        selectedPlan: targetPlan?.code || input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
        onboardingStep: 6,
      },
    });
    clientId = newClient.id;
  } else {
    await ((prisma as any).client.update as any)({
      where: { id: clientId },
      data: {
        address: input.address,
        city: input.city,
        state,
        postalCode: input.postalCode,
        dateOfBirth: input.dob,
        signerRole,
        legalAuthority: isRepresentative ? input.legalAuthority || null : null,
        legalAuthorityOther: isRepresentative && input.legalAuthority === "OTHER" ? input.legalAuthorityOther || null : null,
        primaryContactName: input.primaryContactName || input.clientFullName,
        primaryContactPhone: input.primaryContactPhone || input.phone,
        primaryContactEmail: input.primaryContactEmail || input.email || user.email,
        primaryContactRelation: input.primaryContactRelation || (isRepresentative ? "Authorized Signer" : "Self"),
        emergencyContactName: input.emergencyContactName,
        emergencyContactPhone: input.emergencyContactPhone,
        emergencyContactEmail: input.emergencyContactEmail || null,
        emergencyContactRelation: input.emergencyContactRelation || null,
        homeAccessType,
        homeAccessInstructions: input.homeAccessInstructions || null,
        homeAccessCode: input.homeAccessCode || null,
        selectedPlan: targetPlan?.code || input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
        onboardingStep: 6,
      },
    });
  }

  // 5. Build Immutable Plan Snapshot
  const planSnapshot = {
    planId: targetPlan?.id,
    planVersionId: targetVersion?.id,
    planName: targetVersion?.name || targetPlan?.name || input.selectedPlan,
    planCode: targetPlan?.code || input.selectedPlan,
    basePrice,
    addonPrice: input.hasCleaningAddon ? 60 : 0,
    totalPrice: finalPrice,
    billingInterval: targetVersion?.billingInterval || targetPlan?.billingInterval || "QUARTERLY",
    features: targetVersion?.features || [],
    services: (targetVersion?.planServices || []).map((ps: any) => ({
      serviceName: ps.serviceType?.name,
      allocatedVisits: ps.allocatedVisits,
    })),
  };

  // 6. Create Immutable ServiceAgreement Record
  const agreement = await ((prisma as any).serviceAgreement.create as any)({
    data: {
      clientId,
      planId: targetPlan?.id || null,
      planVersionId: targetVersion?.id || null,
      agreementVersionId,
      templateVersion,
      state,
      signerRole,
      signerName,
      signerEmail: input.signerEmail || (isRepresentative ? input.primaryBillingContact || null : null),
      signerPhone: input.signerPhone || null,
      legalAuthority: isRepresentative ? input.legalAuthority || null : null,
      legalAuthorityOther: isRepresentative && input.legalAuthority === "OTHER" ? input.legalAuthorityOther || null : null,
      primaryBillingContact: input.primaryBillingContact || input.primaryContactEmail || input.email || user.email,
      cancellationDeadline: deadlineResult.deadlineDate,
      cancellationDeadlineRule: deadlineResult.ruleExplanation,
      planSnapshot,
      status: "EXECUTED",
      selectedPlan: targetPlan?.code || input.selectedPlan,
      planPrice: finalPrice,
      hasCleaningAddon: input.hasCleaningAddon,
      clientPrintedName: input.clientPrintedName,
      authorizedRepName: isRepresentative ? signerName : null,
      relationshipToClient: isRepresentative ? input.relationshipToClient || input.primaryContactRelation || null : "Self",
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      emergencyContactEmail: input.emergencyContactEmail || null,
      emergencyContactRelation: input.emergencyContactRelation || null,
      clientSignature: input.clientSignature,
      agreementDate: new Date(input.agreementDate),
      signedAt: new Date(),
      executedAt: new Date(),
      stripePaymentMethodId: input.paymentMethodId || null,
      stripeSetupIntentId: input.setupIntentId || null,
    },
  });

  // Sync phone to User
  if (input.phone && input.phone !== user.phone) {
    await prisma.user.update({
      where: { id: userId },
      data: { phone: input.phone },
    });
  }

  // 7. Payment Provisioning
  if (input.paymentMethodId || input.setupIntentId || input.billingMethod === "INVOICE") {
    try {
      await processAgreementPayment(userId, {
        agreementId: agreement.id,
        paymentMethodId: input.paymentMethodId || undefined,
        setupIntentId: input.setupIntentId || undefined,
        billingMethod: input.billingMethod || "AUTOMATIC",
        selectedPlan: (targetPlan?.code as any) || "GUARDIAN_PLUS",
        hasCleaningAddon: input.hasCleaningAddon,
      });
    } catch (paymentErr) {
      console.warn("⚠️ Agreement payment provisioning notice:", paymentErr);
    }
  }

  // 8. Send Executed Agreement Email Confirmation (Nodemailer)
  const recipientEmail = input.signerEmail || input.primaryBillingContact || input.email || user.email;
  try {
    await sendAgreementExecutedEmail({
      to: recipientEmail,
      clientName: `${user.firstName} ${user.lastName}`.trim(),
      signerName,
      signerRole,
      legalAuthority: input.legalAuthority || undefined,
      state,
      templateVersion,
      signedDate: new Date(),
      cancellationDeadline: deadlineResult.deadlineDate,
      cancellationDeadlineRule: deadlineResult.ruleExplanation,
      selectedPlan: targetPlan?.name || input.selectedPlan,
    });
  } catch (emailErr) {
    console.warn("⚠️ Nodemailer executed agreement email notice:", emailErr);
  }

  // 9. In-App Notifications for Client and Admin
  const executedNotificationType = (NotificationType as any).AGREEMENT_EXECUTED || "AGREEMENT_EXECUTED";
  try {
    await ((prisma as any).notification.create as any)({
      data: {
        userId: user.id,
        type: executedNotificationType,
        title: "Agreement Executed Successfully",
        message: `Your AgeWellRI Service Agreement (${state} - ${templateVersion}) has been signed and executed.`,
        metadata: {
          agreementId: agreement.id,
          cancellationDeadline: deadlineResult.deadlineDate.toISOString(),
        },
      },
    });

    // Notify Admins
    const admins = await prisma.user.findMany({
      where: { role: UserRole.ADMIN, status: "ACTIVE" },
      select: { id: true },
    });

    for (const admin of admins) {
      await ((prisma as any).notification.create as any)({
        data: {
          userId: admin.id,
          type: executedNotificationType,
          title: "New Agreement Executed",
          message: `${input.clientFullName} (${state}) signed service agreement (${templateVersion}).`,
          metadata: {
            clientId,
            agreementId: agreement.id,
            signerName,
            signerRole,
          },
        },
      });
    }

    // Audit Log
    await ((prisma as any).auditLog.create as any)({
      data: {
        actorUserId: user.id,
        action: "AGREEMENT_EXECUTED",
        entityType: "SERVICE_AGREEMENT",
        entityId: agreement.id,
        metadata: {
          clientId,
          state,
          signerRole,
          signerName,
          cancellationDeadline: deadlineResult.deadlineDate.toISOString(),
        },
      },
    });
  } catch (notifErr) {
    console.warn("⚠️ In-app notification / audit notice:", notifErr);
  }

  const updatedProfile: any = await prisma.user.findUnique({
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

  return {
    agreement,
    user: updatedProfile,
    cancellationDeadline: deadlineResult,
  };
}

/**
 * Get Client's Active/Latest Executed Agreement
 */
export async function getClientAgreement(userId: string) {
  const user: any = await ((prisma as any).user.findUnique as any)({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              plan: true,
              planVersion: true,
              agreementVersion: true,
            },
          },
        },
      },
    },
  });

  const client = user?.client;
  if (!user || !client || !client.agreements || client.agreements.length === 0) {
    return null;
  }

  return client.agreements[0];
}

/**
 * Get All Admin Agreements
 */
export async function getAllAdminAgreements(query?: { state?: string; status?: string; search?: string }) {
  const where: any = {};

  if (query?.state && query.state !== "ALL") {
    where.state = query.state.toUpperCase();
  }

  if (query?.status && query.status !== "ALL") {
    where.status = query.status;
  }

  const agreements = await ((prisma as any).serviceAgreement.findMany as any)({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      client: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      },
      plan: true,
      planVersion: true,
      agreementVersion: true,
    },
  });

  return agreements.map((agr: any) => {
    const clientUser = agr.client?.user;
    const clientName = `${clientUser?.firstName || agr.clientPrintedName || "Client"} ${clientUser?.lastName || ""}`.trim();
    const clientEmail = clientUser?.email || agr.primaryBillingContact || "";
    const title = `${agr.state} Client Service Agreement`;

    return {
      id: agr.id,
      clientId: agr.client?.clientNumber || agr.clientId,
      clientNumber: agr.client?.clientNumber || agr.clientId,
      clientName,
      clientEmail,
      title,
      state: agr.state,
      version: agr.templateVersion || agr.agreementVersion?.versionNumber || "v2.0",
      signerRole: agr.signerRole || "RESIDENT",
      signerName: agr.signerName || agr.clientPrintedName || clientName,
      legalAuthority: agr.legalAuthority,
      legalAuthorityOther: agr.legalAuthorityOther,
      status: agr.status,
      cancellationDeadline: agr.cancellationDeadline
        ? new Date(agr.cancellationDeadline).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : null,
      cancellationDeadlineRule: agr.cancellationDeadlineRule,
      planName: agr.plan?.name || agr.selectedPlan,
      planPrice: agr.planPrice,
      signedDate: agr.signedAt
        ? new Date(agr.signedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : null,
      executedAt: agr.executedAt,
      hasCleaningAddon: agr.hasCleaningAddon,
      clientSignature: agr.clientSignature,
    };
  });
}

/**
 * Send Agreement Signature Reminder
 */
export async function sendAgreementReminder(adminUserId: string, agreementId: string) {
  const agreement = await ((prisma as any).serviceAgreement.findUnique as any)({
    where: { id: agreementId },
    include: {
      client: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!agreement) {
    throw new Error("Service Agreement not found.");
  }

  const recipientEmail =
    agreement.signerEmail ||
    agreement.primaryBillingContact ||
    agreement.client?.user?.email;

  if (!recipientEmail) {
    throw new Error("Recipient email not found for this agreement.");
  }

  const clientName = `${agreement.client?.user?.firstName || ""} ${agreement.client?.user?.lastName || ""}`.trim() || agreement.clientPrintedName;

  try {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 3);

    await sendWelcomeInvitationEmail({
      to: recipientEmail,
      clientName,
      invitationLink: `${process.env.FRONTEND_URL || "http://localhost:3000"}/agreement`,
      state: agreement.state,
      planName: agreement.selectedPlan,
      expiresAt: expiryDate,
    });

    await ((prisma as any).auditLog.create as any)({
      data: {
        actorUserId: adminUserId,
        action: "AGREEMENT_REMINDER_SENT",
        entityType: "SERVICE_AGREEMENT",
        entityId: agreementId,
        metadata: {
          recipientEmail,
          clientName,
        },
      },
    });

    return {
      success: true,
      message: `Agreement reminder dispatched to ${recipientEmail}.`,
    };
  } catch (err: any) {
    throw new Error(`Failed to send reminder: ${err.message}`);
  }
}
