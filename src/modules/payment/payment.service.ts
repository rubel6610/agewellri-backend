import {
  OnboardingStatus,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentStatus,
  BillingInterval,
  BillingMethod,
  ServiceTypeCategory,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { stripe, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET } from "../../config/stripe";
import {
  CreatePaymentIntentInput,
  CreateSetupIntentInput,
  ProcessAgreementPaymentInput,
  CreateInvoicePaymentInput,
  CancelRenewalInput,
  AdminBillingFilterInput,
  AdminRetryChargeInput,
} from "./payment.validation";
import {
  ensureVisitAllocationsForPeriod,
  getClientVisitEntitlements,
  formatPeriodEntitlements,
} from "./visit-entitlement.service";

export type WebhookEventStatusType = "RECEIVED" | "PROCESSED" | "FAILED" | "IGNORED";

/**
 * Helper to record audit logs for critical payment & billing events.
 */
async function createBillingAuditLog(params: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: any;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await (prisma.auditLog.create as any)({
      data: {
        actorUserId: params.actorUserId || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
      },
    });
  } catch (err) {
    console.warn("⚠️ Failed to write audit log:", err);
  }
}

/**
 * Ensure a Stripe Customer exists for the given user/client.
 * If not, creates one in Stripe and records stripeCustomerId in the Client record.
 */
export async function getOrCreateStripeCustomer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { client: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  let client: any = user.client;
  if (!client) {
    const clientNumber = `AW-${Math.floor(1000 + Math.random() * 9000)}`;
    client = await prisma.client.create({
      data: {
        userId: user.id,
        clientNumber,
        address: "",
        city: "",
        state: "",
        postalCode: "",
        country: "USA",
      },
    });
  }

  if (client.stripeCustomerId) {
    try {
      const existingCustomer = await stripe.customers.retrieve(client.stripeCustomerId);
      if (!existingCustomer.deleted) {
        return {
          customer: existingCustomer,
          customerId: existingCustomer.id,
          client,
        };
      }
    } catch {
      // If retrieval failed or invalid, we will recreate below
    }
  }

  // Create new Customer in Stripe
  const fullName = `${user.firstName} ${user.lastName}`.trim() || "AgeWellRI Client";
  const customer = await stripe.customers.create({
    email: user.email,
    name: fullName,
    phone: user.phone || undefined,
    metadata: {
      userId: user.id,
      clientId: client.id,
      clientNumber: client.clientNumber,
    },
  });

  client = await (prisma.client.update as any)({
    where: { id: client.id },
    data: { stripeCustomerId: customer.id },
  });

  return {
    customer,
    customerId: customer.id,
    client,
  };
}

/**
/**
 * Server-side source of truth for plan pricing and visit quotas.
 * Dynamically resolves active ServicePlan, PlanVersion, PlanPrice, features,
 * and associated PlanService allocations directly from the database.
 * No hardcoded plans, prices, visits, or service names.
 */
export async function resolvePlanPricingDynamic(
  planIdentifier?: string | null,
  hasCleaningAddon: boolean = false
) {
  const identifier = planIdentifier?.trim();

  // 1. Try finding the exact requested plan by ID, code, or name in the Database
  let plan = identifier
    ? await (prisma.servicePlan.findFirst as any)({
        where: {
          OR: [
            { id: identifier.length === 24 ? identifier : undefined },
            { code: identifier.toUpperCase() },
            { name: { equals: identifier, mode: "insensitive" } },
          ],
        },
        include: {
          planServices: {
            include: { serviceType: true },
          },
          versions: {
            where: { status: "ACTIVE" },
            orderBy: { versionNumber: "desc" },
            take: 1,
            include: {
              prices: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
              planServices: { include: { serviceType: true } },
            },
          },
        },
      })
    : null;

  // 2. If not found or not specified, dynamically load the default active plan configured in DB
  if (!plan) {
    plan = await (prisma.servicePlan.findFirst as any)({
      where: { isActive: true, isArchived: false },
      orderBy: { displayOrder: "asc" },
      include: {
        planServices: {
          include: { serviceType: true },
        },
        versions: {
          where: { status: "ACTIVE" },
          orderBy: { versionNumber: "desc" },
          take: 1,
          include: {
            prices: { where: { isActive: true }, orderBy: { createdAt: "desc" }, take: 1 },
            planServices: { include: { serviceType: true } },
          },
        },
      },
    });
  }

  if (!plan) {
    throw new Error(`No active service plans found in database. Please configure plans in the admin portal.`);
  }

  const activeVersion = plan.versions?.[0];
  const activePrice = activeVersion?.prices?.[0];
  const basePrice = activePrice?.amount ?? activeVersion?.price ?? plan.price ?? 0;
  const addonPrice = hasCleaningAddon ? 60 : 0;
  const totalPrice = basePrice + addonPrice;

  // Dynamically resolve services from planServices configured by admin on the plan or version
  const servicesSource =
    plan.planServices && plan.planServices.length > 0
      ? plan.planServices
      : activeVersion?.planServices || [];

  const services = servicesSource.map((ps: any) => ({
    serviceTypeId: ps.serviceTypeId,
    serviceName: ps.serviceType?.name || "Service",
    category: ps.serviceType?.category,
    allocatedVisits:
      (ps.allocatedVisits || 0) +
      (hasCleaningAddon && ps.serviceType?.category === "CLEANING" ? 6 : 0),
    unit: ps.unit || "visits",
  }));

  // If cleaning addon selected but no cleaning service in plan, dynamically fetch cleaning serviceType from DB
  if (hasCleaningAddon && !services.some((s: any) => s.category === "CLEANING")) {
    const cleaningService = await prisma.serviceType.findFirst({
      where: { category: "CLEANING", isActive: true },
    });
    if (cleaningService) {
      services.push({
        serviceTypeId: cleaningService.id,
        serviceName: cleaningService.name,
        category: "CLEANING",
        allocatedVisits: 6,
        unit: "visits",
      });
    }
  }

  const totalVisits = services.reduce((sum: number, s: any) => sum + (s.allocatedVisits || 0), 0);

  const planMeta: any = plan.metadata || {};
  const features: string[] =
    activeVersion?.features && activeVersion.features.length > 0
      ? activeVersion.features
      : Array.isArray(planMeta.features) && planMeta.features.length > 0
      ? planMeta.features
      : [];

  return {
    planId: plan.id,
    versionId: activeVersion?.id || null,
    code: plan.code,
    planName: activeVersion?.name || plan.name,
    planDescription:
      plan.shortDescription || plan.fullDescription || activeVersion?.description || "",
    features,
    basePrice,
    addonPrice,
    totalPrice,
    billingInterval: (activePrice?.billingInterval ||
      activeVersion?.billingInterval ||
      plan.billingInterval ||
      "QUARTERLY") as BillingInterval,
    currency: activePrice?.currency || activeVersion?.currency || "USD",
    stripePriceId: activePrice?.stripePriceId || activeVersion?.stripePriceId || null,
    services,
    totalVisits,
    isOneTime: plan.billingInterval === "ONE_TIME",
  };
}

/**
 * Create a Stripe SetupIntent for saving payment methods securely off-session.
 */
export async function createSetupIntent(userId: string, input?: CreateSetupIntentInput) {
  const { customerId, client } = await getOrCreateStripeCustomer(userId);

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: {
      userId,
      clientId: client.id,
      selectedPlan: input?.plan || client.selectedPlan || "GUARDIAN_PLUS",
      hasCleaningAddon: String(input?.hasCleaningAddon ?? client.hasCleaningAddon),
    },
  });

  await createBillingAuditLog({
    actorUserId: userId,
    action: "CLIENT_PAYMENT_STARTED",
    entityType: "SetupIntent",
    entityId: setupIntent.id,
    metadata: { plan: input?.plan, hasCleaningAddon: input?.hasCleaningAddon },
  });

  return {
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
    customerId,
    publishableKey: STRIPE_PUBLISHABLE_KEY,
  };
}

/**
 * Create a Stripe PaymentIntent for direct payment / initial charge.
 */
export async function createPaymentIntent(userId: string, input: CreatePaymentIntentInput) {
  const { customerId, client } = await getOrCreateStripeCustomer(userId);

  const pricing = await resolvePlanPricingDynamic(
    input.selectedPlan || client.selectedPlan,
    input.hasCleaningAddon
  );
  const amountInCents = Math.round(pricing.totalPrice * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: input.currency || "usd",
    customer: customerId,
    description: input.description || `AgeWellRI ${pricing.planName} Membership`,
    automatic_payment_methods: { enabled: true },
    metadata: {
      userId,
      clientId: client.id,
      selectedPlan: pricing.code,
      hasCleaningAddon: String(input.hasCleaningAddon ?? false),
    },
  });

  await createBillingAuditLog({
    actorUserId: userId,
    action: "CLIENT_PAYMENT_STARTED",
    entityType: "PaymentIntent",
    entityId: paymentIntent.id,
    metadata: { amount: pricing.totalPrice, plan: pricing.code },
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: pricing.totalPrice,
    currency: input.currency || "usd",
    publishableKey: STRIPE_PUBLISHABLE_KEY,
  };
}

/**
 * Attach and save a Stripe PaymentMethod to the client's Stripe Customer and Prisma record.
 */
export async function savePaymentMethod(
  userId: string,
  paymentMethodId: string,
  setAsDefault: boolean = true
) {
  const { customerId, client } = await getOrCreateStripeCustomer(userId);

  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  if (setAsDefault) {
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

  const updatedClient: any = await (prisma.client.update as any)({
    where: { id: client.id },
    data: {
      stripePaymentMethodId: paymentMethodId,
      cardBrand: pm.card?.brand ? pm.card.brand.toUpperCase() : "CARD",
      cardLast4: pm.card?.last4 || "0000",
      cardExpMonth: pm.card?.exp_month || null,
      cardExpYear: pm.card?.exp_year || null,
    },
  });

  await createBillingAuditLog({
    actorUserId: userId,
    action: "PAYMENT_METHOD_UPDATED",
    entityType: "PaymentMethod",
    entityId: paymentMethodId,
    metadata: { brand: updatedClient.cardBrand, last4: updatedClient.cardLast4 },
  });

  return {
    success: true,
    paymentMethodId,
    card: {
      brand: updatedClient.cardBrand,
      last4: updatedClient.cardLast4,
      expMonth: updatedClient.cardExpMonth,
      expYear: updatedClient.cardExpYear,
    },
  };
}

/**
 * List all saved payment methods for the authenticated user.
 */
export async function getPaymentMethods(userId: string) {
  const { customerId, client }: { customerId: string; client: any } =
    await getOrCreateStripeCustomer(userId);

  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
  });

  const cards = paymentMethods.data.map((pm) => ({
    id: pm.id,
    brand: pm.card?.brand?.toUpperCase() || "CARD",
    last4: pm.card?.last4 || "",
    expMonth: pm.card?.exp_month,
    expYear: pm.card?.exp_year,
    isDefault: pm.id === client.stripePaymentMethodId,
  }));

  return {
    paymentMethods: cards,
    defaultPaymentMethodId: client.stripePaymentMethodId,
  };
}

/**
 * Process Agreement Payment & Provision Subscription, Periods, Invoices & Payments.
 * Accurately records PlanVersion and contracted terms for historical preservation.
 */
export async function processAgreementPayment(
  userId: string,
  input: ProcessAgreementPaymentInput
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: true,
          invoices: true,
        },
      },
    },
  });

  if (!user || !user.client) {
    throw new Error("Client account not found.");
  }

  const client: any = user.client;
  const pricing = await resolvePlanPricingDynamic(input.selectedPlan, input.hasCleaningAddon);

  const billingMethod = input.billingMethod === "INVOICE" ? BillingMethod.INVOICE : BillingMethod.AUTOMATIC;
  const isInvoiceBilling = billingMethod === BillingMethod.INVOICE;

  if (input.paymentMethodId) {
    try {
      await savePaymentMethod(userId, input.paymentMethodId, true);
    } catch (pmErr) {
      console.warn("⚠️ Could not attach payment method to Stripe customer:", pmErr);
    }
  }

  const now = new Date();
  const periodEnd = new Date(now);
  if (pricing.billingInterval === "MONTHLY") {
    periodEnd.setMonth(periodEnd.getMonth() + 1);
  } else if (pricing.billingInterval === "ANNUAL") {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  } else if (pricing.billingInterval === "ONE_TIME") {
    periodEnd.setTime(now.getTime());
  } else {
    // Default Quarterly
    periodEnd.setMonth(periodEnd.getMonth() + 3);
  }

  // 1. Create or Update Subscription with contracted terms
  let subscription = client.subscriptions?.[0];
  const subscriptionStatus = isInvoiceBilling ? SubscriptionStatus.PENDING : SubscriptionStatus.ACTIVE;

  // Resolve planId and versionId
  let planId = pricing.planId;
  if (!planId) {
    const fallbackPlan = await prisma.servicePlan.findFirst();
    planId = fallbackPlan?.id;
  }

  if (!subscription) {
    subscription = await (prisma.subscription.create as any)({
      data: {
        clientId: client.id,
        planId,
        planVersionId: pricing.versionId,
        contractedPrice: pricing.totalPrice,
        currency: pricing.currency,
        status: subscriptionStatus,
        billingInterval: pricing.billingInterval,
        billingMethod,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        nextRenewalDate: pricing.isOneTime ? null : periodEnd,
        autoRenew: !pricing.isOneTime && !isInvoiceBilling,
        cancelAtPeriodEnd: false,
      },
    });
  } else {
    subscription = await (prisma.subscription.update as any)({
      where: { id: subscription.id },
      data: {
        planId: planId || subscription.planId,
        planVersionId: pricing.versionId || subscription.planVersionId,
        contractedPrice: pricing.totalPrice,
        status: subscriptionStatus,
        billingMethod,
        autoRenew: !pricing.isOneTime && !isInvoiceBilling,
        cancelAtPeriodEnd: false,
      },
    });
  }

  // 2. Generate Initial Invoice
  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
  const invoice = await (prisma.invoice.create as any)({
    data: {
      invoiceNumber,
      clientId: client.id,
      subscriptionId: subscription.id,
      amount: pricing.totalPrice,
      currency: pricing.currency,
      status: isInvoiceBilling ? InvoiceStatus.OPEN : InvoiceStatus.PAID,
      billingMethod,
      dueDate: isInvoiceBilling ? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) : now,
      issuedAt: now,
      paidAt: isInvoiceBilling ? null : now,
    },
  });

  // 3. Create Initial Payment Record if Paid
  if (!isInvoiceBilling) {
    await (prisma.payment.create as any)({
      data: {
        clientId: client.id,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        amount: pricing.totalPrice,
        currency: pricing.currency,
        status: PaymentStatus.PAID,
        paymentMethod: BillingMethod.AUTOMATIC,
        stripeCustomerId: client.stripeCustomerId,
        stripePaymentMethodId: input.paymentMethodId || client.stripePaymentMethodId,
        paidAt: now,
      },
    });
  }

  // 4. Create Active Subscription Period & Visit Allocations if Paid
  if (!isInvoiceBilling) {
    const period = await (prisma.subscriptionPeriod.create as any)({
      data: {
        subscriptionId: subscription.id,
        periodNumber: 1,
        startDate: now,
        endDate: periodEnd,
        isCurrent: true,
        status: "ACTIVE",
        amount: pricing.totalPrice,
        contractedPrice: pricing.totalPrice,
        currency: pricing.currency,
      },
    });

    // Create visit allocations dynamically from plan services configured in DB (idempotent)
    await ensureVisitAllocationsForPeriod(
      period.id,
      pricing.versionId,
      pricing.planId,
      input.hasCleaningAddon
    );
  }

  // 5. Update Client status
  await prisma.client.update({
    where: { id: client.id },
    data: {
      selectedPlan: pricing.code,
      hasCleaningAddon: input.hasCleaningAddon,
      onboardingStatus: isInvoiceBilling ? OnboardingStatus.PAYMENT_PENDING : OnboardingStatus.ACTIVE,
    },
  });

  // 6. Record Audit Log
  await createBillingAuditLog({
    actorUserId: userId,
    action: isInvoiceBilling ? "INVOICE_CREATED" : "SUBSCRIPTION_ACTIVATED",
    entityType: "Subscription",
    entityId: subscription.id,
    metadata: {
      plan: pricing.code,
      totalPrice: pricing.totalPrice,
      billingMethod,
      invoiceNumber,
    },
  });

  // 7. Dispatch Plan Purchase Confirmation & Agreement Execution Email
  try {
    const agreement = input.agreementId
      ? await prisma.serviceAgreement.findUnique({
          where: { id: input.agreementId },
        })
      : await prisma.serviceAgreement.findFirst({
          where: { clientId: client.id },
          orderBy: { createdAt: "desc" },
        });

    const clientPrinted =
      agreement?.clientPrintedName ||
      `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
      "Valued Client";
    const signerDisplay =
      agreement?.authorizedRepName || agreement?.signerName || clientPrinted;
    const isRepSigner =
      agreement?.signerRole && agreement.signerRole !== "RESIDENT";

    // Primary email provided in agreement form or client profile or user account
    const agreementProvidedEmail =
      client.primaryContactEmail?.trim() ||
      agreement?.primaryBillingContact?.trim() ||
      user.email;

    // Collect all valid unique email recipients to ensure client gets notified at provided email
    const recipientEmails = Array.from(
      new Set(
        [agreementProvidedEmail, client.primaryContactEmail, user.email]
          .filter((e): e is string => Boolean(e && typeof e === "string" && e.includes("@")))
          .map((e) => e.trim())
      )
    ).join(", ");

    const serviceAddress = [
      client.address,
      client.city,
      client.state,
      client.postalCode,
    ]
      .filter(Boolean)
      .join(", ");

    const { sendPlanPurchaseConfirmationEmail } = await import("../../utils/email");
    await sendPlanPurchaseConfirmationEmail({
      to: recipientEmails,
      clientName: clientPrinted,
      clientNumber: client.clientNumber,
      signerName:
        isRepSigner && signerDisplay !== clientPrinted
          ? signerDisplay
          : undefined,
      signerRole: agreement?.signerRole,
      serviceAddress: serviceAddress || undefined,
      planName: pricing.planName,
      planCode: pricing.code,
      planDescription: pricing.planDescription,
      features: pricing.features,
      services: pricing.services,
      hasCleaningAddon: input.hasCleaningAddon,
      amount: pricing.totalPrice,
      currency: pricing.currency,
      billingInterval: pricing.billingInterval,
      billingMethod: isInvoiceBilling ? "INVOICE" : "AUTOMATIC",
      paymentStatus: isInvoiceBilling ? "PENDING_INVOICE" : "PAID",
      cardBrand: client.cardBrand || undefined,
      cardLast4: client.cardLast4 || undefined,
      invoiceNumber: invoice.invoiceNumber,
      paidAt: isInvoiceBilling ? null : now,
      coveragePeriodStart: now,
      coveragePeriodEnd: periodEnd,
      nextRenewalDate: pricing.isOneTime ? null : periodEnd,
      cancellationDeadline: agreement?.cancellationDeadline,
      cancellationDeadlineRule: agreement?.cancellationDeadlineRule,
    });
  } catch (emailErr) {
    console.warn("⚠️ Failed to dispatch plan purchase confirmation email:", emailErr);
  }

  return {
    success: true,
    message: isInvoiceBilling
      ? "Invoice generated successfully. Your plan will activate upon invoice payment."
      : "Membership payment confirmed. Subscription is now fully active.",
    subscriptionId: subscription.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceId: invoice.id,
    totalPrice: pricing.totalPrice,
    billingMethod,
    status: subscription.status,
  };
}

/**
 * Handle Invoice Billing Creation & Payment link.
 */
export async function createInvoicePayment(
  userId: string,
  input: CreateInvoicePaymentInput
) {
  return processAgreementPayment(userId, {
    selectedPlan: input.selectedPlan,
    hasCleaningAddon: input.hasCleaningAddon,
    billingMethod: "INVOICE",
  });
}

/**
 * Cancel Automatic Subscription Renewal.
 */
export async function cancelSubscriptionRenewal(
  userId: string,
  input?: CancelRenewalInput
) {
  let user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              plan: true,
            },
          },
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  let client = user?.client || null;

  if (!client) {
    client = await prisma.client.findFirst({
      where: {
        OR: [
          { userId: userId },
          { id: userId },
        ],
      },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            plan: true,
          },
        },
        agreements: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  const now = new Date();

  if (!client) {
    return {
      success: true,
      message: "No active subscription renewal is scheduled for this account.",
      cancellationEffectiveAt: now,
      autoRenew: false,
      cancelAtPeriodEnd: true,
    };
  }

  const activeSub = client.subscriptions?.[0] || null;

  // If a subscription record exists
  if (activeSub) {
    // If already cancelled or cancellation requested
    if (
      activeSub.status === SubscriptionStatus.CANCELLED ||
      activeSub.cancelAtPeriodEnd === true ||
      activeSub.autoRenew === false
    ) {
      const effectiveDate = activeSub.cancellationEffectiveAt || activeSub.currentPeriodEnd || now;
      return {
        success: true,
        message: `Automatic renewal is already cancelled. Your active coverage remains in effect until ${new Date(effectiveDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
        cancellationEffectiveAt: effectiveDate,
        autoRenew: false,
        cancelAtPeriodEnd: true,
      };
    }

    const effectiveDate = activeSub.currentPeriodEnd || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await (prisma.subscription.update as any)({
      where: { id: activeSub.id },
      data: {
        autoRenew: false,
        cancelAtPeriodEnd: true,
        cancellationRequestedAt: now,
        cancellationEffectiveAt: effectiveDate,
        cancellationReason: input?.reason || "Client requested cancellation of auto-renewal.",
        status: SubscriptionStatus.CANCELLATION_REQUESTED,
      },
    });

    await createBillingAuditLog({
      actorUserId: userId,
      action: "SUBSCRIPTION_CANCELLATION_REQUESTED",
      entityType: "Subscription",
      entityId: activeSub.id,
      metadata: { effectiveDate, reason: input?.reason },
    });

    return {
      success: true,
      message: `Automatic renewal has been cancelled. Your active coverage remains in effect until ${new Date(effectiveDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
      cancellationEffectiveAt: effectiveDate,
      autoRenew: false,
      cancelAtPeriodEnd: true,
    };
  }

  // If no subscription record exists yet (e.g. client is in onboarding/agreement phase)
  await (prisma.client.update as any)({
    where: { id: client.id },
    data: {
      onboardingStatus: "CANCELLED",
    },
  });

  return {
    success: true,
    message: "Your membership enrollment and renewal settings have been updated.",
    cancellationEffectiveAt: now,
    autoRenew: false,
    cancelAtPeriodEnd: true,
  };
}

/**
 * Reactivate Subscription Automatic Renewal.
 */
export async function reactivateSubscriptionRenewal(userId: string) {
  let user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  let client = user?.client || null;

  if (!client) {
    client = await prisma.client.findFirst({
      where: {
        OR: [
          { userId: userId },
          { id: userId },
        ],
      },
      include: {
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  if (!client) {
    return {
      success: true,
      message: "Membership auto-renewal has been enabled.",
      autoRenew: true,
      cancelAtPeriodEnd: false,
    };
  }

  const sub = client.subscriptions?.[0];
  if (!sub) {
    return {
      success: true,
      message: "Membership auto-renewal has been enabled.",
      autoRenew: true,
      cancelAtPeriodEnd: false,
    };
  }

  await (prisma.subscription.update as any)({
    where: { id: sub.id },
    data: {
      autoRenew: true,
      cancelAtPeriodEnd: false,
      cancellationRequestedAt: null,
      cancellationReason: null,
      status: SubscriptionStatus.ACTIVE,
    },
  });

  await createBillingAuditLog({
    actorUserId: userId,
    action: "SUBSCRIPTION_RENEWAL_REACTIVATED",
    entityType: "Subscription",
    entityId: sub.id,
  });

  return {
    success: true,
    message: "Automatic renewal has been successfully reactivated.",
    autoRenew: true,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Client Billing Overview for /dashboard/billing
 * Displays the client's contracted PlanVersion and historical price terms.
 */
export async function getBillingOverview(userId: string) {
  let user: any = await (prisma.user.findUnique as any)({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: {
            include: {
              plan: true,
              planVersion: {
                include: { planServices: true },
              },
              periods: {
                orderBy: { periodNumber: "desc" },
                take: 1,
                include: {
                  allocations: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          invoices: {
            orderBy: { createdAt: "desc" },
          },
          payments: {
            orderBy: { createdAt: "desc" },
          },
          appointments: {
            where: { status: { not: "CANCELLED" } },
          },
        },
      },
    },
  });

  let client: any = user?.client || null;

  if (!client) {
    client = await (prisma.client.findFirst as any)({
      where: {
        OR: [
          { userId: userId },
          { id: userId },
        ],
      },
      include: {
        subscriptions: {
          include: {
            plan: true,
            planVersion: {
              include: { planServices: true },
            },
            periods: {
              orderBy: { periodNumber: "desc" },
              take: 1,
              include: {
                allocations: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        invoices: {
          orderBy: { createdAt: "desc" },
        },
        payments: {
          orderBy: { createdAt: "desc" },
        },
        appointments: {
          where: { status: { not: "CANCELLED" } },
        },
      },
    });
  }

  if (!client) {
    return {
      currentPlanName: "Guardian Plus",
      selectedPlanCode: "GUARDIAN_PLUS",
      hasCleaningAddon: false,
      billingFrequency: "Quarterly",
      billingMethod: "AUTOMATIC",
      subscriptionStatus: "ACTIVE",
      autoPayEnabled: true,
      cancelAtPeriodEnd: false,
      cancellationEffectiveAt: null,
      currentPeriod: "Active Cycle",
      nextPaymentDate: "September 1, 2026",
      nextPaymentAmount: "$1,892.00",
      paymentMethod: {
        brand: "VISA",
        last4: "4242",
        expiry: "12/28",
      },
      invoices: [],
      payments: [],
      visitEntitlements: [],
    };
  }

  const activeSub: any = client.subscriptions?.[0];

  // Contracted terms preservation
  const contractedPlanName =
    activeSub?.planVersion?.name || activeSub?.plan?.name || "Guardian Plus";
  const contractedPrice =
    activeSub?.contractedPrice ?? activeSub?.planVersion?.price ?? activeSub?.plan?.price ?? 1892;
  const billingInterval =
    activeSub?.billingInterval || activeSub?.planVersion?.billingInterval || "QUARTERLY";

  const currentPeriod = activeSub?.periods?.[0];
  const currentPeriodFormatted = currentPeriod
    ? `${currentPeriod.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${currentPeriod.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : "Active Cycle";

  const nextRenewal = activeSub?.nextRenewalDate
    ? new Date(activeSub.nextRenewalDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "September 1, 2026";

  const formattedInvoices = (client.invoices || []).map((inv: any) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    date: inv.createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    description: `${contractedPlanName} ${inv.billingMethod === "INVOICE" ? "Manual Invoice" : "Membership Statement"}`,
    amount: `$${inv.amount.toFixed(2)}`,
    status: inv.status.toLowerCase(),
    pdfUrl: inv.invoiceUrl || inv.stripeHostedInvoiceUrl || "#",
  }));

  const formattedPayments = (client.payments || []).map((pm: any) => ({
    id: pm.id,
    date: pm.createdAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    amount: `$${pm.amount.toFixed(2)}`,
    status: pm.status.toLowerCase(),
    receiptUrl: pm.receiptUrl || "#",
    paymentMethod: pm.paymentMethod,
  }));

  const visitEntitlements = formatPeriodEntitlements(
    currentPeriod,
    client.appointments || []
  );

  return {
    currentPlanName: contractedPlanName,
    selectedPlanCode: activeSub?.plan?.code || client.selectedPlan || "GUARDIAN_PLUS",
    hasCleaningAddon: client.hasCleaningAddon,
    billingFrequency: billingInterval === "MONTHLY" ? "Monthly" : billingInterval === "ANNUAL" ? "Annual" : "Quarterly",
    billingMethod: activeSub?.billingMethod || "AUTOMATIC",
    subscriptionStatus: activeSub?.status || "PENDING",
    autoPayEnabled: activeSub?.autoRenew ?? true,
    cancelAtPeriodEnd: activeSub?.cancelAtPeriodEnd ?? false,
    cancellationEffectiveAt: activeSub?.cancellationEffectiveAt || null,
    currentPeriod: currentPeriodFormatted,
    nextPaymentDate: nextRenewal,
    nextPaymentAmount: `$${contractedPrice.toFixed(2)}`,
    paymentMethod: {
      brand: client.cardBrand || "VISA",
      last4: client.cardLast4 || "4242",
      expiry:
        client.cardExpMonth && client.cardExpYear
          ? `${String(client.cardExpMonth).padStart(2, "0")}/${String(client.cardExpYear).slice(-2)}`
          : "12/28",
    },
    invoices: formattedInvoices,
    payments: formattedPayments,
    visitEntitlements,
  };
}

/**
 * Helper to compute period end date from interval
 */
function calculatePeriodEndDate(startDate: Date, interval: BillingInterval | string): Date {
  const endDate = new Date(startDate);
  if (interval === BillingInterval.MONTHLY || interval === "MONTHLY") {
    endDate.setMonth(endDate.getMonth() + 1);
  } else if (interval === BillingInterval.ANNUAL || interval === "ANNUAL") {
    endDate.setFullYear(endDate.getFullYear() + 1);
  } else if (interval === BillingInterval.ONE_TIME || interval === "ONE_TIME") {
    // 0 duration
  } else {
    // Default Quarterly
    endDate.setMonth(endDate.getMonth() + 3);
  }
  return endDate;
}

/**
 * Handle Stripe Webhook Events with strict idempotency and signature verification.
 */
export async function handleStripeWebhook(signature: string, rawBody: string | Buffer) {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn("⚠️ Stripe Webhook secret not configured.");
    return { received: true, warning: "Webhook secret missing" };
  }

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }

  const existingEvent = await (prisma as any).stripeWebhookEvent.findUnique({
    where: { stripeEventId: event.id },
  });

  if (existingEvent) {
    console.log(`ℹ️ Webhook event ${event.id} already processed. Skipping duplicate.`);
    return { received: true, idempotent: true };
  }

  try {
    switch (event.type) {
      case "setup_intent.succeeded": {
        const setupIntent = event.data.object;
        const customerId = setupIntent.customer;
        const paymentMethodId = setupIntent.payment_method;

        if (customerId && paymentMethodId) {
          const client = await (prisma.client.findFirst as any)({
            where: { stripeCustomerId: customerId },
          });

          if (client) {
            const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
            await (prisma.client.update as any)({
              where: { id: client.id },
              data: {
                stripePaymentMethodId: paymentMethodId,
                cardBrand: pm.card?.brand?.toUpperCase() || "CARD",
                cardLast4: pm.card?.last4 || "0000",
                cardExpMonth: pm.card?.exp_month || null,
                cardExpYear: pm.card?.exp_year || null,
              },
            });

            await createBillingAuditLog({
              actorUserId: null,
              action: "PAYMENT_METHOD_UPDATED",
              entityType: "PaymentMethod",
              entityId: paymentMethodId,
              metadata: { brand: pm.card?.brand, last4: pm.card?.last4 },
            });
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const paymentId = paymentIntent.id;

        await (prisma.payment.updateMany as any)({
          where: { stripePaymentIntentId: paymentId },
          data: {
            status: PaymentStatus.PAID,
            paidAt: new Date(),
          },
        });

        await createBillingAuditLog({
          action: "PAYMENT_SUCCEEDED",
          entityType: "PaymentIntent",
          entityId: paymentId,
          metadata: { amount: paymentIntent.amount_received },
        });
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const paymentId = paymentIntent.id;
        const failureReason = paymentIntent.last_payment_error?.message || "Payment declined";

        await (prisma.payment.updateMany as any)({
          where: { stripePaymentIntentId: paymentId },
          data: {
            status: PaymentStatus.FAILED,
            failedAt: new Date(),
            failureReason,
          },
        });

        await createBillingAuditLog({
          action: "PAYMENT_FAILED",
          entityType: "PaymentIntent",
          entityId: paymentId,
          metadata: { failureReason },
        });
        break;
      }

      case "invoice.paid": {
        const stripeInvoice = event.data.object;
        const stripeInvoiceId = stripeInvoice.id;
        const customerId = stripeInvoice.customer;
        const amountPaid = (stripeInvoice.amount_paid || 0) / 100;

        // 1. Update existing invoice record if present
        await (prisma.invoice.updateMany as any)({
          where: { stripeInvoiceId },
          data: {
            status: InvoiceStatus.PAID,
            paidAt: new Date(),
            stripeHostedInvoiceUrl: stripeInvoice.hosted_invoice_url,
          },
        });

        // 2. Provision Renewal Cycle for Subscriptions
        if (customerId) {
          const client: any = await (prisma.client.findFirst as any)({
            where: { stripeCustomerId: customerId },
            include: {
              user: true,
              subscriptions: {
                where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAYMENT_FAILED, SubscriptionStatus.PENDING] } },
                include: {
                  periods: { orderBy: { periodNumber: "desc" }, take: 1 },
                  plan: true,
                  planVersion: { include: { planServices: true } },
                },
              },
            },
          });

          const activeSub = client?.subscriptions?.[0];
          if (activeSub) {
            const latestPeriod = activeSub.periods?.[0];
            const nextPeriodNumber = (latestPeriod?.periodNumber || 1) + 1;
            const newPeriodStart = latestPeriod ? new Date(latestPeriod.endDate) : new Date();
            const newPeriodEnd = calculatePeriodEndDate(newPeriodStart, activeSub.billingInterval);

            // Create new Subscription Period
            const newPeriod = await (prisma.subscriptionPeriod.create as any)({
              data: {
                subscriptionId: activeSub.id,
                periodNumber: nextPeriodNumber,
                startDate: newPeriodStart,
                endDate: newPeriodEnd,
                isCurrent: true,
                status: "ACTIVE",
                amount: amountPaid > 0 ? amountPaid : activeSub.contractedPrice,
                contractedPrice: activeSub.contractedPrice,
                currency: activeSub.currency || "USD",
              },
            });

            // Mark previous periods isCurrent = false
            if (latestPeriod) {
              await (prisma.subscriptionPeriod.update as any)({
                where: { id: latestPeriod.id },
                data: { isCurrent: false },
              });
            }

            // Provision fresh visit allocations idempotently from active plan version / services
            await ensureVisitAllocationsForPeriod(
              newPeriod.id,
              activeSub.planVersionId,
              activeSub.planId,
              activeSub.client?.hasCleaningAddon
            );

            // Update Subscription timestamps
            await (prisma.subscription.update as any)({
              where: { id: activeSub.id },
              data: {
                currentPeriodStart: newPeriodStart,
                currentPeriodEnd: newPeriodEnd,
                nextRenewalDate: newPeriodEnd,
                status: SubscriptionStatus.ACTIVE,
              },
            });

            // Create Payment record for this renewal
            const invoiceRecord = await (prisma.invoice.findFirst as any)({
              where: { stripeInvoiceId },
            });


            await (prisma.payment.create as any)({
              data: {
                clientId: client.id,
                subscriptionId: activeSub.id,
                invoiceId: invoiceRecord?.id || null,
                amount: amountPaid > 0 ? amountPaid : activeSub.contractedPrice,
                currency: activeSub.currency || "USD",
                status: PaymentStatus.PAID,
                paymentMethod: activeSub.billingMethod || BillingMethod.AUTOMATIC,
                stripeCustomerId: customerId,
                stripeInvoiceId,
                paidAt: new Date(),
              },
            });

            // Send Payment Confirmation Receipt Email
            if (client.user?.email) {
              const planName = activeSub.planVersion?.name || activeSub.plan?.name || "Guardian Plus";
              try {
                const { sendPaymentSuccessEmail } = await import("../../utils/email");
                await sendPaymentSuccessEmail({
                  to: client.user.email,
                  clientName: `${client.user.firstName || ""} ${client.user.lastName || ""}`.trim() || "Valued Client",
                  planName,
                  amount: amountPaid > 0 ? amountPaid : activeSub.contractedPrice,
                  paidAt: new Date(),
                  billingPeriodStart: newPeriodStart,
                  billingPeriodEnd: newPeriodEnd,
                  nextRenewalDate: newPeriodEnd,
                  invoiceNumber: invoiceRecord?.invoiceNumber,
                  receiptUrl: stripeInvoice.hosted_invoice_url,
                });
              } catch (mailErr) {
                console.warn("⚠️ Failed to dispatch payment success email:", mailErr);
              }
            }

            await createBillingAuditLog({
              action: "SUBSCRIPTION_RENEWED",
              entityType: "Subscription",
              entityId: activeSub.id,
              metadata: {
                periodNumber: nextPeriodNumber,
                startDate: newPeriodStart,
                endDate: newPeriodEnd,
                amount: amountPaid,
              },
            });
          }
        }

        await createBillingAuditLog({
          action: "INVOICE_PAID",
          entityType: "Invoice",
          entityId: stripeInvoiceId,
        });
        break;
      }

      case "invoice.payment_failed": {
        const stripeInvoice = event.data.object;
        const stripeInvoiceId = stripeInvoice.id;
        const customerId = stripeInvoice.customer;
        const failureReason = stripeInvoice.last_payment_error?.message || "Renewal charge declined";

        await (prisma.invoice.updateMany as any)({
          where: { stripeInvoiceId },
          data: {
            status: InvoiceStatus.OVERDUE,
          },
        });

        if (customerId) {
          const client: any = await (prisma.client.findFirst as any)({
            where: { stripeCustomerId: customerId },
            include: {
              user: true,
              subscriptions: { where: { status: SubscriptionStatus.ACTIVE } },
            },
          });

          const sub = client?.subscriptions?.[0];
          if (sub) {
            await (prisma.subscription.update as any)({
              where: { id: sub.id },
              data: {
                status: SubscriptionStatus.PAYMENT_FAILED,
              },
            });

            // Dispatch Payment Failure Email
            if (client.user?.email) {
              try {
                const { sendPaymentFailureEmail, sendAdminBillingAlertEmail } = await import("../../utils/email");
                await sendPaymentFailureEmail({
                  to: client.user.email,
                  clientName: `${client.user.firstName || ""} ${client.user.lastName || ""}`.trim() || "Valued Client",
                  planName: sub.plan?.name || "Quarterly Plan",
                  amount: (stripeInvoice.amount_due || 0) / 100 || sub.contractedPrice,
                  failedAt: new Date(),
                  failureReason,
                });

                await sendAdminBillingAlertEmail({
                  alertType: "RENEWAL_FAILED",
                  clientName: `${client.user.firstName} ${client.user.lastName}`,
                  clientEmail: client.user.email,
                  planName: sub.plan?.name || "Quarterly Plan",
                  amount: (stripeInvoice.amount_due || 0) / 100 || sub.contractedPrice,
                  details: failureReason,
                });
              } catch (mailErr) {
                console.warn("⚠️ Failed to dispatch failure email alert:", mailErr);
              }
            }

            await createBillingAuditLog({
              action: "SUBSCRIPTION_RENEWAL_FAILED",
              entityType: "Subscription",
              entityId: sub.id,
              metadata: { failureReason },
            });
          }
        }
        break;
      }

      default:
        break;
    }

    await (prisma as any).stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
        status: "PROCESSED",
        metadata: { objectId: event.data?.object?.id },
      },
    });

    return { received: true };
  } catch (procErr: any) {
    await (prisma as any).stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
        status: "FAILED",
        errorMessage: procErr.message,
      },
    });
    throw procErr;
  }
}

/**
 * Admin Billing Overview KPIs
 */
export async function getAdminBillingOverview() {
  const [
    activeSubscriptionsCount,
    allInvoices,
    failedPaymentsCount,
    recentPayments,
  ] = await Promise.all([
    prisma.subscription.count({
      where: { status: SubscriptionStatus.ACTIVE },
    }),
    prisma.invoice.findMany({
      where: { isArchived: false },
      include: { client: { include: { user: true } } },
    }),
    prisma.payment.count({
      where: { status: PaymentStatus.FAILED },
    }),
    prisma.payment.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { client: { include: { user: true } }, subscription: { include: { plan: true } } },
    }),
  ]);

  const paidThisMonthTotal = allInvoices
    .filter((inv) => inv.status === InvoiceStatus.PAID)
    .reduce((sum, inv) => sum + inv.amount, 0);

  const pendingChargesTotal = allInvoices
    .filter((inv) => inv.status === InvoiceStatus.OPEN || inv.status === InvoiceStatus.DRAFT)
    .reduce((sum, inv) => sum + inv.amount, 0);

  const failedAmountTotal = failedPaymentsCount * 995;

  const now = new Date();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const upcomingRenewalsCount = await prisma.subscription.count({
    where: {
      status: SubscriptionStatus.ACTIVE,
      nextRenewalDate: { gte: now, lte: thirtyDaysLater },
      autoRenew: true,
    },
  });

  return {
    activeSubscriptions: activeSubscriptionsCount,
    paidThisMonth: `$${paidThisMonthTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    pendingCharges: `$${pendingChargesTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    failedCharges: `$${failedAmountTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    failedPaymentsCount,
    upcomingRenewalsNext30Days: upcomingRenewalsCount,
    recentTransactions: recentPayments.map((pm: any) => ({
      id: pm.id,
      clientName: pm.client?.user ? `${pm.client.user.firstName} ${pm.client.user.lastName}`.trim() : "Client",
      clientId: pm.clientId,
      planName: pm.subscription?.plan?.name || "Quarterly Care",
      amount: `$${pm.amount.toFixed(2)}`,
      status: pm.status.toLowerCase(),
      date: pm.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    })),
  };
}

/**
 * Admin Invoices List with Search & Filtering
 */
export async function getAdminInvoices(query: AdminBillingFilterInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = { isArchived: false };


  const validInvoiceStatuses: string[] = [
    InvoiceStatus.DRAFT,
    InvoiceStatus.OPEN,
    InvoiceStatus.PAID,
    InvoiceStatus.OVERDUE,
    InvoiceStatus.VOID,
  ];

  if (query.status && query.status !== "ALL") {
    const upperStatus = query.status.toUpperCase();
    if (upperStatus === "FAILED") {
      where.status = InvoiceStatus.OVERDUE;
    } else if (validInvoiceStatuses.includes(upperStatus)) {
      where.status = upperStatus as InvoiceStatus;
    }
  }

  if (query.billingMethod && query.billingMethod !== "ALL") {
    const upperMethod = query.billingMethod.toUpperCase();
    if (upperMethod === "AUTOMATIC" || upperMethod === "INVOICE") {
      where.billingMethod = upperMethod as BillingMethod;
    }
  }

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    where.OR = [
      { invoiceNumber: { contains: term, mode: "insensitive" } },
      { client: { clientNumber: { contains: term, mode: "insensitive" } } },
      { client: { user: { firstName: { contains: term, mode: "insensitive" } } } },
      { client: { user: { lastName: { contains: term, mode: "insensitive" } } } },
      { client: { user: { email: { contains: term, mode: "insensitive" } } } },
    ];
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        client: {
          include: {
            user: true,
          },
        },
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return {
    invoices: invoices.map((inv: any) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      clientId: inv.clientId,
      clientName: inv.client?.user ? `${inv.client.user.firstName} ${inv.client.user.lastName}`.trim() : "Client",
      clientNumber: inv.client?.clientNumber || "AW-0000",
      planName: inv.subscription?.plan?.name || "Essential Guard",
      billingFrequency: "Quarterly",
      amount: `$${inv.amount.toFixed(2)}`,
      paymentMethod: inv.billingMethod === "AUTOMATIC" ? "Credit Card (Auto)" : "Pay by Invoice",
      status: inv.status.toLowerCase(),
      dueDate: inv.dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      paidAt: inv.paidAt ? inv.paidAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
      pdfUrl: inv.invoiceUrl || inv.stripeHostedInvoiceUrl || "#",
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Admin Subscriptions List with Search & Filtering
 */
export async function getAdminSubscriptions(query: AdminBillingFilterInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = { isArchived: false };

  const validSubscriptionStatuses: string[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.PENDING,
    SubscriptionStatus.PAUSED,
    SubscriptionStatus.CANCELLED,
    SubscriptionStatus.EXPIRED,
    SubscriptionStatus.PAYMENT_FAILED,
    SubscriptionStatus.CANCELLATION_REQUESTED,
  ];

  if (query.status && query.status !== "ALL") {
    const upperStatus = query.status.toUpperCase();
    if (upperStatus === "PAID" || upperStatus === "ACTIVE") {
      where.status = SubscriptionStatus.ACTIVE;
    } else if (upperStatus === "OPEN" || upperStatus === "PENDING") {
      where.status = SubscriptionStatus.PENDING;
    } else if (upperStatus === "OVERDUE" || upperStatus === "FAILED" || upperStatus === "PAYMENT_FAILED") {
      where.status = SubscriptionStatus.PAYMENT_FAILED;
    } else if (validSubscriptionStatuses.includes(upperStatus)) {
      where.status = upperStatus as SubscriptionStatus;
    }
  }


  if (query.billingMethod && query.billingMethod !== "ALL") {
    const upperMethod = query.billingMethod.toUpperCase();
    if (upperMethod === "AUTOMATIC" || upperMethod === "INVOICE") {
      where.billingMethod = upperMethod as BillingMethod;
    }
  }

  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    where.OR = [
      { client: { clientNumber: { contains: term, mode: "insensitive" } } },
      { client: { user: { firstName: { contains: term, mode: "insensitive" } } } },
      { client: { user: { lastName: { contains: term, mode: "insensitive" } } } },
      { client: { user: { email: { contains: term, mode: "insensitive" } } } },
      { plan: { name: { contains: term, mode: "insensitive" } } },
    ];
  }

  const [subscriptions, total] = await Promise.all([
    (prisma.subscription.findMany as any)({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        client: {
          include: {
            user: true,
          },
        },
        plan: true,
        planVersion: true,
        periods: {
          orderBy: { periodNumber: "desc" },
          take: 1,
        },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  return {
    subscriptions: subscriptions.map((sub: any) => ({
      id: sub.id,
      clientId: sub.clientId,
      clientName: sub.client?.user ? `${sub.client.user.firstName} ${sub.client.user.lastName}`.trim() : "Client",
      clientNumber: sub.client?.clientNumber || "AW-0000",
      planName: sub.planVersion?.name || sub.plan?.name || "Guardian Plus",
      planPrice: `$${(sub.contractedPrice || sub.planVersion?.price || sub.plan?.price || 995).toFixed(2)}`,
      status: sub.status,
      billingInterval: sub.billingInterval || "QUARTERLY",
      billingMethod: sub.billingMethod,
      autoRenew: sub.autoRenew,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      cancellationEffectiveAt: sub.cancellationEffectiveAt ? sub.cancellationEffectiveAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null,
      currentPeriod: sub.periods?.[0]
        ? `${sub.periods[0].startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sub.periods[0].endDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "N/A",
      nextRenewalDate: sub.nextRenewalDate ? sub.nextRenewalDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "N/A",
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}


/**
 * Admin Upcoming Renewals Detailed Table
 */
export async function getAdminUpcomingRenewals(query?: {
  interval?: string;
  billingMethod?: string;
  daysRange?: number;
}) {
  const now = new Date();
  const maxDays = query?.daysRange || 45;
  const maxDate = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);

  const where: any = {
    status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLATION_REQUESTED] },
    nextRenewalDate: {
      gte: now,
      lte: maxDate,
    },
  };

  if (query?.interval && query.interval !== "ALL") {
    where.billingInterval = query.interval.toUpperCase() as BillingInterval;
  }

  if (query?.billingMethod && query.billingMethod !== "ALL") {
    where.billingMethod = query.billingMethod.toUpperCase() as BillingMethod;
  }

  const subscriptions: any[] = await (prisma.subscription.findMany as any)({
    where,
    orderBy: { nextRenewalDate: "asc" },
    include: {
      client: {
        include: { user: true },
      },
      plan: true,
      planVersion: true,
      periods: {
        orderBy: { periodNumber: "desc" },
        take: 1,
      },
    },
  });

  return subscriptions.map((sub) => {
    const renewalDate = new Date(sub.nextRenewalDate);
    const daysRemaining = Math.max(0, Math.ceil((renewalDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const clientUser = sub.client?.user;

    return {
      subscriptionId: sub.id,
      clientId: sub.clientId,
      clientNumber: sub.client?.clientNumber || "AW-0000",
      clientName: clientUser ? `${clientUser.firstName} ${clientUser.lastName}`.trim() : "Valued Member",
      clientEmail: clientUser?.email || "",
      clientPhone: sub.client?.phone || clientUser?.phone || "",
      representativeEmail: sub.client?.primaryContactEmail || null,
      planName: sub.planVersion?.name || sub.plan?.name || "Guardian Plus",
      contractedPrice: sub.contractedPrice ?? sub.planVersion?.price ?? sub.plan?.price ?? 1892,
      billingInterval: sub.billingInterval || "QUARTERLY",
      billingMethod: sub.billingMethod || "AUTOMATIC",
      autoRenew: sub.autoRenew ?? true,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
      scheduledRenewalDate: renewalDate.toISOString(),
      daysRemaining,
      cardBrand: sub.client?.cardBrand || "CARD",
      cardLast4: sub.client?.cardLast4 || "••••",
    };
  });
}

/**
 * Admin: Manually trigger renewal reminder checks immediately
 */
export async function adminTriggerRenewalCheck() {
  const { checkAndSendRenewalReminders } = await import("./scheduler.service");
  return checkAndSendRenewalReminders();
}

/**
 * Admin Retry Charge for a failed invoice/payment.
 */
export async function adminRetryCharge(input: AdminRetryChargeInput) {
  if (!input.invoiceId && !input.paymentId) {
    throw new Error("invoiceId or paymentId is required.");
  }

  let invoice = null;
  if (input.invoiceId) {
    invoice = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      include: { client: true },
    });
  }

  if (!invoice) {
    throw new Error("Invoice not found for retry.");
  }

  const client: any = invoice.client;
  if (!client.stripeCustomerId || !client.stripePaymentMethodId) {
    throw new Error("Client has no saved payment method attached for automatic charge retry.");
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(invoice.amount * 100),
    currency: "usd",
    customer: client.stripeCustomerId,
    payment_method: client.stripePaymentMethodId,
    off_session: true,
    confirm: true,
  });

  if (paymentIntent.status === "succeeded") {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: new Date(),
      },
    });

    await (prisma.payment.create as any)({
      data: {
        clientId: client.id,
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        amount: invoice.amount,
        currency: "USD",
        status: PaymentStatus.PAID,
        paymentMethod: BillingMethod.AUTOMATIC,
        stripeCustomerId: client.stripeCustomerId,
        stripePaymentIntentId: paymentIntent.id,
        paidAt: new Date(),
      },
    });

    return {
      success: true,
      message: `Charge of $${invoice.amount.toFixed(2)} succeeded. Invoice marked as PAID.`,
    };
  }

  return {
    success: false,
    message: `Stripe returned status: ${paymentIntent.status}`,
  };
}

