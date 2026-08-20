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
} from "./payment.validation";

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
 * Create a Stripe SetupIntent for saving payment methods securely off-session
 * (used during client service agreement signing for recurring quarterly membership).
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
      selectedPlan: input?.plan || client.selectedPlan || "ESSENTIAL_GUARD",
      hasCleaningAddon: String(input?.hasCleaningAddon ?? client.hasCleaningAddon),
    },
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

  const amountInCents = Math.round(input.amount * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: input.currency || "usd",
    customer: customerId,
    description: input.description || "AgeWellRI Safety Oversight Membership",
    automatic_payment_methods: { enabled: true },
    metadata: {
      userId,
      clientId: client.id,
      selectedPlan: input.selectedPlan || client.selectedPlan || "ESSENTIAL_GUARD",
    },
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    amount: input.amount,
    currency: input.currency || "usd",
    publishableKey: STRIPE_PUBLISHABLE_KEY,
  };
}

/**
 * Attach and save a Stripe PaymentMethod (pm_...) to the client's Stripe Customer and Prisma record.
 */
export async function savePaymentMethod(
  userId: string,
  paymentMethodId: string,
  setAsDefault: boolean = true
) {
  const { customerId, client } = await getOrCreateStripeCustomer(userId);

  // Attach PaymentMethod to Customer in Stripe
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  // Set as default payment method on Stripe Customer
  if (setAsDefault) {
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  // Retrieve card metadata
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

  // Update Client model with stored card metadata
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
 * Helper to ensure ServicePlan and ServiceTypes exist in the database for subscription provisioning.
 */
async function ensurePlansAndServices() {
  // 1. Safety Oversight service type
  const safetyService = await prisma.serviceType.upsert({
    where: { name: "Safety Oversight" },
    update: {},
    create: {
      name: "Safety Oversight",
      category: ServiceTypeCategory.SAFETY_OVERSIGHT,
      description: "Quarterly or bi-weekly home safety audits, hazard checks and wellness reports.",
    },
  });

  // 2. Cleaning service type
  const cleaningService = await prisma.serviceType.upsert({
    where: { name: "Home Cleaning" },
    update: {},
    create: {
      name: "Home Cleaning",
      category: ServiceTypeCategory.CLEANING,
      description: "HEPA allergen vacuuming, pathway clearing, kitchen & living area maintenance.",
    },
  });

  // 3. Essential Guard plan ($995/quarter · 6 visits/quarter: 6 safety oversight visits, no cleanings)
  const essentialPlan = await prisma.servicePlan.upsert({
    where: { code: "ESSENTIAL_GUARD" },
    update: { price: 995, name: "Essential Guard" },
    create: {
      name: "Essential Guard",
      code: "ESSENTIAL_GUARD",
      description: "Essential Guard (6 visits/quarter: 6 safety oversight visits, no cleanings).",
      price: 995,
      billingInterval: BillingInterval.QUARTERLY,
      isActive: true,
    },
  });

  await prisma.planService.upsert({
    where: {
      planId_serviceTypeId: {
        planId: essentialPlan.id,
        serviceTypeId: safetyService.id,
      },
    },
    update: { allocatedVisits: 6 },
    create: {
      planId: essentialPlan.id,
      serviceTypeId: safetyService.id,
      allocatedVisits: 6,
    },
  });

  // 4. Guardian Plus plan ($1,892/quarter · 12 visits/quarter: 6 safety + 6 cleaning)
  const guardianPlan = await prisma.servicePlan.upsert({
    where: { code: "GUARDIAN_PLUS" },
    update: { price: 1892, name: "Guardian Plus" },
    create: {
      name: "Guardian Plus",
      code: "GUARDIAN_PLUS",
      description: "Guardian Plus (12 visits/quarter: 6 cleaning and 6 safety oversight visits).",
      price: 1892,
      billingInterval: BillingInterval.QUARTERLY,
      isActive: true,
    },
  });

  // Guardian Plus: 6 safety visits
  await prisma.planService.upsert({
    where: {
      planId_serviceTypeId: {
        planId: guardianPlan.id,
        serviceTypeId: safetyService.id,
      },
    },
    update: { allocatedVisits: 6 },
    create: {
      planId: guardianPlan.id,
      serviceTypeId: safetyService.id,
      allocatedVisits: 6,
    },
  });

  // Guardian Plus: 6 cleaning visits
  await prisma.planService.upsert({
    where: {
      planId_serviceTypeId: {
        planId: guardianPlan.id,
        serviceTypeId: cleaningService.id,
      },
    },
    update: { allocatedVisits: 6 },
    create: {
      planId: guardianPlan.id,
      serviceTypeId: cleaningService.id,
      allocatedVisits: 6,
    },
  });

  // 5. Standalone One-Time Cleaning ($179 · 1 visit)
  const standaloneCleaningPlan = await prisma.servicePlan.upsert({
    where: { code: "STANDALONE_CLEANING" },
    update: { price: 179, name: "Standalone One-Time Cleaning" },
    create: {
      name: "Standalone One-Time Cleaning",
      code: "STANDALONE_CLEANING",
      description: "A single comprehensive deep cleaning and allergen mitigation visit ($179).",
      price: 179,
      billingInterval: BillingInterval.ONE_TIME,
      isActive: true,
    },
  });

  await prisma.planService.upsert({
    where: {
      planId_serviceTypeId: {
        planId: standaloneCleaningPlan.id,
        serviceTypeId: cleaningService.id,
      },
    },
    update: { allocatedVisits: 1 },
    create: {
      planId: standaloneCleaningPlan.id,
      serviceTypeId: cleaningService.id,
      allocatedVisits: 1,
    },
  });

  return { safetyService, cleaningService, essentialPlan, guardianPlan, standaloneCleaningPlan };
}

/**
 * Process Agreement Payment & Provision Subscription.
 * Links the client's Stripe payment method to their agreement,
 * activates their subscription with period allocations, and generates initial billing records.
 */
export async function processAgreementPayment(
  userId: string,
  input: ProcessAgreementPaymentInput
) {
  const { safetyService, cleaningService, essentialPlan, guardianPlan, standaloneCleaningPlan } =
    await ensurePlansAndServices();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          agreements: { orderBy: { createdAt: "desc" }, take: 1 },
          subscriptions: { where: { status: SubscriptionStatus.ACTIVE } },
        },
      },
    },
  });

  if (!user || !user.client) {
    throw new Error("Client record not found.");
  }

  const client: any = user.client;
  let paymentMethodId = input.paymentMethodId || client.stripePaymentMethodId;

  // If a setupIntentId was provided, retrieve its confirmed payment method from Stripe
  if (input.setupIntentId && !paymentMethodId) {
    try {
      const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId);
      if (setupIntent.payment_method) {
        paymentMethodId =
          typeof setupIntent.payment_method === "string"
            ? setupIntent.payment_method
            : setupIntent.payment_method.id;
      }
    } catch (err) {
      console.warn("Could not retrieve setupIntent from Stripe:", err);
    }
  }

  // If we have a payment method ID, attach and save it
  if (paymentMethodId) {
    try {
      await savePaymentMethod(userId, paymentMethodId, true);
    } catch (err) {
      console.warn("Failed attaching payment method:", err);
    }
  }

  const selectedPlanCode = input.selectedPlan || client.selectedPlan || "ESSENTIAL_GUARD";
  const hasCleaningAddon = input.hasCleaningAddon ?? client.hasCleaningAddon ?? false;

  let targetPlan = essentialPlan;
  let safetyCount = 6;
  let cleaningCount = 0;
  let isOneTime = false;

  if (selectedPlanCode === "GUARDIAN_PLUS") {
    targetPlan = guardianPlan;
    safetyCount = 6;
    cleaningCount = 6 + (hasCleaningAddon ? 6 : 0); // Guardian Plus: 6 cleaning + 6 safety (12 total, or 18 with add-on)
  } else if (selectedPlanCode === "STANDALONE_CLEANING") {
    targetPlan = standaloneCleaningPlan;
    safetyCount = 0;
    cleaningCount = 1 + (hasCleaningAddon ? 6 : 0); // Standalone: 1 single cleaning visit (or 7 with add-on)
    isOneTime = true;
  } else {
    targetPlan = essentialPlan;
    safetyCount = 6;
    cleaningCount = hasCleaningAddon ? 6 : 0; // Essential Guard: 6 safety (or 6 safety + 6 cleaning with add-on)
  }

  const basePrice = targetPlan.price;
  const addonPrice = hasCleaningAddon ? 60 : 0;
  const totalQuarterlyPrice = basePrice + addonPrice;

  const now = new Date();
  const threeMonthsLater = new Date(now);
  threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

  // 1. Create or Update Subscription
  let subscription = client.subscriptions?.[0];
  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: {
        clientId: client.id,
        planId: targetPlan.id,
        status: SubscriptionStatus.ACTIVE,
        billingInterval: isOneTime ? BillingInterval.ONE_TIME : BillingInterval.QUARTERLY,
        billingMethod: BillingMethod.AUTOMATIC,
        currentPeriodStart: now,
        currentPeriodEnd: isOneTime ? now : threeMonthsLater,
        nextRenewalDate: isOneTime ? null : threeMonthsLater,
        autoRenew: !isOneTime,
      },
    });

    // Create First Period
    const period = await prisma.subscriptionPeriod.create({
      data: {
        subscriptionId: subscription.id,
        periodNumber: 1,
        startDate: now,
        endDate: isOneTime ? now : threeMonthsLater,
        isCurrent: true,
      },
    });

    // Allocate safety visits
    if (safetyCount > 0) {
      await prisma.visitAllocation.create({
        data: {
          subscriptionPeriodId: period.id,
          serviceTypeId: safetyService.id,
          allocatedCount: safetyCount,
          usedCount: 0,
        },
      });
    }

    // Allocate cleaning visits
    if (cleaningCount > 0) {
      await prisma.visitAllocation.create({
        data: {
          subscriptionPeriodId: period.id,
          serviceTypeId: cleaningService.id,
          allocatedCount: cleaningCount,
          usedCount: 0,
        },
      });
    }
  } else {
    // Update existing subscription
    subscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: targetPlan.id,
        status: SubscriptionStatus.ACTIVE,
        autoRenew: !isOneTime,
      },
    });
  }

  // 2. Generate Initial Invoice
  const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      clientId: client.id,
      subscriptionId: subscription.id,
      amount: totalQuarterlyPrice,
      currency: "USD",
      status: InvoiceStatus.PAID,
      dueDate: now,
      issuedAt: now,
      paidAt: now,
      externalInvoiceId: `stripe_inv_${Date.now()}`,
    },
  });

  // 3. Generate Payment Record
  const payment = await prisma.payment.create({
    data: {
      clientId: client.id,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      amount: totalQuarterlyPrice,
      currency: "USD",
      status: PaymentStatus.PAID,
      paymentMethod: BillingMethod.AUTOMATIC,
      externalProvider: "STRIPE",
      externalPaymentId: paymentMethodId || input.setupIntentId || `pm_auth_${Date.now()}`,
      paidAt: now,
    },
  });

  // 4. Update latest Agreement
  const latestAgreement = client.agreements?.[0];
  if (latestAgreement) {
    await (prisma.serviceAgreement.update as any)({
      where: { id: latestAgreement.id },
      data: {
        subscriptionId: subscription.id,
        status: "EXECUTED",
        executedAt: now,
        stripePaymentMethodId: paymentMethodId || null,
        stripeSetupIntentId: input.setupIntentId || null,
        planPrice: totalQuarterlyPrice,
      },
    });
  }

  // 5. Advance client onboarding status
  const updatedClient = await (prisma.client.update as any)({
    where: { id: client.id },
    data: {
      hasCompletedAgreement: true,
      onboardingStatus: OnboardingStatus.ACTIVE,
      selectedPlan: selectedPlanCode,
      hasCleaningAddon,
    },
  });

  return {
    success: true,
    message: "Agreement payment method verified and quarterly membership activated.",
    client: updatedClient,
    subscription,
    invoice,
    payment,
  };
}

/**
 * Get Client Billing Overview formatted specifically for the Dashboard Billing View.
 */
export async function getBillingOverview(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: {
            where: { status: SubscriptionStatus.ACTIVE },
            include: { plan: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          invoices: {
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      },
    },
  });

  if (!user || !user.client) {
    throw new Error("Client record not found.");
  }

  const client = user.client as any;
  const activeSub = client.subscriptions?.[0];

  let planName = activeSub?.plan?.name;
  if (!planName) {
    if (client.selectedPlan === "GUARDIAN_PLUS") planName = "Guardian Plus";
    else if (client.selectedPlan === "STANDALONE_CLEANING") planName = "Standalone One-Time Cleaning";
    else planName = "Essential Guard";
  }

  let basePrice = 995;
  if (client.selectedPlan === "GUARDIAN_PLUS") basePrice = 1892;
  else if (client.selectedPlan === "STANDALONE_CLEANING") basePrice = 179;
  else basePrice = 995;

  const totalPrice = (client.hasCleaningAddon && client.selectedPlan === "ESSENTIAL_GUARD") ? basePrice + 60 : basePrice;

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
    description: `${planName} - Quarterly Membership`,
    amount: `$${inv.amount.toFixed(2)}`,
    status: inv.status === InvoiceStatus.PAID ? "paid" : "pending",
    pdfUrl: inv.invoiceUrl || "#",
  }));

  return {
    currentPlanName: planName,
    billingFrequency: "Quarterly" as const,
    paymentMethod: {
      brand: client.cardBrand || "VISA",
      last4: client.cardLast4 || "4242",
      expiry:
        client.cardExpMonth && client.cardExpYear
          ? `${String(client.cardExpMonth).padStart(2, "0")}/${String(client.cardExpYear).slice(-2)}`
          : "12/28",
    },
    nextPaymentDate: nextRenewal,
    nextPaymentAmount: `$${totalPrice.toFixed(2)}`,
    autoPayEnabled: activeSub?.autoRenew ?? true,
    invoices: formattedInvoices,
  };
}

/**
 * Handle Stripe Webhook Events
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
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object;
      const paymentId = paymentIntent.id;

      await (prisma.payment.updateMany as any)({
        where: { stripePaymentIntentId: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
          failureReason: paymentIntent.last_payment_error?.message || "Card declined",
        },
      });
      break;
    }

    default:
      // Other unhandled events
      break;
  }

  return { received: true };
}
