import { BillingInterval } from "@prisma/client";
import prisma from "../../lib/prisma";
import { stripe } from "../../config/stripe";
import {
  CreatePlanInput,
  UpdatePlanInput,
  ChangePlanStatusInput,
} from "./plan.validation";

export type PlanStatusType = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface ServicePlanData {
  id: string;
  name: string;
  code: string;
  shortDescription?: string | null;
  fullDescription?: string | null;
  price: number;
  totalVisits: number;
  times?: string | null;
  billingInterval: BillingInterval;
  displayOrder: number;
  isActive: boolean;
  isArchived: boolean;
  supportsAutomaticBilling: boolean;
  supportsInvoiceBilling: boolean;
  autoRenewDefault: boolean;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  features: string[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: any;
}

/**
 * Record an audit log for plan modifications.
 */
async function createPlanAuditLog(params: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousValues?: any;
  newValues?: any;
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
        previousValues: params.previousValues || null,
        newValues: params.newValues || null,
        metadata: params.metadata || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
      },
    });
  } catch (err) {
    console.warn("⚠️ Failed to record plan audit log:", err);
  }
}

/**
 * Public/Client: Retrieve all active, client-eligible service plans.
 * All plans bill monthly.
 */
export async function getActivePlans() {
  const plans = (await prisma.servicePlan.findMany({
    where: { isActive: true, isArchived: false },
    orderBy: { createdAt: "asc" },
  })) as unknown as ServicePlanData[];

  return plans.map((plan) => ({
    id: plan.id,
    planId: plan.id,
    name: plan.name,
    code: plan.code,
    description: plan.shortDescription || "",
    shortDescription: plan.shortDescription || "",
    fullDescription: "",
    price: plan.price,
    currency: "USD",
    totalVisits: Number(plan.totalVisits ?? 2),
    times: plan.times || "Up to 2 hours",
    billingInterval: "MONTHLY" as const,
    supportsAutomaticBilling: Boolean(plan.supportsAutomaticBilling),
    supportsInvoiceBilling: Boolean(plan.supportsInvoiceBilling),
    autoRenewDefault: Boolean(plan.autoRenewDefault),
    features: Array.isArray(plan.features) ? plan.features : [],
    displayOrder: plan.displayOrder ?? 0,
    effectiveFrom: plan.createdAt,
    createdAt: plan.createdAt,
    isActive: plan.isActive,
  }));
}

/**
 * Admin: Retrieve all plans with active subscriber counts.
 */
export async function getAllAdminPlans() {
  const plans = (await prisma.servicePlan.findMany({
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
        select: { id: true },
      },
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as (ServicePlanData & { subscriptions: { id: string }[] })[];

  return plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    code: plan.code,
    description: plan.shortDescription || "",
    shortDescription: plan.shortDescription || "",
    fullDescription: "",
    currentPrice: plan.price,
    price: plan.price,
    totalVisits: Number(plan.totalVisits ?? 2),
    times: plan.times || "Up to 2 hours",
    currency: "USD",
    billingInterval: "MONTHLY" as const,
    displayOrder: plan.displayOrder ?? 0,
    isActive: plan.isActive,
    isArchived: plan.isArchived,
    supportsAutomaticBilling: Boolean(plan.supportsAutomaticBilling),
    supportsInvoiceBilling: Boolean(plan.supportsInvoiceBilling),
    autoRenewDefault: Boolean(plan.autoRenewDefault),
    activeSubscribersCount: plan.subscriptions?.length || 0,
    features: Array.isArray(plan.features) ? plan.features : [],
    effectiveFrom: plan.createdAt,
    createdAt: plan.createdAt,
    lastUpdated: plan.updatedAt,
  }));
}

/**
 * Admin: Retrieve a single plan with its details and active subscribers.
 */
export async function getAdminPlanById(planId: string) {
  const plan = (await prisma.servicePlan.findUnique({
    where: { id: planId },
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
        include: {
          client: {
            include: { user: true },
          },
        },
      },
    },
  })) as unknown as
    | (ServicePlanData & {
        subscriptions: {
          id: string;
          status: string;
          contractedPrice?: number | null;
          billingInterval: string;
          currentPeriodStart: Date;
          currentPeriodEnd: Date;
          client?: {
            id?: string;
            clientNumber?: string | null;
            user?: {
              firstName?: string | null;
              lastName?: string | null;
              email?: string | null;
              phone?: string | null;
            } | null;
          } | null;
        }[];
      })
    | null;

  if (!plan) {
    throw new Error("Plan not found.");
  }

  const subscriptionsFormatted = (plan.subscriptions || []).map((sub) => ({
    id: sub.id,
    status: sub.status,
    contractedPrice: sub.contractedPrice ?? plan.price,
    billingInterval: "MONTHLY" as const,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    client: {
      id: sub.client?.id,
      clientNumber:
        sub.client?.clientNumber ||
        (sub.client?.id
          ? `AW-${sub.client.id.slice(-5).toUpperCase()}`
          : "AW-MEM"),
      firstName: sub.client?.user?.firstName || "Valued",
      lastName: sub.client?.user?.lastName || "Member",
      email: sub.client?.user?.email || "",
      phone: sub.client?.user?.phone || "",
    },
  }));

  return {
    ...plan,
    description: plan.shortDescription || "",
    shortDescription: plan.shortDescription || "",
    fullDescription: "",
    currentPrice: plan.price,
    totalVisits: Number(plan.totalVisits ?? 2),
    times: plan.times || "Up to 2 hours",
    billingInterval: "MONTHLY" as const,
    features: Array.isArray(plan.features) ? plan.features : [],
    subscriptions: subscriptionsFormatted,
  };
}

/**
 * Admin: Create a new service plan (automatic unique code generation).
 */
export async function createPlan(input: CreatePlanInput, actorUserId?: string) {
  // 1. Generate unique code automatically from plan name
  let generatedCode =
    input.code?.trim() ||
    input.name
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 30) ||
    `PLAN_${Date.now()}`;

  const existingWithCode = await prisma.servicePlan.findUnique({
    where: { code: generatedCode },
  });
  if (existingWithCode) {
    generatedCode = `${generatedCode}_${Date.now().toString().slice(-4)}`;
  }

  const description = input.description || input.shortDescription || "";

  // 2. Create or sync Stripe Product
  let stripeProductId: string | undefined = undefined;
  try {
    const product = await stripe.products.create({
      name: input.name,
      description: description || undefined,
      metadata: { code: generatedCode },
    });
    stripeProductId = product.id;
  } catch (stripeErr) {
    console.warn("⚠️ Stripe product creation notice:", stripeErr);
  }

  // 3. Create ServicePlan in Database with monthly billing
  const plan = (await (prisma.servicePlan.create as any)({
    data: {
      name: input.name,
      code: generatedCode,
      shortDescription: description,
      fullDescription: "",
      price: input.price,
      totalVisits: input.totalVisits || 2,
      times: input.times || "Up to 2 hours",
      billingInterval: BillingInterval.MONTHLY,
      displayOrder: input.displayOrder ?? 0,
      supportsAutomaticBilling: input.supportsAutomaticBilling ?? true,
      supportsInvoiceBilling: input.supportsInvoiceBilling ?? true,
      autoRenewDefault: input.autoRenewDefault ?? true,
      features: input.features || [],
      isActive: input.isActive ?? true,
      stripeProductId,
    },
  })) as unknown as ServicePlanData;

  // 4. Audit Log
  await createPlanAuditLog({
    actorUserId,
    action: "PLAN_CREATED",
    entityType: "ServicePlan",
    entityId: plan.id,
    newValues: {
      name: plan.name,
      code: plan.code,
      price: input.price,
      totalVisits: plan.totalVisits,
      times: plan.times,
      billingInterval: "MONTHLY",
      featuresCount: input.features?.length || 0,
    },
  });

  return getAdminPlanById(plan.id);
}

/**
 * Admin: Update an existing plan.
 */
export async function updatePlan(
  planId: string,
  input: UpdatePlanInput,
  actorUserId?: string,
) {
  const existingPlan = (await prisma.servicePlan.findUnique({
    where: { id: planId },
  })) as unknown as ServicePlanData | null;

  if (!existingPlan) {
    throw new Error("Plan not found.");
  }

  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.code !== undefined) updateData.code = input.code.toUpperCase();
  if (input.description !== undefined || input.shortDescription !== undefined) {
    updateData.shortDescription = input.description ?? input.shortDescription;
  }
  updateData.fullDescription = "";
  if (input.price !== undefined) updateData.price = input.price;
  if (input.totalVisits !== undefined)
    updateData.totalVisits = input.totalVisits;
  if (input.times !== undefined) updateData.times = input.times;
  updateData.billingInterval = BillingInterval.MONTHLY;
  if (input.displayOrder !== undefined)
    updateData.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;
  if (input.supportsAutomaticBilling !== undefined)
    updateData.supportsAutomaticBilling = input.supportsAutomaticBilling;
  if (input.supportsInvoiceBilling !== undefined)
    updateData.supportsInvoiceBilling = input.supportsInvoiceBilling;
  if (input.autoRenewDefault !== undefined)
    updateData.autoRenewDefault = input.autoRenewDefault;
  if (input.features !== undefined) updateData.features = input.features;

  const updatedPlan = (await (prisma.servicePlan.update as any)({
    where: { id: planId },
    data: updateData,
  })) as unknown as ServicePlanData;

  // Audit Log
  await createPlanAuditLog({
    actorUserId,
    action: "PLAN_UPDATED",
    entityType: "ServicePlan",
    entityId: planId,
    previousValues: {
      price: existingPlan.price,
      name: existingPlan.name,
      totalVisits: existingPlan.totalVisits,
      times: existingPlan.times,
      billingInterval: "MONTHLY",
    },
    newValues: { ...input, billingInterval: "MONTHLY" },
  });

  return getAdminPlanById(planId);
}

/**
 * Admin: Activate, Deactivate, or Archive a Plan.
 */
export async function changePlanStatus(
  planId: string,
  input: ChangePlanStatusInput,
  actorUserId?: string,
) {
  const plan = await prisma.servicePlan.findUnique({
    where: { id: planId },
  });

  if (!plan) {
    throw new Error("Plan not found.");
  }

  const isArchived = input.status === "ARCHIVED";
  const isActive = input.status === "ACTIVE";

  const updatedPlan = await prisma.servicePlan.update({
    where: { id: planId },
    data: {
      isActive,
      isArchived,
    },
  });

  await createPlanAuditLog({
    actorUserId,
    action: `PLAN_${input.status}`,
    entityType: "ServicePlan",
    entityId: planId,
    newValues: { status: input.status, isActive, isArchived },
  });

  return updatedPlan;
}

/**
 * Admin: Delete a Service Plan permanently.
 */
export async function deletePlan(planId: string, actorUserId?: string) {
  const plan = (await prisma.servicePlan.findUnique({
    where: { id: planId },
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
      },
    },
  })) as unknown as
    | (ServicePlanData & { subscriptions: { id: string }[] })
    | null;

  if (!plan) {
    throw new Error("Plan not found.");
  }

  const activeSubscribersCount = plan.subscriptions?.length || 0;
  if (activeSubscribersCount > 0) {
    throw new Error(
      `Cannot delete "${plan.name}" because it currently has ${activeSubscribersCount} active subscriber(s). Please reassign or cancel existing subscriptions before deleting.`,
    );
  }

  const deletedPlan = await prisma.servicePlan.delete({
    where: { id: planId },
  });

  await createPlanAuditLog({
    actorUserId,
    action: "PLAN_DELETED",
    entityType: "ServicePlan",
    entityId: planId,
    newValues: {
      name: plan.name,
      code: plan.code,
      price: plan.price,
    },
  });

  return {
    deleted: true,
    message: `Service plan "${plan.name}" has been permanently deleted.`,
    plan: deletedPlan,
  };
}

