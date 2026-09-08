import { formatPeriodEntitlements } from "./visit-entitlement.service";

console.log("============================================================");
console.log("🧪 RUNNING VISIT ENTITLEMENT & SERVICE ALLOCATION TEST SUITE");
console.log("============================================================\n");

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`❌ FAIL: ${testName}`);
    failed++;
  }
}

// 1. Scenario 1: Guardian Plus period with Safety = 6 and Cleaning = 6
const guardianPeriod = {
  id: "period_1",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2026-11-30"),
  status: "ACTIVE",
  allocations: [
    {
      id: "alloc_1",
      serviceTypeId: "srv_safety",
      allocatedCount: 6,
      usedCount: 0,
      serviceType: { id: "srv_safety", name: "Safety Oversight Visit", durationMinutes: 60 },
    },
    {
      id: "alloc_2",
      serviceTypeId: "srv_cleaning",
      allocatedCount: 6,
      usedCount: 0,
      serviceType: { id: "srv_cleaning", name: "Cleaning Visit", durationMinutes: 90 },
    },
  ],
};

const apptsQuarter1 = [
  { serviceTypeId: "srv_safety", status: "SCHEDULED", subscriptionPeriodId: "period_1" },
  { serviceTypeId: "srv_safety", status: "COMPLETED", subscriptionPeriodId: "period_1" },
  { serviceTypeId: "srv_cleaning", status: "CONFIRMED", subscriptionPeriodId: "period_1" },
];

const res1 = formatPeriodEntitlements(guardianPeriod, apptsQuarter1);

assert(res1.length === 2, "1. Guardian Plus yields 2 entitlement items");
assert(res1[0].allocated === 6, "2. Safety Oversight allocated is 6");
assert(res1[0].scheduled === 1, "3. Safety Oversight scheduled is 1");
assert(res1[0].completed === 1, "4. Safety Oversight completed is 1");
assert(res1[0].remaining === 4, "5. Safety Oversight remaining is 4 (6 - 1 - 1)");
assert(res1[1].allocated === 6, "6. Cleaning Visit allocated is 6");
assert(res1[1].scheduled === 1, "7. Cleaning Visit scheduled is 1");
assert(res1[1].remaining === 5, "8. Cleaning Visit remaining is 5 (6 - 1)");

// 2. Scenario 2: Essential Guard period (Safety = 6 only)
const essentialPeriod = {
  id: "period_essential",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2026-11-30"),
  status: "ACTIVE",
  allocations: [
    {
      id: "alloc_ess_1",
      serviceTypeId: "srv_safety",
      allocatedCount: 6,
      usedCount: 0,
      serviceType: { id: "srv_safety", name: "Safety Oversight Visit", durationMinutes: 60 },
    },
  ],
};

const res2 = formatPeriodEntitlements(essentialPeriod, []);
assert(res2.length === 1, "9. Essential Guard yields exactly 1 entitlement");
assert(res2[0].remaining === 6, "10. Essential Guard has 6 remaining visits");

// 3. Scenario 3: Custom dynamic plan with Safety = 10
const customPeriod = {
  id: "period_custom",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2026-11-30"),
  status: "ACTIVE",
  allocations: [
    {
      id: "alloc_cust_1",
      serviceTypeId: "srv_safety",
      allocatedCount: 10,
      usedCount: 0,
      serviceType: { id: "srv_safety", name: "Safety Oversight Visit", durationMinutes: 60 },
    },
  ],
};

const res3 = formatPeriodEntitlements(customPeriod, []);
assert(res3[0].allocated === 10, "11. Dynamic plan allocates custom count 10 without hardcoding");
assert(res3[0].remaining === 10, "12. Dynamic plan remaining is 10");

// 4. Scenario 4: Historical stability across renewals
const periodQuarter2 = {
  id: "period_2",
  startDate: new Date("2026-12-01"),
  endDate: new Date("2027-02-28"),
  status: "ACTIVE",
  allocations: [
    {
      id: "alloc_q2_1",
      serviceTypeId: "srv_safety",
      allocatedCount: 6,
      usedCount: 0,
      serviceType: { id: "srv_safety", name: "Safety Oversight Visit", durationMinutes: 60 },
    },
  ],
};

const resQ1 = formatPeriodEntitlements(guardianPeriod, apptsQuarter1);
const resQ2 = formatPeriodEntitlements(periodQuarter2, []);

assert(resQ1[0].remaining === 4, "13. Quarter 1 historical entitlement remains intact at 4 remaining");
assert(resQ2[0].remaining === 6, "14. Quarter 2 gets fresh entitlement set with 6 remaining");

console.log("\n============================================================");
console.log(`📊 SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log("============================================================\n");

if (failed > 0) {
  process.exit(1);
}
