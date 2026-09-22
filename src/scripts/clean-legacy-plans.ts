import prisma from '../lib/prisma.js';

async function migrateLegacyPlans() {
  console.log("🚀 Starting DB cleanup for legacy plan codes (removing everything except THE_INDEPENDENCE_UPKEEP_PLAN and THE_PREMIUM_SAFETY_SAFEGUARD)...");

  const validPlanCodes = [
    "THE_INDEPENDENCE_UPKEEP_PLAN",
    "THE INDEPENDENCE & UPKEEP PLAN",
    "THE_PREMIUM_SAFETY_SAFEGUARD",
    "THE PREMIUM SAFETY SAFEGUARD"
  ];

  // 1. Clear selectedPlan on Clients that are NOT valid plans
  const updatedClients = await (prisma as any).client.updateMany({
    where: {
      selectedPlan: {
        notIn: validPlanCodes
      }
    },
    data: {
      selectedPlan: null
    }
  });
  console.log(`✅ Cleared selectedPlan for ${updatedClients.count} clients with legacy plan codes.`);

  // 2. Clear selectedPlan on ServiceAgreements that are NOT valid plans
  const updatedAgreements = await (prisma as any).serviceAgreement.updateMany({
    where: {
      selectedPlan: {
        notIn: validPlanCodes
      }
    },
    data: {
      selectedPlan: null
    }
  });
  console.log(`✅ Cleared selectedPlan for ${updatedAgreements.count} agreements with legacy plan codes.`);

  // 3. Clear orphaned Subscriptions pointing to invalid/deleted plans
  const activePlans = await (prisma as any).servicePlan.findMany({
    where: { code: { in: validPlanCodes } }
  });
  const validPlanIds = activePlans.map((p: any) => p.id);

  const updatedSubs = await (prisma as any).subscription.deleteMany({
    where: {
      OR: [
        { planId: { notIn: validPlanIds } },
        { planId: null }
      ]
    }
  });
  console.log(`✅ Cleaned up ${updatedSubs.count} legacy/orphaned subscription records.`);

  // 4. Verification: Compute new planDistribution
  const allClients = await (prisma as any).client.findMany({
    include: {
      subscriptions: {
        include: { plan: true }
      }
    }
  });

  const planDistribution: Record<string, number> = {};
  allClients.forEach((c: any) => {
    const planName =
      c.subscriptions?.[0]?.plan?.name || c.selectedPlan ;
    planDistribution[planName] = (planDistribution[planName] || 0) + 1;
  });

  console.log("\n=======================================================");
  console.log("🎉 DB CLEANUP COMPLETE! NEW OVERVIEW PLAN BREAKDOWN:");
  console.log("=======================================================");
  console.dir(planDistribution, { depth: null });
  console.log("=======================================================\n");
}

migrateLegacyPlans()
  .catch(console.error)
  .finally(() => (prisma as any).$disconnect());
