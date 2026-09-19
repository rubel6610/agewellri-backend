import { UserRole, OnboardingStatus, NotificationType } from "@prisma/client";
import path from "path";
import fs from "fs";
import prisma from "../../lib/prisma";
import { CancellationDeadlineService } from "./cancellation-deadline.service";
import {
  sendAgreementExecutedEmail,
  sendWelcomeInvitationEmail,
} from "../../utils/email";
import { generateNextClientNumber } from "../../utils/client-number.util";
import { processAgreementPayment } from "../payment/payment.service";
import {
  SubmitAgreementInput,
  CreateAgreementTemplateInput,
} from "./agreement.validation";
import { resolveClientForUser } from "../family/family.service";
import {
  notifyClientAndFamily,
  notifyAdmins,
} from "../notification/notification.service";

/**
 * Seed Default State Agreement Template & Version (Rhode Island)
 */
export async function seedDefaultAgreementTemplates() {
  const templates = [
    {
      state: "RI",
      title: "Rhode Island Client Service Agreement",
      description:
        "Official AgeWellRI home safety & care coordination membership contract for Rhode Island residents.",
      versionNumber: "v2.0",
      statutoryReference: "Rhode Island General Laws § 6-28-3",
      content:
        "Standard Rhode Island senior home safety & wellness coordination agreement with 3-business-day cancellation notice.",
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

    const existingVersion = await (
      (prisma as any).agreementVersion.findFirst as any
    )({
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

  console.log("✅ Seeded Rhode Island Agreement Template.");
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
export async function calculateCancellationDeadline(
  state?: string,
  date?: string | Date,
) {
  return CancellationDeadlineService.calculateDeadline(state, date);
}

/**
 * Submit & Execute Service Agreement
 */
export async function submitServiceAgreement(
  userId: string,
  input: SubmitAgreementInput,
) {
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
  const signingTrack =
    input.signingTrack ||
    (input.signerRole && input.signerRole !== "RESIDENT"
      ? "TRACK_B"
      : "TRACK_A");
  const isRepresentative =
    signingTrack === "TRACK_B" ||
    (input.signerRole && input.signerRole !== "RESIDENT");
  const signerRole = isRepresentative
    ? input.signerRole || "AUTHORIZED_REPRESENTATIVE"
    : "RESIDENT";
  const representativeCapacity = isRepresentative
    ? input.representativeCapacity || input.legalAuthority || null
    : null;
  const relationshipToClient = isRepresentative
    ? input.repRelationship ||
      input.relationshipToClient ||
      input.primaryContactRelation ||
      "Authorized Representative"
    : "Self";

  const signerName = isRepresentative
    ? (
        input.repFullName ||
        input.signerName ||
        input.authorizedRepName ||
        input.clientPrintedName ||
        ""
      ).trim()
    : (input.clientPrintedName || input.clientFullName).trim();

  // 1. Resolve Dynamic Plan
  let targetPlan: any = null;

  if (input.planId) {
    try {
      targetPlan = await prisma.servicePlan.findFirst({
        where: {
          OR: [
            { id: input.planId },
            { code: input.planId.toUpperCase() },
            { code: (input.selectedPlan || "").toUpperCase() },
            { name: { equals: input.selectedPlan || "", mode: "insensitive" } },
          ],
        },
      });
    } catch {
      targetPlan = null;
    }
  }

  if (!targetPlan && input.selectedPlan) {
    targetPlan = await prisma.servicePlan.findFirst({
      where: {
        OR: [
          { code: input.selectedPlan.toUpperCase() },
          { name: { equals: input.selectedPlan, mode: "insensitive" } },
        ],
      },
    });
  }

  const basePrice = targetPlan?.price ?? 995;
  const finalPrice = input.hasCleaningAddon ? basePrice + 60 : basePrice;

  // 2. Server-side 3-Business-Day Cancellation Deadline Calculation
  const deadlineResult = CancellationDeadlineService.calculateDeadline(
    state,
    input.agreementDate,
  );

  // 3. Resolve active Agreement Version for state
  const templateConfig = await getAgreementTemplateByState(state);
  const agreementVersionId = templateConfig.activeVersion?.id || null;
  const templateVersion = templateConfig.activeVersion?.versionNumber || "v2.0";

  // 4. Update or Create Client Profile
  let clientId = user.client?.id;
  const homeAccessType = input.homeAccessType || "RESIDENT_ANSWERS";

  const emergencyContactName =
    input.emergencyContactName ||
    (input.authorizedRecipients && input.authorizedRecipients[0]?.name) ||
    input.clientFullName;
  const emergencyContactPhone =
    input.emergencyContactPhone || input.phone || "Not Provided";
  const emergencyContactEmail =
    input.emergencyContactEmail ||
    (input.authorizedRecipients && input.authorizedRecipients[0]?.email) ||
    null;
  const emergencyContactRelation =
    input.emergencyContactRelation ||
    (input.authorizedRecipients &&
      input.authorizedRecipients[0]?.relationship) ||
    (isRepresentative ? "Authorized Signer" : "Primary Resident");

  const onboardingData = {
    signingTrack,
    representativeCapacity,
    repFullName: isRepresentative ? signerName : null,
    repRelationship: isRepresentative ? relationshipToClient : null,
    authorityDocumentUrl: input.authorityDocumentUrl || null,
    authorizedRecipients: input.authorizedRecipients || [],
    homeAccessAuthorized: input.homeAccessAuthorized ?? true,
    authorizations: input.authorizations || {
      emergencyRightOfEntry: true,
      residentAutonomyAcknowledgment: true,
      automaticBillingAuthorization: true,
    },
  };

  if (!clientId) {
    let attempts = 0;
    const maxAttempts = 5;
    let newClient: any = null;
    while (attempts < maxAttempts) {
      try {
        const clientNumber = await generateNextClientNumber();
        newClient = await ((prisma as any).client.create as any)({
          data: {
            userId: user.id,
            clientNumber,
            address: input.address,
            city: input.city,
            state,
            postalCode: input.postalCode,
            country: "USA",
            dateOfBirth: input.dob || null,
            signerRole,
            legalAuthority: isRepresentative ? input.legalAuthority || null : null,
            legalAuthorityOther:
              isRepresentative && input.legalAuthority === "OTHER"
                ? input.legalAuthorityOther || null
                : null,
            primaryContactName: input.primaryContactName || input.clientFullName,
            primaryContactPhone: input.primaryContactPhone || input.phone,
            primaryContactEmail:
              input.primaryContactEmail || input.email || user.email,
            primaryContactRelation:
              input.primaryContactRelation ||
              (isRepresentative ? "Authorized Signer" : "Self"),
            emergencyContactName,
            emergencyContactPhone,
            emergencyContactEmail,
            emergencyContactRelation,
            homeAccessType,
            homeAccessInstructions: input.homeAccessInstructions || null,
            homeAccessCode: input.homeAccessCode || null,
            selectedPlan: targetPlan?.code || input.selectedPlan,
            hasCleaningAddon: input.hasCleaningAddon,
            hasCompletedAgreement: true,
            onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
            onboardingStep: 6,
            onboardingData,
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
    clientId = newClient.id;
  } else {
    await ((prisma as any).client.update as any)({
      where: { id: clientId },
      data: {
        address: input.address,
        city: input.city,
        state,
        postalCode: input.postalCode,
        dateOfBirth: input.dob || null,
        signerRole,
        legalAuthority: isRepresentative ? input.legalAuthority || null : null,
        legalAuthorityOther:
          isRepresentative && input.legalAuthority === "OTHER"
            ? input.legalAuthorityOther || null
            : null,
        primaryContactName: input.primaryContactName || input.clientFullName,
        primaryContactPhone: input.primaryContactPhone || input.phone,
        primaryContactEmail:
          input.primaryContactEmail || input.email || user.email,
        primaryContactRelation:
          input.primaryContactRelation ||
          (isRepresentative ? "Authorized Signer" : "Self"),
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactEmail,
        emergencyContactRelation,
        homeAccessType,
        homeAccessInstructions: input.homeAccessInstructions || null,
        homeAccessCode: input.homeAccessCode || null,
        selectedPlan: targetPlan?.code || input.selectedPlan,
        hasCleaningAddon: input.hasCleaningAddon,
        hasCompletedAgreement: true,
        onboardingStatus: OnboardingStatus.AGREEMENT_SIGNED,
        onboardingStep: 6,
        onboardingData,
      },
    });
  }

  // 4b. Persist Authorized Recipients as FamilyMember records
  if (
    Array.isArray(input.authorizedRecipients) &&
    input.authorizedRecipients.length > 0
  ) {
    for (const rec of input.authorizedRecipients) {
      if (rec && rec.name && rec.email) {
        try {
          const cleanEmail = rec.email.trim().toLowerCase();
          const existing = await (prisma as any).familyMember.findFirst({
            where: { clientId, email: cleanEmail },
          });
          if (!existing) {
            await (prisma as any).familyMember.create({
              data: {
                clientId,
                name: rec.name.trim(),
                relationship: rec.relationship?.trim() || "Family Member",
                email: cleanEmail,
                phone: (rec as any).phone?.trim() || null,
                reportAccess: true,
                portalAccess: false,
                billingAccess: false,
                invitationStatus: "PENDING",
              },
            });
          }
        } catch (recErr) {
          console.warn(
            "⚠️ Error saving recipient during agreement execution:",
            recErr,
          );
        }
      }
    }
  }

  // 5. Build Immutable Plan Snapshot
  const planSnapshot = {
    planId: targetPlan?.id,
    planName: targetPlan?.name || input.selectedPlan,
    planCode: targetPlan?.code || input.selectedPlan,
    basePrice,
    addonPrice: input.hasCleaningAddon ? 60 : 0,
    totalPrice: finalPrice,
    totalVisits: targetPlan?.totalVisits || 2,
    billingInterval: "MONTHLY",
    features: targetPlan?.features || [],
  };

  // 6. Create Immutable ServiceAgreement Record
  const agreement = await ((prisma as any).serviceAgreement.create as any)({
    data: {
      clientId,
      planId: targetPlan?.id || null,
      agreementVersionId,
      templateVersion,
      state,
      signerRole,
      signerName,
      signerEmail:
        input.signerEmail ||
        (isRepresentative ? input.primaryBillingContact || null : null),
      signerPhone: input.signerPhone || null,
      legalAuthority: isRepresentative ? representativeCapacity : null,
      legalAuthorityOther:
        isRepresentative && representativeCapacity === "OTHER"
          ? input.legalAuthorityOther || null
          : null,
      primaryBillingContact:
        input.primaryBillingContact ||
        input.primaryContactEmail ||
        input.email ||
        user.email,
      cancellationDeadline: deadlineResult.deadlineDate,
      cancellationDeadlineRule: deadlineResult.ruleExplanation,
      planSnapshot,
      status: "EXECUTED",
      documentUrl: input.authorityDocumentUrl || null,
      selectedPlan: targetPlan?.code || input.selectedPlan,
      planPrice: finalPrice,
      hasCleaningAddon: input.hasCleaningAddon,
      clientPrintedName: input.clientPrintedName,
      authorizedRepName: isRepresentative ? signerName : null,
      relationshipToClient,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactEmail,
      emergencyContactRelation,
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

  // 7. Payment Provisioning via Stripe (with skipEmail: true to guarantee a single unified email)
  let paymentResult: any = null;
  if (
    input.paymentMethodId ||
    input.setupIntentId ||
    input.billingMethod === "INVOICE"
  ) {
    try {
      paymentResult = await processAgreementPayment(userId, {
        agreementId: agreement.id,
        paymentMethodId: input.paymentMethodId || undefined,
        setupIntentId: input.setupIntentId || undefined,
        billingMethod: input.billingMethod || "AUTOMATIC",
        selectedPlan:
          (targetPlan?.code as any) ||
          (input.selectedPlan as any),
        hasCleaningAddon: input.hasCleaningAddon,
        skipEmail: true,
      });
    } catch (paymentErr) {
      console.warn(
        "⚠️ Agreement Stripe payment provisioning notice:",
        paymentErr,
      );
    }
  }

  // 8. Send Unified Executed Agreement & Membership Confirmation Email (Single Dispatch)
  const targetClientId = clientId || user.client?.id;
  let latestClient: any = null;
  if (targetClientId) {
    try {
      latestClient = await (prisma as any).client.findUnique({
        where: { id: targetClientId },
      });
    } catch {}
  }

  const serviceAddress = [
    input.address,
    input.city,
    state,
    input.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  const recipientEmails = Array.from(
    new Set(
      [
        input.signerEmail,
        input.primaryBillingContact,
        input.primaryContactEmail,
        input.email,
        user.email,
      ]
        .filter((e): e is string =>
          Boolean(e && typeof e === "string" && e.includes("@")),
        )
        .map((e) => e.trim()),
    ),
  ).join(", ");

  try {
    await sendAgreementExecutedEmail({
      to: recipientEmails || user.email,
      clientName:
        `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
        input.clientFullName ||
        "Valued Client",
      clientNumber: latestClient?.clientNumber,
      signerName,
      signerRole,
      legalAuthority: isRepresentative
        ? input.legalAuthority || undefined
        : undefined,
      serviceAddress: serviceAddress || undefined,
      state,
      templateVersion,
      signedDate: new Date(),
      cancellationDeadline: deadlineResult.deadlineDate,
      cancellationDeadlineRule: deadlineResult.ruleExplanation,
      selectedPlan: targetPlan?.name || input.selectedPlan,
      planName: targetPlan?.name || input.selectedPlan || "AgeWellRI Membership",
      planCode: targetPlan?.code || input.selectedPlan,
      planDescription: targetPlan?.shortDescription || targetPlan?.description || "",
      features: targetPlan?.features || [],
      services: [],
      hasCleaningAddon: input.hasCleaningAddon,
      amount: finalPrice,
      currency: "USD",
      billingInterval: "MONTHLY",
      billingMethod: input.billingMethod || "AUTOMATIC",
      cardBrand: latestClient?.cardBrand || undefined,
      cardLast4: latestClient?.cardLast4 || undefined,
      invoiceNumber: paymentResult?.invoiceNumber,
      firstBillingDate: paymentResult?.firstBillingDate
        ? new Date(paymentResult.firstBillingDate)
        : null,
    });
  } catch (emailErr) {
    console.warn("⚠️ Nodemailer executed agreement email notice:", emailErr);
  }

  // 9. In-App Notifications for Client and Admin
  try {
    const targetClientId = clientId || user.client?.id;
    if (targetClientId) {
      const now = new Date();
      const nextMonthFirst = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const commencementDateFormatted = nextMonthFirst.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      const planDisplay = targetPlan?.name || input.selectedPlan || "AgeWellRI Membership";
      const priceDisplay = `$${finalPrice}/month`;

      const notificationMessage = `Your service agreement is complete and your subscription is active.\n• Your plan: ${planDisplay} — ${priceDisplay}\n• Service begins: ${commencementDateFormatted}\n• First billing: ${commencementDateFormatted} — you won't be charged today\n• A copy of your signed agreement has been emailed to you for your records.\nWe'll be in touch shortly to schedule your first visit. Questions? Call us anytime at (401) 212-3002.`;

      await notifyClientAndFamily(
        targetClientId,
        {
          type: "AGREEMENT_EXECUTED",
          title: "Agreement Signed — Welcome to AgeWellRI!",
          message: notificationMessage,
          metadata: {
            agreementId: agreement.id,
            cancellationDeadline: deadlineResult.deadlineDate.toISOString(),
            planName: planDisplay,
            planPrice: finalPrice,
            commencementDate: commencementDateFormatted,
          },
        },
        "portalAccess",
      );
    }

    await notifyAdmins({
      type: "AGREEMENT_EXECUTED",
      title: "New Agreement Executed",
      message: `${input.clientFullName} (${state}) signed service agreement (${templateVersion}).`,
      metadata: {
        clientId,
        agreementId: agreement.id,
        signerName,
        signerRole,
      },
    });
  } catch (notifErr) {
    console.warn("⚠️ Agreement in-app notification dispatch notice:", notifErr);
  }

  // Audit Log
  try {
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
  } catch (auditErr) {
    console.warn("⚠️ Audit log notice:", auditErr);
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
  const context = await resolveClientForUser(userId);
  if (!context || !context.client) {
    return null;
  }

  const client = context.client;
  const clientId = client.id;

  const agreement = await ((prisma as any).serviceAgreement.findFirst as any)({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      planVersion: true,
      agreementVersion: true,
    },
  });

  const fullClient = await ((prisma as any).client.findUnique as any)({
    where: { id: clientId },
    include: {
      user: true,
      familyMembers: true,
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!agreement && !fullClient?.hasCompletedAgreement) {
    return null;
  }

  const clientUser = fullClient?.user;
  const fullName =
    `${clientUser?.firstName || ""} ${clientUser?.lastName || ""}`.trim() ||
    agreement?.clientPrintedName ||
    "Client Member";
  const onboardingData = (fullClient?.onboardingData as any) || {};
  const isRepresentative =
    (agreement?.signerRole && agreement.signerRole !== "RESIDENT") ||
    fullClient?.signerRole !== "RESIDENT";

  const authorizedRecipients =
    Array.isArray(onboardingData?.authorizedRecipients) &&
    onboardingData.authorizedRecipients.length > 0
      ? onboardingData.authorizedRecipients
      : (fullClient?.familyMembers || []).map((fm: any) => ({
          name: fm.name,
          relationship: fm.relationship,
          email: fm.email,
          phone: fm.phone || null,
        }));

  return {
    id: agreement?.id || `AW-AG-${fullClient?.clientNumber || "NEW"}`,
    templateVersion:
      agreement?.templateVersion ||
      agreement?.agreementVersion?.versionNumber ||
      "v2.0",
    state: agreement?.state || fullClient?.state || "RI",
    status:
      agreement?.status ||
      (fullClient?.hasCompletedAgreement ? "EXECUTED" : "DRAFT"),

    // Plan & Financials
    selectedPlan:
      agreement?.selectedPlan || fullClient?.selectedPlan || "Peace of Mind Plan",
    planName:
      agreement?.plan?.name ||
      agreement?.planSnapshot?.planName ||
      agreement?.selectedPlan ||
      fullClient?.selectedPlan ||
      "Member Service Plan",
    planPrice:
      agreement?.planPrice ??
      agreement?.planSnapshot?.totalPrice ??
      fullClient?.subscriptions?.[0]?.contractedPrice ??
      495,
    hasCleaningAddon:
      agreement?.hasCleaningAddon ?? fullClient?.hasCleaningAddon ?? false,
    planSnapshot: agreement?.planSnapshot || null,

    // Client Details
    clientFullName: fullName,
    clientPrintedName: agreement?.clientPrintedName || fullName,
    clientNumber: fullClient?.clientNumber || "AW-MEMBER",
    address: fullClient?.address || "",
    city: fullClient?.city || "",
    stateAddress: fullClient?.state || "RI",
    postalCode: fullClient?.postalCode || "",
    phone: clientUser?.phone || fullClient?.primaryContactPhone || "",
    dob: fullClient?.dateOfBirth || "",
    dateOfBirth: fullClient?.dateOfBirth || "",
    email: clientUser?.email || fullClient?.primaryContactEmail || "",

    // Signing Track & Representative
    signingTrack:
      onboardingData?.signingTrack || (isRepresentative ? "TRACK_B" : "TRACK_A"),
    signerRole:
      agreement?.signerRole || fullClient?.signerRole || "RESIDENT",
    signerName:
      agreement?.signerName || agreement?.authorizedRepName || fullName,
    signerEmail:
      agreement?.signerEmail ||
      fullClient?.primaryContactEmail ||
      clientUser?.email ||
      null,
    signerPhone:
      agreement?.signerPhone ||
      fullClient?.primaryContactPhone ||
      clientUser?.phone ||
      null,
    representativeCapacity:
      onboardingData?.representativeCapacity ||
      agreement?.legalAuthority ||
      fullClient?.legalAuthority ||
      null,
    repFullName:
      agreement?.authorizedRepName ||
      (isRepresentative ? agreement?.signerName : null),
    authorizedRepName:
      agreement?.authorizedRepName ||
      (isRepresentative ? agreement?.signerName : null),
    relationshipToClient:
      agreement?.relationshipToClient ||
      fullClient?.primaryContactRelation ||
      (isRepresentative ? "Authorized Representative" : "Self"),
    legalAuthority:
      agreement?.legalAuthority || fullClient?.legalAuthority || null,
    legalAuthorityOther:
      agreement?.legalAuthorityOther || fullClient?.legalAuthorityOther || null,
    authorityDocumentUrl:
      agreement?.documentUrl || onboardingData?.authorityDocumentUrl || null,
    documentUrl:
      agreement?.documentUrl || onboardingData?.authorityDocumentUrl || null,

    // Contacts
    primaryContactName:
      fullClient?.primaryContactName ||
      (isRepresentative ? agreement?.signerName : fullName),
    primaryContactPhone:
      fullClient?.primaryContactPhone || clientUser?.phone || null,
    primaryContactEmail:
      fullClient?.primaryContactEmail || clientUser?.email || "",
    primaryContactRelation:
      fullClient?.primaryContactRelation ||
      (isRepresentative ? "Authorized Representative" : "Self"),
    primaryBillingContact:
      agreement?.primaryBillingContact ||
      fullClient?.primaryContactEmail ||
      clientUser?.email ||
      "",

    emergencyContactName:
      agreement?.emergencyContactName ||
      fullClient?.emergencyContactName ||
      "Not Provided",
    emergencyContactPhone:
      agreement?.emergencyContactPhone ||
      fullClient?.emergencyContactPhone ||
      "Not Provided",
    emergencyContactEmail:
      agreement?.emergencyContactEmail ||
      fullClient?.emergencyContactEmail ||
      null,
    emergencyContactRelation:
      agreement?.emergencyContactRelation ||
      fullClient?.emergencyContactRelation ||
      "Family",

    // Authorized Report Recipients
    authorizedRecipients,

    // Home Access Specifications
    homeAccessType: fullClient?.homeAccessType || "RESIDENT_ANSWERS",
    homeAccessInstructions: fullClient?.homeAccessInstructions || null,
    homeAccessCode: fullClient?.homeAccessCode || null,
    homeAccessAuthorized: onboardingData?.homeAccessAuthorized ?? true,

    // Authorizations
    authorizations: onboardingData?.authorizations || {
      emergencyRightOfEntry: true,
      residentAutonomyAcknowledgment: true,
      automaticBillingAuthorization: true,
    },

    // Statutory Cancellation
    cancellationDeadline: agreement?.cancellationDeadline
      ? new Date(agreement.cancellationDeadline).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null,
    cancellationDeadlineRule:
      agreement?.cancellationDeadlineRule ||
      "3 business days under state consumer protection regulations",

    // Signatures & Dates
    clientSignature: agreement?.clientSignature || null,
    agreementDate:
      agreement?.agreementDate ||
      agreement?.signedAt ||
      agreement?.createdAt ||
      new Date(),
    signedAt: agreement?.signedAt || null,
    executedAt: agreement?.executedAt || null,
    createdAt: agreement?.createdAt || null,
    updatedAt: agreement?.updatedAt || null,
  };
}

/**
 * Get All Admin Agreements
 */
export async function getAllAdminAgreements(query?: {
  state?: string;
  status?: string;
  search?: string;
}) {
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
          familyMembers: true,
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      plan: true,
      planVersion: true,
      agreementVersion: true,
    },
  });

  return agreements.map((agr: any) => {
    const fullClient = agr.client;
    const clientUser = fullClient?.user;
    const clientName =
      `${clientUser?.firstName || agr.clientPrintedName || "Client"} ${clientUser?.lastName || ""}`.trim();
    const clientEmail = clientUser?.email || agr.primaryBillingContact || "";
    const title = `${agr.state} Client Service Agreement`;
    const onboardingData = (fullClient?.onboardingData as any) || {};
    const isRepresentative =
      (agr.signerRole && agr.signerRole !== "RESIDENT") ||
      fullClient?.signerRole !== "RESIDENT";

    const authorizedRecipients =
      Array.isArray(onboardingData?.authorizedRecipients) &&
      onboardingData.authorizedRecipients.length > 0
        ? onboardingData.authorizedRecipients
        : (fullClient?.familyMembers || []).map((fm: any) => ({
            name: fm.name,
            relationship: fm.relationship,
            email: fm.email,
            phone: fm.phone || null,
          }));

    return {
      id: agr.id,
      clientId: fullClient?.id || agr.clientId,
      clientNumber: fullClient?.clientNumber || agr.clientId,
      clientName,
      clientFullName: clientName,
      clientPrintedName: agr.clientPrintedName || clientName,
      clientEmail,
      email: clientEmail,
      phone:
        clientUser?.phone ||
        fullClient?.primaryContactPhone ||
        agr.signerPhone ||
        null,
      dob: fullClient?.dateOfBirth || null,
      dateOfBirth: fullClient?.dateOfBirth || null,
      address: fullClient?.address || null,
      city: fullClient?.city || null,
      state: agr.state,
      postalCode: fullClient?.postalCode || null,

      // Contacts
      primaryContactName:
        fullClient?.primaryContactName ||
        (isRepresentative ? agr.signerName : clientName),
      primaryContactPhone:
        fullClient?.primaryContactPhone ||
        clientUser?.phone ||
        agr.signerPhone ||
        null,
      primaryContactEmail: fullClient?.primaryContactEmail || clientEmail,
      primaryContactRelation:
        fullClient?.primaryContactRelation ||
        (isRepresentative ? "Authorized Representative" : "Self"),
      primaryBillingContact:
        agr.primaryBillingContact ||
        fullClient?.primaryContactEmail ||
        clientEmail,

      emergencyContactName:
        agr.emergencyContactName ||
        fullClient?.emergencyContactName ||
        "Not Provided",
      emergencyContactPhone:
        agr.emergencyContactPhone ||
        fullClient?.emergencyContactPhone ||
        "Not Provided",
      emergencyContactEmail:
        agr.emergencyContactEmail || fullClient?.emergencyContactEmail || null,
      emergencyContactRelation:
        agr.emergencyContactRelation ||
        fullClient?.emergencyContactRelation ||
        "Family",

      // Authorized Report Recipients
      authorizedRecipients,

      // Home Access Specifications
      homeAccessType: fullClient?.homeAccessType || "RESIDENT_ANSWERS",
      homeAccessInstructions: fullClient?.homeAccessInstructions || null,
      homeAccessCode: fullClient?.homeAccessCode || null,
      homeAccessAuthorized: onboardingData?.homeAccessAuthorized ?? true,

      // Authorizations
      authorizations: onboardingData?.authorizations || {
        emergencyRightOfEntry: true,
        residentAutonomyAcknowledgment: true,
        automaticBillingAuthorization: true,
      },

      // Track & Representative
      signingTrack:
        onboardingData?.signingTrack || (isRepresentative ? "TRACK_B" : "TRACK_A"),
      representativeCapacity:
        onboardingData?.representativeCapacity ||
        agr.legalAuthority ||
        fullClient?.legalAuthority ||
        null,
      repFullName:
        agr.authorizedRepName || (isRepresentative ? agr.signerName : null),
      authorizedRepName:
        agr.authorizedRepName || (isRepresentative ? agr.signerName : null),
      relationshipToClient:
        agr.relationshipToClient ||
        fullClient?.primaryContactRelation ||
        (isRepresentative ? "Authorized Representative" : "Self"),
      authorityDocumentUrl:
        agr.documentUrl || onboardingData?.authorityDocumentUrl || null,
      documentUrl:
        agr.documentUrl || onboardingData?.authorityDocumentUrl || null,

      // Agreement Details
      title,
      version:
        agr.templateVersion || agr.agreementVersion?.versionNumber || "v2.0",
      templateVersion:
        agr.templateVersion || agr.agreementVersion?.versionNumber || "v2.0",
      signerRole: agr.signerRole || "RESIDENT",
      signerName: agr.signerName || agr.clientPrintedName || clientName,
      signerEmail:
        agr.signerEmail || fullClient?.primaryContactEmail || clientEmail,
      signerPhone:
        agr.signerPhone ||
        fullClient?.primaryContactPhone ||
        clientUser?.phone ||
        null,
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
      cancellationDeadlineRule:
        agr.cancellationDeadlineRule || "3 business days under state regulations",
      planName:
        agr.plan?.name || agr.planSnapshot?.planName || agr.selectedPlan,
      selectedPlan: agr.selectedPlan || agr.plan?.code,
      planPrice: agr.planPrice ?? agr.planSnapshot?.totalPrice ?? 495,
      hasCleaningAddon: agr.hasCleaningAddon,
      clientSignature: agr.clientSignature,
      signedDate: agr.signedAt
        ? new Date(agr.signedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : null,
      agreementDate: agr.agreementDate || agr.signedAt || agr.createdAt,
      signedAt: agr.signedAt,
      executedAt: agr.executedAt,
    };
  });
}

/**
 * Send Agreement Signature Reminder
 */
export async function sendAgreementReminder(
  adminUserId: string,
  agreementId: string,
) {
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

  const clientName =
    `${agreement.client?.user?.firstName || ""} ${agreement.client?.user?.lastName || ""}`.trim() ||
    agreement.clientPrintedName;

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

/**
 * Admin Delete Service Agreement
 */
export async function deleteAgreement(
  adminUserId: string,
  agreementId: string,
) {
  const agreement = await ((prisma as any).serviceAgreement.findUnique as any)({
    where: { id: agreementId },
  });

  if (!agreement) {
    throw new Error("Service Agreement not found.");
  }

  const clientId = agreement.clientId;

  await ((prisma as any).serviceAgreement.delete as any)({
    where: { id: agreementId },
  });

  // Check if client has any other active/signed agreements remaining
  if (clientId) {
    try {
      const remainingAgreements = await (
        (prisma as any).serviceAgreement.findMany as any
      )({
        where: {
          clientId,
          status: { in: ["SIGNED", "EXECUTED"] },
        },
      });

      if (!remainingAgreements || remainingAgreements.length === 0) {
        await ((prisma as any).client.update as any)({
          where: { id: clientId },
          data: {
            hasCompletedAgreement: false,
            onboardingStatus: OnboardingStatus.AGREEMENT_PENDING,
          },
        });
      }
    } catch (clientSyncErr) {
      console.warn(
        "Client state sync error after agreement deletion:",
        clientSyncErr,
      );
    }
  }

  try {
    await ((prisma as any).auditLog.create as any)({
      data: {
        actorUserId: adminUserId,
        action: "AGREEMENT_DELETED",
        entityType: "SERVICE_AGREEMENT",
        entityId: agreementId,
        metadata: {
          agreementState: agreement.state,
          clientId: agreement.clientId,
        },
      },
    });
  } catch (auditErr) {
    console.warn("Audit log creation error:", auditErr);
  }

  return {
    success: true,
    message: "Service Agreement deleted successfully.",
  };
}

/**
 * Get Legal Authority Document File for Download or Inline View
 */
export async function getAuthorityDocumentForDownload(
  identifier: string,
  user: { id: string; role: string }
): Promise<{
  filePath: string;
  fileName: string;
  mimeType: string;
}> {
  let docUrl: string | null = null;
  let clientName = "Client";

  // Check if identifier is "my-agreement" or user is CLIENT requesting their own
  if (
    identifier === "my-agreement" ||
    identifier === "me" ||
    identifier === "current"
  ) {
    const context = await resolveClientForUser(user.id);
    const fullClient = context?.client
      ? await ((prisma as any).client.findUnique as any)({
          where: { id: context.client.id },
          include: { user: true },
        })
      : null;

    if (!fullClient) {
      throw new Error("Client account not found.");
    }
    clientName =
      `${fullClient.user?.firstName || ""} ${fullClient.user?.lastName || ""}`.trim() ||
      "Member";

    const agreement = await ((prisma as any).serviceAgreement.findFirst as any)({
      where: { clientId: fullClient.id },
      orderBy: { createdAt: "desc" },
    });

    const onboardingData = fullClient.onboardingData as any;
    docUrl =
      agreement?.documentUrl || onboardingData?.authorityDocumentUrl || null;
  } else if (
    identifier.startsWith("poa-") ||
    identifier.endsWith(".pdf") ||
    identifier.endsWith(".png") ||
    identifier.endsWith(".jpg") ||
    identifier.endsWith(".jpeg")
  ) {
    // Lookup by filename (with path sanitization)
    const sanitizedFilename = path.basename(identifier);
    if (user.role !== "ADMIN") {
      // For clients, verify this file belongs to them
      const context = await resolveClientForUser(user.id);
      const fullClient = context?.client
        ? await ((prisma as any).client.findUnique as any)({
            where: { id: context.client.id },
            include: { user: true },
          })
        : null;

      if (!fullClient) throw new Error("Client account not found.");
      const agreement = await (
        (prisma as any).serviceAgreement.findFirst as any
      )({
        where: { clientId: fullClient.id },
        orderBy: { createdAt: "desc" },
      });
      const onboardingData = fullClient.onboardingData as any;
      const clientDoc =
        agreement?.documentUrl || onboardingData?.authorityDocumentUrl || null;
      if (!clientDoc || !clientDoc.includes(sanitizedFilename)) {
        throw new Error("You do not have permission to download this document.");
      }
      clientName =
        `${fullClient.user?.firstName || ""} ${fullClient.user?.lastName || ""}`.trim() ||
        "Member";
    }
    docUrl = `/uploads/authority-documents/${sanitizedFilename}`;
  } else {
    // Lookup by agreement ID
    const agreement = await (
      (prisma as any).serviceAgreement.findUnique as any
    )({
      where: { id: identifier },
      include: {
        client: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!agreement) {
      // Check if identifier is clientId
      const clientRecord = await ((prisma as any).client.findUnique as any)({
        where: { id: identifier },
        include: { user: true },
      });
      if (clientRecord) {
        if (user.role !== "ADMIN" && clientRecord.userId !== user.id) {
          throw new Error("You do not have permission to access this document.");
        }
        clientName =
          `${clientRecord.user?.firstName || ""} ${clientRecord.user?.lastName || ""}`.trim() ||
          "Member";
        const onboardingData = clientRecord.onboardingData as any;
        const agr = await (
          (prisma as any).serviceAgreement.findFirst as any
        )({
          where: { clientId: clientRecord.id },
          orderBy: { createdAt: "desc" },
        });
        docUrl =
          agr?.documentUrl || onboardingData?.authorityDocumentUrl || null;
      } else {
        throw new Error("Agreement record not found.");
      }
    } else {
      if (user.role !== "ADMIN" && agreement.client?.userId !== user.id) {
        throw new Error("You do not have permission to download this document.");
      }
      const clientUser = agreement.client?.user;
      clientName =
        `${clientUser?.firstName || ""} ${clientUser?.lastName || ""}`.trim() ||
        agreement.signerName ||
        "Member";
      const onboardingData = agreement.client?.onboardingData as any;
      docUrl =
        agreement.documentUrl || onboardingData?.authorityDocumentUrl || null;
    }
  }

  if (!docUrl) {
    throw new Error("No legal authority document is attached to this agreement.");
  }

  const rawFilename = path.basename(docUrl);
  const filePath = path.join(
    process.cwd(),
    "uploads",
    "authority-documents",
    rawFilename
  );

  if (!fs.existsSync(filePath)) {
    throw new Error("Authority document file was not found on server storage.");
  }

  const ext = path.extname(filePath).toLowerCase();
  let mimeType = "application/octet-stream";
  if (ext === ".pdf") mimeType = "application/pdf";
  else if (ext === ".png") mimeType = "image/png";
  else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";

  const safeClientName = clientName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const cleanExt = ext || ".pdf";
  const downloadFileName = `AgeWellRI_Legal_Authority_${safeClientName}${cleanExt}`;

  return {
    filePath,
    fileName: downloadFileName,
    mimeType,
  };
}

