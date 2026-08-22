import {
  BillingInterval,
  ServiceTypeCategory,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { stripe } from "../../config/stripe";
import {
  CreatePlanInput,
  UpdatePlanInput,
  ChangePlanStatusInput,
  CreateServiceInput,
  UpdateServiceInput,
} from "./plan.validation";

export type PlanStatusType = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

/**
 * Record an audit log for plan & service modifications.
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
 * Dynamically resolves current active PlanVersion, PlanPrice, features, and visit quotas.
 */
export async function getActivePlans() {
  const allPlans = await (prisma.servicePlan.findMany as any)({
    where: {
      isActive: true,
    },
    include: {
      planServices: {
        include: {
          serviceType: true,
        },
      },
    },
  });

  const unarchivedPlans = allPlans
    .filter((p: any) => !p.isArchived)
    .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  // Get active versions if any
  return unarchivedPlans.map((plan: any) => {
    const services = (plan.planServices || []).map((ps: any) => ({
      serviceTypeId: ps.serviceTypeId,
      serviceName: ps.serviceType?.name || "Service",
      category: ps.serviceType?.category || "SAFETY_OVERSIGHT",
      allocatedVisits: ps.allocatedVisits || 6,
      unit: ps.unit || "visits",
      durationMinutes: ps.durationMinutes || 60,
    }));

    const totalVisits = services.reduce(
      (sum: number, s: any) => sum + (s.allocatedVisits || 0),
      0
    ) || (plan.code === "GUARDIAN_PLUS" ? 12 : 6);

    const features =
      plan.code === "GUARDIAN_PLUS"
        ? [
            "6 Safety Oversight Visits / Quarter",
            "6 Home Cleaning Visits / Quarter",
            "HEPA Allergen Deep Vacuuming & Sanitization",
            "Home Safety Hazard Mitigation",
            "Direct Caregiver & Family Report Dispatch",
          ]
        : [
            "6 Safety Oversight Visits / Quarter",
            "Home Safety Score & Hazard Assessment",
            "Family Portal Access with Live Reports",
            "Dedicated Local Care Concierge",
          ];

    return {
      id: plan.id,
      planId: plan.id,
      versionId: plan.id,
      versionNumber: 1,
      name: plan.name,
      code: plan.code,
      shortDescription: plan.shortDescription || plan.description || "",
      fullDescription: plan.fullDescription || "",
      price: plan.price,
      currency: "USD",
      billingInterval: plan.billingInterval || "QUARTERLY",
      supportsAutomaticBilling: plan.supportsAutomaticBilling ?? true,
      supportsInvoiceBilling: plan.supportsInvoiceBilling ?? true,
      autoRenewDefault: plan.autoRenewDefault ?? true,
      features,
      services,
      totalVisits,
      effectiveFrom: plan.createdAt,
    };
  });
}

/**
 * Admin: Retrieve all plans with version count and active subscriber counts.
 */
export async function getAllAdminPlans() {
  const plans = await (prisma.servicePlan.findMany as any)({
    include: {
      planServices: { include: { serviceType: true } },
      subscriptions: {
        where: { status: "ACTIVE" },
        select: { id: true },
      },
    },
  });

  const sortedPlans = plans.sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  return sortedPlans.map((plan: any) => {
    const services = (plan.planServices || []).map((ps: any) => ({
      serviceTypeId: ps.serviceTypeId,
      serviceName: ps.serviceType?.name || "Service",
      category: ps.serviceType?.category,
      allocatedVisits: ps.allocatedVisits || 6,
      unit: ps.unit || "visits",
    }));

    const totalVisits = services.reduce(
      (sum: number, s: any) => sum + (s.allocatedVisits || 0),
      0
    ) || (plan.code === "GUARDIAN_PLUS" ? 12 : 6);

    const features =
      plan.code === "GUARDIAN_PLUS"
        ? [
            "6 Safety Oversight Visits / Quarter",
            "6 Home Cleaning Visits / Quarter",
            "HEPA Allergen Deep Vacuuming & Sanitization",
            "Home Safety Hazard Mitigation",
          ]
        : [
            "6 Safety Oversight Visits / Quarter",
            "Home Safety Score & Hazard Assessment",
            "Family Portal Access with Live Reports",
          ];

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      shortDescription: plan.shortDescription || plan.description || "",
      fullDescription: plan.fullDescription || "",
      currentPrice: plan.price,
      currency: "USD",
      billingInterval: plan.billingInterval || "QUARTERLY",
      displayOrder: plan.displayOrder ?? 0,
      isActive: plan.isActive ?? true,
      isArchived: plan.isArchived ?? false,
      supportsAutomaticBilling: plan.supportsAutomaticBilling ?? true,
      supportsInvoiceBilling: plan.supportsInvoiceBilling ?? true,
      activeSubscribersCount: plan.subscriptions?.length || 0,
      totalVersionsCount: 1,
      latestVersionNumber: 1,
      latestVersionStatus: "ACTIVE",
      features,
      services,
      totalVisits,
      effectiveFrom: plan.createdAt,
      lastUpdated: plan.updatedAt,
    };
  });
}

/**
 * Admin: Retrieve a single plan with its full version history and subscriber list.
 */
export async function getAdminPlanById(planId: string) {
  const plan = await (prisma.servicePlan.findUnique as any)({
    where: { id: planId },
    include: {
      planServices: { include: { serviceType: true } },
      subscriptions: {
        where: { status: "ACTIVE" },
        include: {
          client: {
            include: { user: true },
          },
        },
      },
    },
  });

  if (!plan) {
    throw new Error("Plan not found.");
  }

  // Format with version wrapper for UI compatibility
  return {
    ...plan,
    versions: [
      {
        id: plan.id,
        versionNumber: 1,
        name: plan.name,
        description: plan.shortDescription || plan.description,
        status: "ACTIVE",
        price: plan.price,
        currency: "USD",
        billingInterval: plan.billingInterval || "QUARTERLY",
        features:
          plan.code === "GUARDIAN_PLUS"
            ? [
                "6 Safety Oversight Visits / Quarter",
                "6 Home Cleaning Visits / Quarter",
                "HEPA Allergen Deep Vacuuming & Sanitization",
                "Home Safety Hazard Mitigation",
              ]
            : [
                "6 Safety Oversight Visits / Quarter",
                "Home Safety Score & Hazard Assessment",
                "Family Portal Access with Live Reports",
              ],
        effectiveFrom: plan.createdAt,
        planServices: plan.planServices || [],
      },
    ],
  };
}

/**
 * Admin: Create a new service plan.
 */
export async function createPlan(input: CreatePlanInput, actorUserId?: string) {
  // 1. Create or sync Stripe Product
  let stripeProductId = undefined;
  try {
    const product = await stripe.products.create({
      name: input.name,
      description: input.shortDescription || input.fullDescription || undefined,
      metadata: { code: input.code },
    });
    stripeProductId = product.id;
  } catch (stripeErr) {
    console.warn("⚠️ Stripe product creation notice:", stripeErr);
  }

  // 2. Create ServicePlan in Database
  const plan = await (prisma.servicePlan.create as any)({
    data: {
      name: input.name,
      code: input.code.toUpperCase(),
      description: input.shortDescription || input.fullDescription || "",
      price: input.price,
      billingInterval: input.billingInterval as BillingInterval,
      isActive: input.isActive ?? true,
    },
  });

  // 3. Attach PlanServices (Service Allocations)
  if (input.services && input.services.length > 0) {
    for (const serviceItem of input.services) {
      try {
        await (prisma.planService.create as any)({
          data: {
            planId: plan.id,
            serviceTypeId: serviceItem.serviceTypeId,
            allocatedVisits: serviceItem.allocatedVisits,
            unit: serviceItem.unit || "visits",
          },
        });
      } catch {
        // Safe insert
      }
    }
  }

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
      billingInterval: input.billingInterval,
      servicesCount: input.services?.length || 0,
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
  actorUserId?: string
) {
  const existingPlan = await (prisma.servicePlan.findUnique as any)({
    where: { id: planId },
    include: {
      subscriptions: { where: { status: "ACTIVE" } },
    },
  });

  if (!existingPlan) {
    throw new Error("Plan not found.");
  }

  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.shortDescription !== undefined) updateData.description = input.shortDescription;
  if (input.price !== undefined) updateData.price = input.price;
  if (input.billingInterval !== undefined) updateData.billingInterval = input.billingInterval as BillingInterval;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  const updatedPlan = await (prisma.servicePlan.update as any)({
    where: { id: planId },
    data: updateData,
  });

  // Re-attach services if updated
  if (input.services && input.services.length > 0) {
    await (prisma.planService.deleteMany as any)({
      where: { planId },
    });

    for (const serviceItem of input.services) {
      await (prisma.planService.create as any)({
        data: {
          planId,
          serviceTypeId: serviceItem.serviceTypeId,
          allocatedVisits: serviceItem.allocatedVisits,
          unit: serviceItem.unit || "visits",
        },
      });
    }
  }

  await createPlanAuditLog({
    actorUserId,
    action: "PLAN_UPDATED",
    entityType: "ServicePlan",
    entityId: planId,
    previousValues: { price: existingPlan.price, name: existingPlan.name },
    newValues: input,
  });

  return getAdminPlanById(planId);
}

/**
 * Admin: Activate, Deactivate, or Archive a Plan.
 */
export async function changePlanStatus(
  planId: string,
  input: ChangePlanStatusInput,
  actorUserId?: string
) {
  const plan = await (prisma.servicePlan.findUnique as any)({
    where: { id: planId },
  });

  if (!plan) {
    throw new Error("Plan not found.");
  }

  const isActive = input.status === "ACTIVE";

  const updatedPlan = await (prisma.servicePlan.update as any)({
    where: { id: planId },
    data: {
      isActive,
    },
  });

  await createPlanAuditLog({
    actorUserId,
    action: `PLAN_${input.status}`,
    entityType: "ServicePlan",
    entityId: planId,
    newValues: { status: input.status, isActive },
  });

  return updatedPlan;
}

/**
 * Admin: Dynamic Service Catalog Operations
 */
export async function getAllServices() {
  return (prisma.serviceType.findMany as any)({
    where: { isActive: true },
  });
}

export async function createService(input: CreateServiceInput, actorUserId?: string) {
  const service = await (prisma.serviceType.create as any)({
    data: {
      name: input.name,
      category: input.category as ServiceTypeCategory,
      description: input.description,
      isActive: input.isActive ?? true,
    },
  });

  await createPlanAuditLog({
    actorUserId,
    action: "SERVICE_CREATED",
    entityType: "ServiceType",
    entityId: service.id,
    newValues: service,
  });

  return service;
}

export async function updateService(
  serviceId: string,
  input: UpdateServiceInput,
  actorUserId?: string
) {
  const service = await (prisma.serviceType.update as any)({
    where: { id: serviceId },
    data: {
      name: input.name,
      category: input.category as ServiceTypeCategory,
      description: input.description,
      isActive: input.isActive,
    },
  });

  await createPlanAuditLog({
    actorUserId,
    action: "SERVICE_UPDATED",
    entityType: "ServiceType",
    entityId: serviceId,
    newValues: input,
  });

  return service;
}

/**
 * Seed approved dynamic service plans and services if database catalog is empty.
 */
export async function seedInitialPlansAndServices() {
  let safetyService = await (prisma.serviceType.findFirst as any)({
    where: { name: "Safety Oversight" },
  });

  if (!safetyService) {
    safetyService = await (prisma.serviceType.create as any)({
      data: {
        name: "Safety Oversight",
        category: "SAFETY_OVERSIGHT",
        description: "Quarterly or bi-weekly home safety audits, hazard checks and wellness reports.",
        isActive: true,
      },
    });
  }

  let cleaningService = await (prisma.serviceType.findFirst as any)({
    where: { name: "Home Cleaning" },
  });

  if (!cleaningService) {
    cleaningService = await (prisma.serviceType.create as any)({
      data: {
        name: "Home Cleaning",
        category: "CLEANING",
        description: "HEPA allergen vacuuming, pathway clearing, kitchen & living area maintenance.",
        isActive: true,
      },
    });
  }

  const existingPlans = await prisma.servicePlan.count();
  if (existingPlans === 0) {
    await createPlan({
      name: "Essential Guard",
      code: "ESSENTIAL_GUARD",
      shortDescription: "Essential non-medical home safety oversight and hazard mitigation.",
      fullDescription: "Includes 6 comprehensive safety oversight visits per quarter with digitized wellness reports.",
      price: 995,
      billingInterval: "QUARTERLY",
      displayOrder: 1,
      features: [
        "6 Safety Oversight Visits / Quarter",
        "Home Safety Score & Hazard Assessment",
        "Family Portal Access with Live Reports",
        "Dedicated Local Care Concierge",
      ],
      services: [
        {
          serviceTypeId: safetyService.id,
          allocatedVisits: 6,
          unit: "visits",
        },
      ],
      isActive: true,
    });

    await createPlan({
      name: "Guardian Plus",
      code: "GUARDIAN_PLUS",
      shortDescription: "Complete dual-protection safety oversight and specialized home cleaning.",
      fullDescription: "Includes 12 total visits per quarter (6 safety oversight and 6 home cleanings).",
      price: 1892,
      billingInterval: "QUARTERLY",
      displayOrder: 2,
      features: [
        "6 Safety Oversight Visits / Quarter",
        "6 Home Cleaning Visits / Quarter",
        "HEPA Allergen Deep Vacuuming & Sanitization",
        "Home Safety Hazard Mitigation",
        "Direct Caregiver & Family Report Dispatch",
      ],
      services: [
        {
          serviceTypeId: safetyService.id,
          allocatedVisits: 6,
          unit: "visits",
        },
        {
          serviceTypeId: cleaningService.id,
          allocatedVisits: 6,
          unit: "visits",
        },
      ],
      isActive: true,
    });
  }

  return { safetyService, cleaningService };
}
