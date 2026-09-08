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
  let allPlans = await (prisma.servicePlan.findMany as any)({
    include: {
      planServices: { include: { serviceType: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { planServices: { include: { serviceType: true } } },
      },
    },
  });

  let activePlans = (allPlans || []).filter(
    (p: any) => p.isActive === true && p.isArchived !== true
  );

  if (!activePlans || activePlans.length === 0) {
    await seedInitialPlansAndServices();
    allPlans = await (prisma.servicePlan.findMany as any)({
      include: {
        planServices: { include: { serviceType: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          include: { planServices: { include: { serviceType: true } } },
        },
      },
    });
    activePlans = (allPlans || []).filter(
      (p: any) => p.isActive === true && p.isArchived !== true
    );

    if (activePlans.length === 0 && allPlans && allPlans.length > 0) {
      activePlans = allPlans.filter((p: any) => p.isArchived !== true);
    }
  }

  const sortedPlans = activePlans.sort(
    (a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );

  return sortedPlans.map((plan: any) => {
    const latestVersion = plan.versions?.[0];

    const servicesSource =
      plan.planServices && plan.planServices.length > 0
        ? plan.planServices
        : latestVersion?.planServices || [];

    const services = servicesSource.map((ps: any) => ({
      serviceTypeId: ps.serviceTypeId,
      serviceName: ps.serviceType?.name || "Service",
      category: ps.serviceType?.category || "SAFETY_OVERSIGHT",
      allocatedVisits: ps.allocatedVisits || 6,
      unit: ps.unit || "visits",
      durationMinutes: ps.durationMinutes || 60,
    }));

    const totalVisits =
      services.reduce(
        (sum: number, s: any) => sum + (s.allocatedVisits || 0),
        0
      ) || (plan.code === "GUARDIAN_PLUS" ? 12 : 6);

    const metadataFeatures = (plan.metadata as any)?.features;
    const versionFeatures = latestVersion?.features;
    const defaultFeatures =
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

    const features =
      metadataFeatures && Array.isArray(metadataFeatures) && metadataFeatures.length > 0
        ? metadataFeatures
        : versionFeatures && Array.isArray(versionFeatures) && versionFeatures.length > 0
        ? versionFeatures
        : defaultFeatures;

    return {
      id: plan.id,
      planId: plan.id,
      versionId: latestVersion?.id || plan.id,
      versionNumber: latestVersion?.versionNumber || 1,
      name: plan.name,
      code: plan.code,
      shortDescription: plan.shortDescription || "",
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
      effectiveFrom: latestVersion?.effectiveFrom || plan.createdAt,
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
      versions: {
        orderBy: { versionNumber: "desc" },
        include: { planServices: { include: { serviceType: true } } },
      },
      subscriptions: {
        where: { status: "ACTIVE" },
        select: { id: true },
      },
    },
  });

  const sortedPlans = plans.sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  return sortedPlans.map((plan: any) => {
    const latestVersion = plan.versions?.[0];
    const servicesSource =
      plan.planServices && plan.planServices.length > 0
        ? plan.planServices
        : latestVersion?.planServices || [];

    const services = servicesSource.map((ps: any) => ({
      serviceTypeId: ps.serviceTypeId,
      serviceName: ps.serviceType?.name || "Service",
      category: ps.serviceType?.category,
      allocatedVisits: ps.allocatedVisits || 6,
      unit: ps.unit || "visits",
    }));

    const totalVisits =
      services.reduce(
        (sum: number, s: any) => sum + (s.allocatedVisits || 0),
        0
      ) || (plan.code === "GUARDIAN_PLUS" ? 12 : 6);

    const metadataFeatures = (plan.metadata as any)?.features;
    const versionFeatures = latestVersion?.features;
    const defaultFeatures =
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

    const features =
      metadataFeatures && Array.isArray(metadataFeatures) && metadataFeatures.length > 0
        ? metadataFeatures
        : versionFeatures && Array.isArray(versionFeatures) && versionFeatures.length > 0
        ? versionFeatures
        : defaultFeatures;

    const versions =
      plan.versions && plan.versions.length > 0
        ? plan.versions.map((ver: any) => ({
            id: ver.id,
            versionNumber: ver.versionNumber,
            name: ver.name || plan.name,
            description: ver.description || plan.shortDescription || "",
            status: ver.status || "ACTIVE",
            price: ver.price,
            currency: ver.currency || "USD",
            billingInterval: ver.billingInterval || plan.billingInterval || "QUARTERLY",
            features: ver.features && ver.features.length > 0 ? ver.features : features,
            effectiveFrom: ver.effectiveFrom || ver.createdAt || plan.createdAt,
            effectiveTo: ver.effectiveTo || null,
            planServices:
              ver.planServices && ver.planServices.length > 0
                ? ver.planServices.map((ps: any) => ({
                    serviceTypeId: ps.serviceTypeId,
                    serviceName: ps.serviceType?.name || "Service",
                    allocatedVisits: ps.allocatedVisits || 6,
                    unit: ps.unit || "visits",
                  }))
                : services,
          }))
        : [
            {
              id: plan.id,
              versionNumber: 1,
              name: plan.name,
              description: plan.shortDescription || "",
              status: "ACTIVE",
              price: plan.price,
              currency: "USD",
              billingInterval: plan.billingInterval || "QUARTERLY",
              features,
              effectiveFrom: plan.createdAt,
              effectiveTo: null,
              planServices: services,
            },
          ];

    return {
      id: plan.id,
      name: plan.name,
      code: plan.code,
      shortDescription: plan.shortDescription || "",
      fullDescription: plan.fullDescription || "",
      currentPrice: plan.price,
      price: plan.price,
      currency: "USD",
      billingInterval: plan.billingInterval || "QUARTERLY",
      displayOrder: plan.displayOrder ?? 0,
      isActive: plan.isActive ?? true,
      isArchived: plan.isArchived ?? false,
      supportsAutomaticBilling: plan.supportsAutomaticBilling ?? true,
      supportsInvoiceBilling: plan.supportsInvoiceBilling ?? true,
      autoRenewDefault: plan.autoRenewDefault ?? true,
      activeSubscribersCount: plan.subscriptions?.length || 0,
      totalVersionsCount: versions.length,
      latestVersionNumber: latestVersion?.versionNumber || 1,
      latestVersionStatus: latestVersion?.status || "ACTIVE",
      features,
      services,
      totalVisits,
      versions,
      effectiveFrom: latestVersion?.effectiveFrom || plan.createdAt,
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
      versions: {
        orderBy: { versionNumber: "desc" },
        include: {
          planServices: { include: { serviceType: true } },
        },
      },
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

  const metadataFeatures = (plan.metadata as any)?.features;
  const defaultFeatures =
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

  const planFeatures =
    metadataFeatures && Array.isArray(metadataFeatures) && metadataFeatures.length > 0
      ? metadataFeatures
      : defaultFeatures;

  const planServicesFormatted = (plan.planServices || []).map((ps: any) => ({
    serviceTypeId: ps.serviceTypeId,
    serviceName: ps.serviceType?.name || "Service",
    category: ps.serviceType?.category,
    allocatedVisits: ps.allocatedVisits || 6,
    unit: ps.unit || "visits",
    durationMinutes: ps.durationMinutes || 60,
  }));

  const versions =
    plan.versions && plan.versions.length > 0
      ? plan.versions.map((ver: any) => ({
          id: ver.id,
          versionNumber: ver.versionNumber,
          name: ver.name || plan.name,
          description: ver.description || plan.shortDescription || "",
          status: ver.status || "ACTIVE",
          price: ver.price,
          currency: ver.currency || "USD",
          billingInterval: ver.billingInterval || plan.billingInterval || "QUARTERLY",
          features: ver.features && ver.features.length > 0 ? ver.features : planFeatures,
          effectiveFrom: ver.effectiveFrom || ver.createdAt || plan.createdAt,
          effectiveTo: ver.effectiveTo || null,
          planServices:
            ver.planServices && ver.planServices.length > 0
              ? ver.planServices.map((ps: any) => ({
                  serviceTypeId: ps.serviceTypeId,
                  serviceName: ps.serviceType?.name || "Service",
                  allocatedVisits: ps.allocatedVisits || 6,
                  unit: ps.unit || "visits",
                }))
              : planServicesFormatted,
        }))
      : [
          {
            id: plan.id,
            versionNumber: 1,
            name: plan.name,
            description: plan.shortDescription || "",
            status: "ACTIVE",
            price: plan.price,
            currency: "USD",
            billingInterval: plan.billingInterval || "QUARTERLY",
            features: planFeatures,
            effectiveFrom: plan.createdAt,
            effectiveTo: null,
            planServices: planServicesFormatted,
          },
        ];

  const subscriptionsFormatted = (plan.subscriptions || []).map((sub: any) => ({
    id: sub.id,
    status: sub.status,
    contractedPrice: sub.contractedPrice ?? plan.price,
    billingInterval: sub.billingInterval || plan.billingInterval,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    planVersionId: sub.planVersionId,
    client: {
      id: sub.client?.id,
      clientNumber: sub.client?.clientNumber || (sub.client?.id ? `AW-${sub.client.id.slice(-5).toUpperCase()}` : "AW-MEM"),
      firstName: sub.client?.user?.firstName || "Valued",
      lastName: sub.client?.user?.lastName || "Member",
      email: sub.client?.user?.email || "",
      phone: sub.client?.user?.phone || "",
    },
  }));

  return {
    ...plan,
    features: planFeatures,
    services: planServicesFormatted,
    versions,
    subscriptions: subscriptionsFormatted,
  };
}

/**
 * Safely resolves a ServiceType MongoDB ObjectId by ID, code, name, or category.
 */
async function resolveServiceTypeId(rawIdOrCode: string): Promise<string | null> {
  if (!rawIdOrCode || typeof rawIdOrCode !== "string") return null;

  // 1. Check if it's already a valid 24-character hexadecimal ObjectId in DB
  const isMongoId = /^[0-9a-fA-F]{24}$/.test(rawIdOrCode);
  if (isMongoId) {
    const exists = await (prisma.serviceType.findUnique as any)({
      where: { id: rawIdOrCode },
      select: { id: true },
    });
    if (exists) return exists.id;
  }

  // 2. Try to match by code or name
  let matched = await (prisma.serviceType.findFirst as any)({
    where: {
      OR: [
        { code: { equals: rawIdOrCode, mode: "insensitive" } },
        { name: { equals: rawIdOrCode, mode: "insensitive" } },
        { name: { contains: rawIdOrCode.replace(/srv_|_/g, " ").trim(), mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });

  if (matched) return matched.id;

  // 3. Match by category keywords
  const normalized = rawIdOrCode.toLowerCase();
  if (normalized.includes("safe")) {
    matched = await (prisma.serviceType.findFirst as any)({
      where: { category: "SAFETY_OVERSIGHT" },
      select: { id: true },
    });
    if (matched) return matched.id;
  }

  if (normalized.includes("clean")) {
    matched = await (prisma.serviceType.findFirst as any)({
      where: { category: "CLEANING" },
      select: { id: true },
    });
    if (matched) return matched.id;
  }

  // 4. Fallback to first available active service
  const fallback = await (prisma.serviceType.findFirst as any)({
    where: { isActive: true },
    select: { id: true },
  });

  return fallback?.id || null;
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
      shortDescription: input.shortDescription || "",
      fullDescription: input.fullDescription || "",
      price: input.price,
      billingInterval: input.billingInterval as BillingInterval,
      displayOrder: input.displayOrder ?? 0,
      supportsAutomaticBilling: input.supportsAutomaticBilling ?? true,
      supportsInvoiceBilling: input.supportsInvoiceBilling ?? true,
      autoRenewDefault: input.autoRenewDefault ?? true,
      isActive: input.isActive ?? true,
      stripeProductId,
      metadata: {
        features: input.features || [],
      },
    },
  });

  // 3. Attach PlanServices (Service Allocations)
  if (input.services && input.services.length > 0) {
    for (const serviceItem of input.services) {
      const resolvedId = await resolveServiceTypeId(serviceItem.serviceTypeId);
      if (resolvedId) {
        try {
          await (prisma.planService.create as any)({
            data: {
              planId: plan.id,
              serviceTypeId: resolvedId,
              allocatedVisits: serviceItem.allocatedVisits,
              unit: serviceItem.unit || "visits",
            },
          });
        } catch {
          // Safe insert
        }
      }
    }
  }

  // 4. Create initial PlanVersion v1.0
  try {
    const planVersion = await ((prisma as any).planVersion.create as any)({
      data: {
        planId: plan.id,
        versionNumber: 1,
        name: plan.name,
        description: input.shortDescription || "",
        status: "ACTIVE",
        price: input.price,
        billingInterval: input.billingInterval as BillingInterval,
        currency: input.currency || "USD",
        features: input.features || [],
        effectiveFrom: new Date(),
      },
    });

    if (input.services && input.services.length > 0) {
      for (const serviceItem of input.services) {
        const resolvedId = await resolveServiceTypeId(serviceItem.serviceTypeId);
        if (resolvedId) {
          await (prisma.planService.create as any)({
            data: {
              planVersionId: planVersion.id,
              serviceTypeId: resolvedId,
              allocatedVisits: serviceItem.allocatedVisits,
              unit: serviceItem.unit || "visits",
            },
          });
        }
      }
    }
  } catch (verErr) {
    console.warn("⚠️ Initial PlanVersion creation notice:", verErr);
  }

  // 5. Audit Log
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
      planServices: true,
      versions: {
        orderBy: { versionNumber: "desc" },
      },
      subscriptions: { where: { status: "ACTIVE" } },
    },
  });

  if (!existingPlan) {
    throw new Error("Plan not found.");
  }

  // 1. Prepare ServicePlan update data with proper Prisma fields
  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.shortDescription !== undefined) updateData.shortDescription = input.shortDescription;
  if (input.fullDescription !== undefined) updateData.fullDescription = input.fullDescription;
  if (input.price !== undefined) updateData.price = input.price;
  if (input.billingInterval !== undefined) updateData.billingInterval = input.billingInterval as BillingInterval;
  if (input.displayOrder !== undefined) updateData.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;
  if (input.supportsAutomaticBilling !== undefined) updateData.supportsAutomaticBilling = input.supportsAutomaticBilling;
  if (input.supportsInvoiceBilling !== undefined) updateData.supportsInvoiceBilling = input.supportsInvoiceBilling;
  if (input.autoRenewDefault !== undefined) updateData.autoRenewDefault = input.autoRenewDefault;

  if (input.features !== undefined) {
    const currentMeta = (existingPlan.metadata as any) || {};
    updateData.metadata = {
      ...currentMeta,
      features: input.features,
    };
  }

  await (prisma.servicePlan.update as any)({
    where: { id: planId },
    data: updateData,
  });

  // 2. Re-attach / update planServices on the ServicePlan
  if (input.services !== undefined) {
    await (prisma.planService.deleteMany as any)({
      where: { planId },
    });

    for (const serviceItem of input.services) {
      if (serviceItem.serviceTypeId) {
        await (prisma.planService.create as any)({
          data: {
            planId,
            serviceTypeId: serviceItem.serviceTypeId,
            allocatedVisits: serviceItem.allocatedVisits,
            unit: serviceItem.unit || "visits",
            durationMinutes: serviceItem.durationMinutes || 60,
          },
        });
      }
    }
  }

  // 3. PlanVersion Management
  const latestVer = existingPlan.versions?.[0];
  const activeSubscribers = existingPlan.subscriptions?.length || 0;
  const isPriceChanged = input.price !== undefined && latestVer && input.price !== latestVer.price;
  const shouldCreateNewVersion = (isPriceChanged && activeSubscribers > 0) || input.forceNewVersion;

  if (shouldCreateNewVersion) {
    const nextVerNumber = (latestVer?.versionNumber || 1) + 1;

    if (latestVer) {
      await ((prisma as any).planVersion.update as any)({
        where: { id: latestVer.id },
        data: {
          effectiveTo: new Date(),
          status: "INACTIVE",
        },
      });
    }

    const newVersion = await ((prisma as any).planVersion.create as any)({
      data: {
        planId,
        versionNumber: nextVerNumber,
        name: input.name || existingPlan.name,
        description: input.shortDescription || existingPlan.shortDescription || "",
        status: "ACTIVE",
        price: input.price !== undefined ? input.price : existingPlan.price,
        billingInterval: (input.billingInterval || existingPlan.billingInterval) as BillingInterval,
        currency: input.currency || "USD",
        features: input.features || (existingPlan.metadata as any)?.features || [],
        effectiveFrom: new Date(),
      },
    });

    const servicesToAttach = input.services !== undefined ? input.services : existingPlan.planServices || [];
    for (const s of servicesToAttach) {
      const resolvedId = await resolveServiceTypeId(s.serviceTypeId);
      if (resolvedId) {
        await (prisma.planService.create as any)({
          data: {
            planVersionId: newVersion.id,
            serviceTypeId: resolvedId,
            allocatedVisits: s.allocatedVisits,
            unit: s.unit || "visits",
          },
        });
      }
    }
  } else if (latestVer) {
    const verUpdateData: any = {};
    if (input.name !== undefined) verUpdateData.name = input.name;
    if (input.shortDescription !== undefined) verUpdateData.description = input.shortDescription;
    if (input.price !== undefined) verUpdateData.price = input.price;
    if (input.billingInterval !== undefined) verUpdateData.billingInterval = input.billingInterval as BillingInterval;
    if (input.features !== undefined) verUpdateData.features = input.features;

    await ((prisma as any).planVersion.update as any)({
      where: { id: latestVer.id },
      data: verUpdateData,
    });

    if (input.services !== undefined) {
      await (prisma.planService.deleteMany as any)({
        where: { planVersionId: latestVer.id },
      });
      for (const serviceItem of input.services) {
        const resolvedId = await resolveServiceTypeId(serviceItem.serviceTypeId);
        if (resolvedId) {
          await (prisma.planService.create as any)({
            data: {
              planVersionId: latestVer.id,
              serviceTypeId: resolvedId,
              allocatedVisits: serviceItem.allocatedVisits,
              unit: serviceItem.unit || "visits",
            },
          });
        }
      }
    }
  } else {
    // Create initial v1.0 version if none existed
    try {
      const newVersion = await ((prisma as any).planVersion.create as any)({
        data: {
          planId,
          versionNumber: 1,
          name: input.name || existingPlan.name,
          description: input.shortDescription || existingPlan.shortDescription || "",
          status: "ACTIVE",
          price: input.price !== undefined ? input.price : existingPlan.price,
          billingInterval: (input.billingInterval || existingPlan.billingInterval) as BillingInterval,
          currency: input.currency || "USD",
          features: input.features || (existingPlan.metadata as any)?.features || [],
          effectiveFrom: existingPlan.createdAt,
        },
      });

      if (input.services !== undefined) {
        for (const s of input.services) {
          const resolvedId = await resolveServiceTypeId(s.serviceTypeId);
          if (resolvedId) {
            await (prisma.planService.create as any)({
              data: {
                planVersionId: newVersion.id,
                serviceTypeId: resolvedId,
                allocatedVisits: s.allocatedVisits,
                unit: s.unit || "visits",
              },
            });
          }
        }
      }
    } catch (createVerErr) {
      console.warn("⚠️ PlanVersion sync notice:", createVerErr);
    }
  }

  // 4. Audit Log
  await createPlanAuditLog({
    actorUserId,
    action: "PLAN_UPDATED",
    entityType: "ServicePlan",
    entityId: planId,
    previousValues: {
      price: existingPlan.price,
      name: existingPlan.name,
      shortDescription: existingPlan.shortDescription,
    },
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

  const isArchived = input.status === "ARCHIVED";
  const isActive = input.status === "ACTIVE";

  const updatedPlan = await (prisma.servicePlan.update as any)({
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
  const plan = await (prisma.servicePlan.findUnique as any)({
    where: { id: planId },
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
      },
    },
  });

  if (!plan) {
    throw new Error("Plan not found.");
  }

  // Check if there are active subscribers
  const activeSubscribersCount = plan.subscriptions?.length || 0;
  if (activeSubscribersCount > 0) {
    throw new Error(
      `Cannot delete "${plan.name}" because it currently has ${activeSubscribersCount} active subscriber(s). Please reassign or cancel existing subscriptions before deleting.`
    );
  }

  // Clean up relations
  // 1. Delete linked planServices on Plan
  await (prisma.planService.deleteMany as any)({
    where: { planId },
  });

  // 2. Delete linked PlanPrices and PlanServices on PlanVersions
  const versions = await (prisma.planVersion.findMany as any)({
    where: { planId },
    select: { id: true },
  });
  const versionIds = versions.map((v: any) => v.id);

  if (versionIds.length > 0) {
    await (prisma.planPrice.deleteMany as any)({
      where: { planVersionId: { in: versionIds } },
    });
    await (prisma.planService.deleteMany as any)({
      where: { planVersionId: { in: versionIds } },
    });
    await (prisma.planVersion.deleteMany as any)({
      where: { planId },
    });
  }

  // 3. Delete the ServicePlan itself
  const deletedPlan = await (prisma.servicePlan.delete as any)({
    where: { id: planId },
  });

  // 4. Audit Log
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

/**
 * Admin: Dynamic Service Catalog Operations
 */
export async function getAllServices(query?: {
  includeInactive?: boolean;
  category?: string;
  search?: string;
}) {
  const where: any = {};

  if (!query?.includeInactive) {
    where.isActive = true;
  }

  if (query?.category && query.category !== "ALL") {
    where.category = query.category as ServiceTypeCategory;
  }

  if (query?.search && query.search.trim()) {
    where.OR = [
      { name: { contains: query.search.trim(), mode: "insensitive" } },
      { description: { contains: query.search.trim(), mode: "insensitive" } },
      { code: { contains: query.search.trim(), mode: "insensitive" } },
    ];
  }

  let existing = await (prisma.serviceType.findMany as any)({
    where,
    orderBy: { displayOrder: "asc" },
  });

  if (existing && existing.length > 0) {
    return existing;
  }

  // Auto seed default services if catalog is empty
  const totalCount = await (prisma.serviceType.count as any)();
  if (totalCount === 0) {
    await seedInitialPlansAndServices();
    existing = await (prisma.serviceType.findMany as any)({
      where,
      orderBy: { displayOrder: "asc" },
    });
  }

  return existing || [];
}

export async function createService(input: CreateServiceInput, actorUserId?: string) {
  const code =
    input.code ||
    input.name
      .toUpperCase()
      .trim()
      .replace(/[^A-Z0-9\s_-]/g, "")
      .replace(/[\s-]+/g, "_");

  const service = await (prisma.serviceType.create as any)({
    data: {
      name: input.name,
      code,
      category: input.category as ServiceTypeCategory,
      description: input.description || "",
      durationMinutes: input.durationMinutes || 60,
      defaultPrice: input.defaultPrice,
      displayOrder: input.displayOrder ?? 0,
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
  const updateData: any = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.code !== undefined) updateData.code = input.code;
  if (input.category !== undefined) updateData.category = input.category as ServiceTypeCategory;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.durationMinutes !== undefined) updateData.durationMinutes = input.durationMinutes;
  if (input.defaultPrice !== undefined) updateData.defaultPrice = input.defaultPrice;
  if (input.displayOrder !== undefined) updateData.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) updateData.isActive = input.isActive;

  const service = await (prisma.serviceType.update as any)({
    where: { id: serviceId },
    data: updateData,
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

export async function changeServiceStatus(
  serviceId: string,
  isActive: boolean,
  actorUserId?: string
) {
  const service = await (prisma.serviceType.update as any)({
    where: { id: serviceId },
    data: { isActive },
  });

  await createPlanAuditLog({
    actorUserId,
    action: isActive ? "SERVICE_ACTIVATED" : "SERVICE_DEACTIVATED",
    entityType: "ServiceType",
    entityId: serviceId,
    newValues: { isActive },
  });

  return service;
}

export async function deleteService(serviceId: string, actorUserId?: string) {
  const planServiceCount = await (prisma.planService.count as any)({
    where: { serviceTypeId: serviceId },
  });

  const appointmentCount = await (prisma.appointment.count as any)({
    where: { serviceTypeId: serviceId },
  });

  if (planServiceCount > 0 || appointmentCount > 0) {
    const deactivated = await (prisma.serviceType.update as any)({
      where: { id: serviceId },
      data: { isActive: false },
    });

    await createPlanAuditLog({
      actorUserId,
      action: "SERVICE_DEACTIVATED",
      entityType: "ServiceType",
      entityId: serviceId,
      newValues: { isActive: false, reason: "Deactivated due to existing references" },
    });

    return {
      deleted: false,
      deactivated: true,
      message: `Service deactivated. It is currently linked to ${planServiceCount} plan allocations and ${appointmentCount} appointments.`,
      service: deactivated,
    };
  }

  const deleted = await (prisma.serviceType.delete as any)({
    where: { id: serviceId },
  });

  await createPlanAuditLog({
    actorUserId,
    action: "SERVICE_DELETED",
    entityType: "ServiceType",
    entityId: serviceId,
    newValues: deleted,
  });

  return {
    deleted: true,
    deactivated: false,
    message: "Service permanently deleted from catalog.",
    service: deleted,
  };
}

export async function getServiceCatalogStats() {
  let allServices = await (prisma.serviceType.findMany as any)({
    include: {
      planServices: true,
    },
  });

  if (!allServices || allServices.length === 0) {
    await seedInitialPlansAndServices();
    allServices = await (prisma.serviceType.findMany as any)({
      include: {
        planServices: true,
      },
    });
  }

  const totalServices = allServices?.length || 0;
  const activeServices = (allServices || []).filter((s: any) => s.isActive !== false).length;
  const inactiveServices = totalServices - activeServices;

  const categoryCounts: Record<string, { total: number; active: number }> = {
    SAFETY_OVERSIGHT: { total: 0, active: 0 },
    CLEANING: { total: 0, active: 0 },
    ASSESSMENT: { total: 0, active: 0 },
    WELLNESS: { total: 0, active: 0 },
    OTHER: { total: 0, active: 0 },
  };

  (allServices || []).forEach((s: any) => {
    const cat = s.category || "OTHER";
    if (!categoryCounts[cat]) {
      categoryCounts[cat] = { total: 0, active: 0 };
    }
    categoryCounts[cat].total += 1;
    if (s.isActive !== false) categoryCounts[cat].active += 1;
  });

  const categoriesWithServices = Object.keys(categoryCounts).filter(
    (k) => categoryCounts[k].total > 0
  ).length;

  const totalPlanLinks = (allServices || []).reduce(
    (acc: number, s: any) => acc + (s.planServices?.length || 0),
    0
  );

  const totalAppointments = await (prisma.appointment.count as any)().catch(() => 0);

  return {
    totalServices,
    activeServices,
    inactiveServices,
    totalCategories: categoriesWithServices,
    activeCategoriesCount: categoriesWithServices,
    categoryBreakdown: categoryCounts,
    totalPlanAllocations: totalPlanLinks,
    totalScheduledAppointments: totalAppointments || 0,
  };
}

/**
 * Seed approved dynamic service plans and services if database catalog is empty.
 */
export async function seedInitialPlansAndServices() {
  let safetyService = await (prisma.serviceType.findFirst as any)({
    where: {
      OR: [
        { code: "SAFETY_OVERSIGHT" },
        { name: "Safety Oversight" },
        { category: "SAFETY_OVERSIGHT" },
      ],
    },
  });

  if (!safetyService) {
    safetyService = await (prisma.serviceType.create as any)({
      data: {
        name: "Safety Oversight",
        code: "SAFETY_OVERSIGHT",
        category: "SAFETY_OVERSIGHT",
        description: "Quarterly or bi-weekly home safety audits, hazard checks and wellness reports.",
        durationMinutes: 60,
        defaultPrice: 150,
        displayOrder: 1,
        isActive: true,
      },
    });
  }

  let cleaningService = await (prisma.serviceType.findFirst as any)({
    where: {
      OR: [
        { code: "HOME_CLEANING" },
        { name: "Home Cleaning" },
        { category: "CLEANING" },
      ],
    },
  });

  if (!cleaningService) {
    cleaningService = await (prisma.serviceType.create as any)({
      data: {
        name: "Home Cleaning",
        code: "HOME_CLEANING",
        category: "CLEANING",
        description: "HEPA allergen vacuuming, pathway clearing, kitchen & living area maintenance.",
        durationMinutes: 90,
        defaultPrice: 150,
        displayOrder: 2,
        isActive: true,
      },
    });
  }

  // 1. Seed / Sync "Essential Guard" Plan ($995/Quarterly - 6 Safety Oversight Visits)
  let essentialPlan = await (prisma.servicePlan.findFirst as any)({
    where: { code: "ESSENTIAL_GUARD" },
  });

  if (!essentialPlan) {
    essentialPlan = await createPlan({
      name: "Essential Guard",
      code: "ESSENTIAL_GUARD",
      shortDescription: "Essential non-medical home safety oversight and hazard mitigation.",
      fullDescription: "Comprehensive quarterly non-medical home safety oversight and hazard mitigation designed to protect and support independent senior living.",
      price: 995,
      billingInterval: "QUARTERLY",
      displayOrder: 1,
      features: [
        "6 Safety Oversight Visits / Quarter",
        "Home Safety Score & Hazard Assessment",
        "Family Portal Access with Live Reports",
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
  } else if (!essentialPlan.isActive || essentialPlan.isArchived) {
    essentialPlan = await (prisma.servicePlan.update as any)({
      where: { id: essentialPlan.id },
      data: { isActive: true, isArchived: false },
    });
  }

  // 2. Seed / Sync "Guardian Plus" Plan ($1892/Quarterly - 6 Safety + 6 Cleaning Visits)
  let guardianPlan = await (prisma.servicePlan.findFirst as any)({
    where: { code: "GUARDIAN_PLUS" },
  });

  if (!guardianPlan) {
    guardianPlan = await createPlan({
      name: "Guardian Plus",
      code: "GUARDIAN_PLUS",
      shortDescription: "Complete dual-protection safety oversight and specialized home cleaning.",
      fullDescription: "Complete dual-protection safety oversight and specialized environmental home cleaning. Includes 12 total visits per quarter.",
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
  } else if (!guardianPlan.isActive || guardianPlan.isArchived) {
    guardianPlan = await (prisma.servicePlan.update as any)({
      where: { id: guardianPlan.id },
      data: { isActive: true, isArchived: false },
    });
  }

  return { safetyService, cleaningService, essentialPlan, guardianPlan };
}
