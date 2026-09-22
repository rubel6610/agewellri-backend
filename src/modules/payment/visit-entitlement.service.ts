import prisma from "../../lib/prisma";

export interface VisitEntitlementItem {
  id: string;
  serviceTypeId?: string;
  serviceName: string;
  serviceCode: string | null;
  category?: string;
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

export function parsePlanDurationMinutes(times?: string | number | null): number {
  if (times === undefined || times === null || times === "") return 120;
  if (typeof times === "number") return isNaN(times) || times <= 0 ? 120 : times * 60;

  const str = String(times).trim().toLowerCase();
  if (
    str.includes("an hour") ||
    str.includes("one hour") ||
    str === "1" ||
    str === "1 hour" ||
    str === "1 hr" ||
    str === "up to an hour" ||
    str === "up to 1 hour"
  ) {
    return 60;
  }

  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const hours = parseFloat(match[1]);
    if (!isNaN(hours) && hours > 0) {
      return Math.round(hours * 60);
    }
  }
  return 120;
}

/**
 * Provisions VisitAllocations for a given SubscriptionPeriod based on the client's ServicePlan.
 */
export async function ensureVisitAllocationsForPeriod(
  subscriptionPeriodId: string,
  planId?: string | null,
  _hasCleaningAddon: boolean = false,
): Promise<void> {
  const period = await prisma.subscriptionPeriod.findUnique({
    where: { id: subscriptionPeriodId },
    include: {
      subscription: {
        include: {
          plan: true,
        },
      },
    },
  });

  if (!period) {
    throw new Error(`SubscriptionPeriod with ID ${subscriptionPeriodId} not found.`);
  }

  const sub = period.subscription;
  const targetPlan =
    (planId
      ? await prisma.servicePlan.findUnique({
          where: { id: planId },
        })
      : null) || sub?.plan;

  const totalVisits = Number((targetPlan as any)?.totalVisits ?? 2);
  const planName = targetPlan?.name || "";

  const existingAllocation = await (prisma.visitAllocation.findFirst as any)({
    where: { subscriptionPeriodId },
  });

  if (!existingAllocation) {
    await (prisma.visitAllocation.create as any)({
      data: {
        subscriptionPeriodId,
        serviceName: planName,
        allocatedCount: totalVisits,
        usedCount: 0,
      },
    });
  } else {
    await (prisma.visitAllocation.update as any)({
      where: { id: existingAllocation.id },
      data: {
        serviceName: planName,
        allocatedCount: totalVisits,
      },
    });
  }
}

/**
 * Formats period allocations and appointments into normalized Visit Entitlement items
 */
export function formatPeriodEntitlements(
  period: any,
  appointments: any[] = [],
  targetPlan?: any,
): VisitEntitlementItem[] {
  if (!period || !period.allocations || period.allocations.length === 0) {
    return [];
  }

  const periodAppts = (appointments || []).filter((a: any) => {
    if (a.subscriptionPeriodId) {
      return a.subscriptionPeriodId === period.id;
    }
    if (a.startAt && period.startDate && period.endDate) {
      const start = new Date(a.startAt).getTime();
      return (
        start >= new Date(period.startDate).getTime() &&
        start <= new Date(period.endDate).getTime()
      );
    }
    return false;
  });

  const planTimes = targetPlan?.times || period?.subscription?.plan?.times;
  const durationMinutes = parsePlanDurationMinutes(planTimes);

  return period.allocations.map((alloc: any) => {
    const scheduledCount = periodAppts.filter((a: any) =>
      ["SCHEDULED", "CONFIRMED", "RESCHEDULED"].includes(
        a.status?.toUpperCase(),
      ),
    ).length;

    const completedCount =
      alloc.usedCount > 0
        ? alloc.usedCount
        : periodAppts.filter(
            (a: any) => a.status?.toUpperCase() === "COMPLETED",
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
      serviceTypeId: alloc.id,
      serviceName: alloc.serviceName || "",
      serviceCode: "PLAN_VISIT",
      category: "SAFETY_OVERSIGHT",
      durationMinutes,
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
  userId: string,
): Promise<ClientVisitEntitlementsResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      client: {
        include: {
          subscriptions: {
            where: {
              status: { in: ["ACTIVE", "PENDING", "CANCELLATION_REQUESTED"] },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              plan: true,
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
      const periodEnd =
        activeSub.currentPeriodEnd ||
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const newPeriod = await prisma.subscriptionPeriod.create({
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
        activeSub?.planId,
        Boolean(client?.hasCleaningAddon),
      );

      const refreshedPeriod = await prisma.subscriptionPeriod.findUnique({
        where: { id: newPeriod.id },
        include: { allocations: true },
      });

      currentPeriod = refreshedPeriod;
    } catch (e: any) {
      console.warn("⚠️ Subscription period auto-provision notice:", e.message);
    }
  }

  // If period exists but has no allocations yet, ensure they are provisioned
  if (
    currentPeriod &&
    (!currentPeriod.allocations || currentPeriod.allocations.length === 0)
  ) {
    await ensureVisitAllocationsForPeriod(
      currentPeriod.id,
      activeSub?.planId,
      Boolean(client?.hasCleaningAddon),
    );

    const refreshedPeriod = await prisma.subscriptionPeriod.findUnique({
      where: { id: currentPeriod.id },
      include: {
        allocations: true,
      },
    });

    if (refreshedPeriod) {
      currentPeriod.allocations = refreshedPeriod.allocations;
    }
  }

  let entitlements = formatPeriodEntitlements(
    currentPeriod,
    client?.appointments || [],
    activeSub?.plan,
  );

  // If entitlements array is empty, derive dynamically from active subscription plan
  if (entitlements.length === 0 && activeSub?.plan) {
    const defaultVisits = Number((activeSub.plan as any)?.totalVisits ?? 0);
    const durationMinutes = parsePlanDurationMinutes(activeSub.plan.times);
    entitlements = [
      {
        id: "plan-quota",
        serviceTypeId: activeSub.plan.id,
        serviceName: activeSub.plan.name || "",
        serviceCode: activeSub.plan.code || "",
        category: "SAFETY_OVERSIGHT",
        durationMinutes,
        allocated: defaultVisits,
        scheduled: 0,
        completed: 0,
        remaining: defaultVisits,
        unit: "visits",
        status: "ACTIVE",
      },
    ];
  }

  const totalAllocated = entitlements.reduce(
    (sum, item) => sum + item.allocated,
    0,
  );
  const totalScheduled = entitlements.reduce(
    (sum, item) => sum + item.scheduled,
    0,
  );
  const totalCompleted = entitlements.reduce(
    (sum, item) => sum + item.completed,
    0,
  );
  const totalRemaining = entitlements.reduce(
    (sum, item) => sum + item.remaining,
    0,
  );

  const rawPlanName =
    activeSub?.plan?.name || (client as any)?.selectedPlan || "";

  let formattedPlanName = rawPlanName;
  if (formattedPlanName.includes("_") || formattedPlanName.includes("-")) {
    formattedPlanName = formattedPlanName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (char: string) => char.toUpperCase());
  }

  const planCode = activeSub?.plan?.code || (client as any)?.selectedPlan || "";

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
  clientId: string,
): Promise<ClientVisitEntitlementsResponse> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          plan: true,
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
  let currentPeriod: any = activeSub?.periods?.[0] || null;

  if (activeSub && !currentPeriod) {
    try {
      const now = new Date();
      const periodEnd =
        activeSub.currentPeriodEnd ||
        new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const newPeriod = await prisma.subscriptionPeriod.create({
        data: {
          subscriptionId: activeSub.id,
          periodNumber: 1,
          startDate: activeSub.currentPeriodStart || now,
          endDate: periodEnd,
          isCurrent: true,
          status: activeSub.status === "ACTIVE" ? "ACTIVE" : "PENDING",
          amount: activeSub.contractedPrice,
        },
      });

      await ensureVisitAllocationsForPeriod(
        newPeriod.id,
        activeSub?.planId,
        Boolean(client?.hasCleaningAddon),
      );

      const refreshedPeriod = await prisma.subscriptionPeriod.findUnique({
        where: { id: newPeriod.id },
        include: { allocations: true },
      });

      currentPeriod = refreshedPeriod;
    } catch (e: any) {
      console.warn("⚠️ Admin subscription period auto-provision notice:", e.message);
    }
  }

  if (
    currentPeriod &&
    (!currentPeriod.allocations || currentPeriod.allocations.length === 0)
  ) {
    await ensureVisitAllocationsForPeriod(
      currentPeriod.id,
      activeSub?.planId,
      client.hasCleaningAddon,
    );

    const refreshedPeriod = await prisma.subscriptionPeriod.findUnique({
      where: { id: currentPeriod.id },
      include: {
        allocations: true,
      },
    });

    if (refreshedPeriod) {
      currentPeriod.allocations = refreshedPeriod.allocations;
    }
  }

  const entitlements = formatPeriodEntitlements(
    currentPeriod,
    client.appointments || [],
    activeSub?.plan,
  );

  const totalAllocated = entitlements.reduce(
    (sum, item) => sum + item.allocated,
    0,
  );
  const totalScheduled = entitlements.reduce(
    (sum, item) => sum + item.scheduled,
    0,
  );
  const totalCompleted = entitlements.reduce(
    (sum, item) => sum + item.completed,
    0,
  );
  const totalRemaining = entitlements.reduce(
    (sum, item) => sum + item.remaining,
    0,
  );

  const planName =
    activeSub?.plan?.name || (client as any)?.selectedPlan || "";
  const planCode = activeSub?.plan?.code || (client as any)?.selectedPlan || "";

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
