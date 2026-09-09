import prisma from "../../lib/prisma";
import { ServiceTypeCategory } from "@prisma/client";

export interface VisitEntitlementItem {
  id: string;
  serviceTypeId: string;
  serviceName: string;
  serviceCode: string | null;
  category: ServiceTypeCategory | string;
  durationMinutes: number;
  allocated: number;
  scheduled: number;
  completed: number;
  remaining: number;
  unit: string;
  status: "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED";
}

export interface ClientVisitEntitlementsResponse {
  subscriptionId: string | null;
  planName: string;
  planCode: string;
  billingInterval: string;
  billingPeriod: {
    id: string;
    periodNumber: number;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    status: string;
  } | null;
  totalAllocated: number;
  totalScheduled: number;
  totalCompleted: number;
  totalRemaining: number;
  unscheduledCount: number;
  isNewQuarterReadyToSchedule: boolean;
  entitlements: VisitEntitlementItem[];
}

/**
 * Idempotently provisions VisitAllocations for a given SubscriptionPeriod
 * based on the plan version's / plan's configured PlanServices.
 */
export async function ensureVisitAllocationsForPeriod(
  subscriptionPeriodId: string,
  planVersionId?: string | null,
  planId?: string | null,
  hasCleaningAddon: boolean = false
): Promise<void> {
  const period = await (prisma.subscriptionPeriod.findUnique as any)({
    where: { id: subscriptionPeriodId },
    include: {
      subscription: {
        include: {
          plan: {
            include: {
              planServices: true,
            },
          },
          planVersion: {
            include: {
              planServices: true,
            },
          },
        },
      },
    },
  });

  if (!period) {
    throw new Error(`SubscriptionPeriod with ID ${subscriptionPeriodId} not found.`);
  }

  const sub = period.subscription;
  const targetVersion =
    (planVersionId
      ? await (prisma.planVersion.findUnique as any)({
          where: { id: planVersionId },
          include: { planServices: true },
        })
      : null) || sub?.planVersion;

  const targetPlan =
    (planId
      ? await (prisma.servicePlan.findUnique as any)({
          where: { id: planId },
          include: { planServices: true },
        })
      : null) || sub?.plan;

  // 1. Gather services from PlanVersion or fallback to ServicePlan
  let planServices: any[] = targetVersion?.planServices || targetPlan?.planServices || [];

  // If no specific PlanServices are attached to version/plan, find from DB by planId
  if (planServices.length === 0 && targetPlan?.id) {
    planServices = await (prisma.planService.findMany as any)({
      where: { planId: targetPlan.id },
    });
  }

  // 2. Iterate through plan services and upsert allocations
  if (planServices.length > 0) {
    for (const ps of planServices) {
      if (ps.serviceTypeId && ps.allocatedVisits > 0) {
        await (prisma.visitAllocation.upsert as any)({
          where: {
            subscriptionPeriodId_serviceTypeId: {
              subscriptionPeriodId,
              serviceTypeId: ps.serviceTypeId,
            },
          },
          create: {
            subscriptionPeriodId,
            serviceTypeId: ps.serviceTypeId,
            allocatedCount: ps.allocatedVisits,
            usedCount: 0,
          },
          update: {
            // Keep existing used count, only update allocated count if refreshed
            allocatedCount: ps.allocatedVisits,
          },
        });
      }
    }
  } else {
    // Fallback: Dynamically link active Safety Oversight service from Catalog
    const safetyService = await prisma.serviceType.findFirst({
      where: {
        OR: [
          { category: ServiceTypeCategory.SAFETY_OVERSIGHT },
          { name: { contains: "Safety", mode: "insensitive" } },
        ],
        isActive: true,
      },
    });

    if (safetyService) {
      await (prisma.visitAllocation.upsert as any)({
        where: {
          subscriptionPeriodId_serviceTypeId: {
            subscriptionPeriodId,
            serviceTypeId: safetyService.id,
          },
        },
        create: {
          subscriptionPeriodId,
          serviceTypeId: safetyService.id,
          allocatedCount: 6,
          usedCount: 0,
        },
        update: {},
      });
    }
  }

  // 3. Handle Cleaning Addon dynamically if enabled and not already allocated
  if (hasCleaningAddon) {
    const cleaningService = await prisma.serviceType.findFirst({
      where: {
        OR: [
          { category: ServiceTypeCategory.CLEANING },
          { name: { contains: "Cleaning", mode: "insensitive" } },
        ],
        isActive: true,
      },
    });

    if (cleaningService) {
      await (prisma.visitAllocation.upsert as any)({
        where: {
          subscriptionPeriodId_serviceTypeId: {
            subscriptionPeriodId,
            serviceTypeId: cleaningService.id,
          },
        },
        create: {
          subscriptionPeriodId,
          serviceTypeId: cleaningService.id,
          allocatedCount: 6,
          usedCount: 0,
        },
        update: {},
      });
    }
  }
}

/**
 * Formats period allocations and appointments into normalized Visit Entitlement items
 */
export function formatPeriodEntitlements(
  period: any,
  appointments: any[] = [],
  allServiceTypes: any[] = []
): VisitEntitlementItem[] {
  if (!period || !period.allocations || period.allocations.length === 0) {
    return [];
  }

  const stMap = new Map<string, any>(
    allServiceTypes.map((st: any) => [st.id, st])
  );

  const periodAppts = (appointments || []).filter((a: any) => {
    if (a.subscriptionPeriodId) {
      return a.subscriptionPeriodId === period.id;
    }
    // Date fallback if appointment start falls inside period window
    if (a.startAt && period.startDate && period.endDate) {
      const start = new Date(a.startAt).getTime();
      return start >= new Date(period.startDate).getTime() && start <= new Date(period.endDate).getTime();
    }
    return false;
  });

  return period.allocations.map((alloc: any) => {
    const st = alloc.serviceType || stMap.get(alloc.serviceTypeId) || {};
    const serviceTypeId = alloc.serviceTypeId;

    const scheduledCount = periodAppts.filter(
      (a: any) =>
        a.serviceTypeId === serviceTypeId &&
        ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(a.status?.toUpperCase())
    ).length;

    const completedCount =
      alloc.usedCount > 0
        ? alloc.usedCount
        : periodAppts.filter(
            (a: any) =>
              a.serviceTypeId === serviceTypeId &&
              a.status?.toUpperCase() === "COMPLETED"
          ).length;

    const allocated = alloc.allocatedCount || 0;
    const remaining = Math.max(0, allocated - (scheduledCount + completedCount));

    let status: "ACTIVE" | "EXHAUSTED" | "EXPIRED" | "CANCELLED" = "ACTIVE";
    if (period.status === "CANCELLED" || period.status === "EXPIRED") {
      status = period.status;
    } else if (remaining === 0) {
      status = "EXHAUSTED";
    }

    return {
      id: alloc.id,
      serviceTypeId: alloc.serviceTypeId,
      serviceName: st.name || "Home Care Visit",
      serviceCode: st.code || null,
      category: st.category || "OTHER",
      durationMinutes: st.durationMinutes || 60,
      allocated,
      scheduled: scheduledCount,
      completed: completedCount,
      remaining,
      unit: "visits",
      status,
    };
  });
}

/**
 * GET current visit entitlements for an authenticated Client user
 */
export async function getClientVisitEntitlements(
  userId: string
): Promise<ClientVisitEntitlementsResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: {
            where: { status: { in: ["ACTIVE", "PENDING", "CANCELLATION_REQUESTED"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              plan: true,
              planVersion: true,
              periods: {
                orderBy: { startDate: "desc" },
                take: 1,
                include: {
                  allocations: true,
                },
              },
            },
          },
          appointments: {
            where: { status: { not: "CANCELLED" } },
          },
        },
      },
    },
  });

  const client = user?.client;
  let activeSub = client?.subscriptions?.[0] || null;
  let currentPeriod = activeSub?.periods?.[0] || null;

  // Auto-provision initial SubscriptionPeriod if active subscription exists without periods
  if (activeSub && !currentPeriod) {
    try {
      const now = new Date();
      const periodEnd = activeSub.currentPeriodEnd || new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
      const newPeriod = await (prisma.subscriptionPeriod.create as any)({
        data: {
          subscriptionId: activeSub.id,
          periodNumber: 1,
          startDate: activeSub.currentPeriodStart || now,
          endDate: periodEnd,
          isCurrent: true,
          status: "ACTIVE",
          amount: activeSub.contractedPrice,
        },
      });

      await ensureVisitAllocationsForPeriod(
        newPeriod.id,
        activeSub?.planVersionId,
        activeSub?.planId,
        client?.hasCleaningAddon || activeSub.plan?.code === "GUARDIAN_PLUS"
      );

      const refreshedPeriod = await (prisma.subscriptionPeriod.findUnique as any)({
        where: { id: newPeriod.id },
        include: { allocations: true },
      });

      currentPeriod = refreshedPeriod;
    } catch (e: any) {
      console.warn("⚠️ Subscription period auto-provision notice:", e.message);
    }
  }

  // If period exists but has no allocations yet, ensure they are provisioned
  if (currentPeriod && (!currentPeriod.allocations || currentPeriod.allocations.length === 0)) {
    await ensureVisitAllocationsForPeriod(
      currentPeriod.id,
      activeSub?.planVersionId,
      activeSub?.planId,
      client?.hasCleaningAddon || activeSub?.plan?.code === "GUARDIAN_PLUS"
    );

    // Re-fetch period allocations
    const refreshedPeriod = await (prisma.subscriptionPeriod.findUnique as any)({
      where: { id: currentPeriod.id },
      include: {
        allocations: true,
      },
    });

    if (refreshedPeriod) {
      currentPeriod.allocations = refreshedPeriod.allocations;
    }
  }

  const allServiceTypes = await prisma.serviceType.findMany();
  let entitlements = formatPeriodEntitlements(currentPeriod, client?.appointments || [], allServiceTypes);

  // Fallback defaults if entitlements array is empty (e.g. preview state)
  const isGuardianPlus =
    activeSub?.plan?.code === "GUARDIAN_PLUS" ||
    client?.selectedPlan === "GUARDIAN_PLUS" ||
    !client?.selectedPlan;

  if (entitlements.length === 0) {
    entitlements = [
      {
        id: "default-safety-quota",
        serviceTypeId: "safety-oversight",
        serviceName: "Safety Oversight Visit",
        serviceCode: "SAFETY_OVERSIGHT",
        category: "SAFETY_OVERSIGHT",
        durationMinutes: 60,
        allocated: 6,
        scheduled: 0,
        completed: 0,
        remaining: 6,
        unit: "visits",
        status: "ACTIVE",
      },
      ...(isGuardianPlus
        ? [
            {
              id: "default-cleaning-quota",
              serviceTypeId: "cleaning-support",
              serviceName: "Home Cleaning Visit",
              serviceCode: "CLEANING_SUPPORT",
              category: "CLEANING_SUPPORT",
              durationMinutes: 90,
              allocated: 6,
              scheduled: 0,
              completed: 0,
              remaining: 6,
              unit: "visits",
              status: "ACTIVE" as const,
            },
          ]
        : []),
    ];
  }

  const totalAllocated = entitlements.reduce((sum, item) => sum + item.allocated, 0);
  const totalScheduled = entitlements.reduce((sum, item) => sum + item.scheduled, 0);
  const totalCompleted = entitlements.reduce((sum, item) => sum + item.completed, 0);
  const totalRemaining = entitlements.reduce((sum, item) => sum + item.remaining, 0);

  const rawPlanName =
    activeSub?.planVersion?.name || activeSub?.plan?.name || client?.selectedPlan || "Guardian Plus Plan";
  
  let formattedPlanName = rawPlanName;
  if (rawPlanName === "GUARDIAN_PLUS" || rawPlanName.toLowerCase().includes("guardian")) {
    formattedPlanName = "Guardian Plus Plan";
  } else if (rawPlanName === "ESSENTIAL_GUARD" || rawPlanName.toLowerCase().includes("essential")) {
    formattedPlanName = "Essential Guard Plan";
  } else if (rawPlanName === "STANDALONE_CLEANING" || rawPlanName.toLowerCase().includes("clean")) {
    formattedPlanName = "Home Care & Cleaning Plan";
  }

  const planCode = activeSub?.plan?.code || client?.selectedPlan || "GUARDIAN_PLUS";

  return {
    subscriptionId: activeSub?.id || null,
    planName: formattedPlanName,
    planCode,
    billingInterval: activeSub?.billingInterval || "MONTHLY",
    billingPeriod: currentPeriod
      ? {
          id: currentPeriod.id,
          periodNumber: currentPeriod.periodNumber,
          startDate: currentPeriod.startDate.toISOString(),
          endDate: currentPeriod.endDate.toISOString(),
          isCurrent: currentPeriod.isCurrent,
          status: currentPeriod.status,
        }
      : null,
    totalAllocated,
    totalScheduled,
    totalCompleted,
    totalRemaining,
    unscheduledCount: totalRemaining,
    isNewQuarterReadyToSchedule: Boolean(currentPeriod && totalRemaining > 0),
    entitlements,
  };
}

/**
 * GET visit entitlements for any Client by ID (Admin authorization)
 */
export async function getAdminClientVisitEntitlements(
  clientId: string
): Promise<ClientVisitEntitlementsResponse> {
  const client = await (prisma.client.findUnique as any)({
    where: { id: clientId },
    include: {
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          plan: true,
          planVersion: true,
          periods: {
            orderBy: { startDate: "desc" },
            take: 1,
            include: {
              allocations: true,
            },
          },
        },
      },
      appointments: {
        where: { status: { not: "CANCELLED" } },
      },
    },
  });

  if (!client) {
    throw new Error(`Client with ID ${clientId} not found.`);
  }

  const activeSub = client.subscriptions?.[0] || null;
  const currentPeriod = activeSub?.periods?.[0] || null;

  if (currentPeriod && (!currentPeriod.allocations || currentPeriod.allocations.length === 0)) {
    await ensureVisitAllocationsForPeriod(
      currentPeriod.id,
      activeSub?.planVersionId,
      activeSub?.planId,
      client.hasCleaningAddon
    );

    const refreshedPeriod = await (prisma.subscriptionPeriod.findUnique as any)({
      where: { id: currentPeriod.id },
      include: {
        allocations: true,
      },
    });

    if (refreshedPeriod) {
      currentPeriod.allocations = refreshedPeriod.allocations;
    }
  }

  const allServiceTypes = await prisma.serviceType.findMany();
  const entitlements = formatPeriodEntitlements(currentPeriod, client.appointments || [], allServiceTypes);

  const totalAllocated = entitlements.reduce((sum, item) => sum + item.allocated, 0);
  const totalScheduled = entitlements.reduce((sum, item) => sum + item.scheduled, 0);
  const totalCompleted = entitlements.reduce((sum, item) => sum + item.completed, 0);
  const totalRemaining = entitlements.reduce((sum, item) => sum + item.remaining, 0);

  const planName =
    activeSub?.planVersion?.name || activeSub?.plan?.name || client.selectedPlan || "Guardian Plus";
  const planCode = activeSub?.plan?.code || client.selectedPlan || "GUARDIAN_PLUS";

  return {
    subscriptionId: activeSub?.id || null,
    planName,
    planCode,
    billingInterval: activeSub?.billingInterval || "MONTHLY",
    billingPeriod: currentPeriod
      ? {
          id: currentPeriod.id,
          periodNumber: currentPeriod.periodNumber,
          startDate: currentPeriod.startDate.toISOString(),
          endDate: currentPeriod.endDate.toISOString(),
          isCurrent: currentPeriod.isCurrent,
          status: currentPeriod.status,
        }
      : null,
    totalAllocated,
    totalScheduled,
    totalCompleted,
    totalRemaining,
    unscheduledCount: totalRemaining,
    isNewQuarterReadyToSchedule: Boolean(currentPeriod && totalRemaining > 0),
    entitlements,
  };
}
