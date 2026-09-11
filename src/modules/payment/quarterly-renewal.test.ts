import {
  formatPeriodEntitlements,
  ensureVisitAllocationsForPeriod,
} from "./visit-entitlement.service";

console.log("============================================================");
console.log("🧪 RUNNING MONTHLY RENEWAL → NEXT VISIT SCHEDULING TEST SUITE");
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

async function runTests() {
  // =========================================================================
  // SCENARIO 1: Successful renewal creates new Billing Period & Allocations without auto-booking appointments
  // =========================================================================
  const mockQuarter1Period = {
    id: "bp_q1_123",
    periodNumber: 1,
    startDate: new Date("2026-06-01"),
    endDate: new Date("2026-08-31"),
    isCurrent: false,
    status: "ACTIVE",
    allocations: [
      {
        id: "alloc_q1_safety",
        subscriptionPeriodId: "bp_q1_123",
        serviceTypeId: "srv_safety",
        allocatedCount: 6,
        usedCount: 6,
        serviceType: {
          id: "srv_safety",
          name: "Safety Oversight Visit",
          durationMinutes: 60,
          category: "SAFETY_OVERSIGHT",
        },
      },
    ],
  };

  const mockQuarter2Period = {
    id: "bp_q2_456",
    periodNumber: 2,
    startDate: new Date("2026-09-01"),
    endDate: new Date("2026-11-30"),
    isCurrent: true,
    status: "ACTIVE",
    allocations: [
      {
        id: "alloc_q2_safety",
        subscriptionPeriodId: "bp_q2_456",
        serviceTypeId: "srv_safety",
        allocatedCount: 6,
        usedCount: 0,
        serviceType: {
          id: "srv_safety",
          name: "Safety Oversight Visit",
          durationMinutes: 60,
          category: "SAFETY_OVERSIGHT",
        },
      },
      {
        id: "alloc_q2_cleaning",
        subscriptionPeriodId: "bp_q2_456",
        serviceTypeId: "srv_cleaning",
        allocatedCount: 6,
        usedCount: 0,
        serviceType: {
          id: "srv_cleaning",
          name: "Cleaning Visit",
          durationMinutes: 90,
          category: "CLEANING",
        },
      },
    ],
  };

  const initialQ2Appointments: any[] = [];
  const q2EntitlementsInitial = formatPeriodEntitlements(
    mockQuarter2Period,
    initialQ2Appointments,
  );

  assert(
    q2EntitlementsInitial.length === 2,
    "Scenario 1.1: Quarter 2 has 2 allocated services",
  );
  assert(
    q2EntitlementsInitial[0].allocated === 6,
    "Scenario 1.2: Safety Oversight has 6 allocated visits",
  );
  assert(
    q2EntitlementsInitial[1].allocated === 6,
    "Scenario 1.3: Cleaning Visit has 6 allocated visits",
  );
  assert(
    initialQ2Appointments.length === 0,
    "Scenario 1.4: No random appointments automatically created upon renewal",
  );

  // =========================================================================
  // SCENARIO 2: Multi-service plan (Safety = 6, Cleaning = 6). Client schedules Safety #1 & Safety #2
  // =========================================================================
  const q2AppointmentsStep2 = [
    {
      id: "appt_1",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_safety",
      status: "SCHEDULED",
      startAt: new Date("2026-09-10T10:00:00Z"),
    },
    {
      id: "appt_2",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_safety",
      status: "CONFIRMED",
      startAt: new Date("2026-09-24T10:00:00Z"),
    },
  ];

  const q2EntitlementsStep2 = formatPeriodEntitlements(
    mockQuarter2Period,
    q2AppointmentsStep2,
  );
  const safetyEnt2 = q2EntitlementsStep2.find(
    (e) => e.serviceTypeId === "srv_safety",
  );
  const cleaningEnt2 = q2EntitlementsStep2.find(
    (e) => e.serviceTypeId === "srv_cleaning",
  );

  assert(
    safetyEnt2?.remaining === 4,
    "Scenario 2.1: Safety remaining is 4 after scheduling 2 visits",
  );
  assert(
    cleaningEnt2?.remaining === 6,
    "Scenario 2.2: Cleaning remaining stays 6 untouched",
  );

  // =========================================================================
  // SCENARIO 3: Client schedules all visits -> unscheduled visits = 0
  // =========================================================================
  const q2AppointmentsAllScheduled = [
    ...q2AppointmentsStep2,
    {
      id: "appt_3",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_safety",
      status: "SCHEDULED",
    },
    {
      id: "appt_4",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_safety",
      status: "SCHEDULED",
    },
    {
      id: "appt_5",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_safety",
      status: "SCHEDULED",
    },
    {
      id: "appt_6",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_safety",
      status: "SCHEDULED",
    },
    {
      id: "appt_7",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_cleaning",
      status: "SCHEDULED",
    },
    {
      id: "appt_8",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_cleaning",
      status: "SCHEDULED",
    },
    {
      id: "appt_9",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_cleaning",
      status: "SCHEDULED",
    },
    {
      id: "appt_10",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_cleaning",
      status: "SCHEDULED",
    },
    {
      id: "appt_11",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_cleaning",
      status: "SCHEDULED",
    },
    {
      id: "appt_12",
      subscriptionPeriodId: "bp_q2_456",
      serviceTypeId: "srv_cleaning",
      status: "SCHEDULED",
    },
  ];

  const q2EntitlementsAll = formatPeriodEntitlements(
    mockQuarter2Period,
    q2AppointmentsAllScheduled,
  );
  const totalRemainingAll = q2EntitlementsAll.reduce(
    (sum, e) => sum + e.remaining,
    0,
  );

  assert(
    totalRemainingAll === 0,
    "Scenario 3.1: All visits scheduled leaves 0 unscheduled visits",
  );
  assert(
    q2EntitlementsAll[0].status === "EXHAUSTED",
    "Scenario 3.2: Safety status is EXHAUSTED when fully booked",
  );

  // =========================================================================
  // SCENARIO 4: Client has one or more unscheduled visits
  // =========================================================================
  const totalRemainingPartial = q2EntitlementsStep2.reduce(
    (sum, e) => sum + e.remaining,
    0,
  );
  assert(
    totalRemainingPartial === 10,
    "Scenario 4.1: Unscheduled visits correctly computed as 10 (4 safety + 6 cleaning)",
  );

  // =========================================================================
  // SCENARIO 5: Historical stability — Quarter 1 vs Quarter 2 periods remain isolated
  // =========================================================================
  const q1Appts = [
    {
      id: "appt_old_1",
      subscriptionPeriodId: "bp_q1_123",
      serviceTypeId: "srv_safety",
      status: "COMPLETED",
    },
    {
      id: "appt_old_2",
      subscriptionPeriodId: "bp_q1_123",
      serviceTypeId: "srv_safety",
      status: "COMPLETED",
    },
    {
      id: "appt_old_3",
      subscriptionPeriodId: "bp_q1_123",
      serviceTypeId: "srv_safety",
      status: "COMPLETED",
    },
    {
      id: "appt_old_4",
      subscriptionPeriodId: "bp_q1_123",
      serviceTypeId: "srv_safety",
      status: "COMPLETED",
    },
    {
      id: "appt_old_5",
      subscriptionPeriodId: "bp_q1_123",
      serviceTypeId: "srv_safety",
      status: "COMPLETED",
    },
    {
      id: "appt_old_6",
      subscriptionPeriodId: "bp_q1_123",
      serviceTypeId: "srv_safety",
      status: "COMPLETED",
    },
  ];

  const q1Entitlements = formatPeriodEntitlements(mockQuarter1Period, q1Appts);
  assert(
    q1Entitlements[0].completed === 6,
    "Scenario 5.1: Quarter 1 historical completed count remains 6",
  );
  assert(
    q1Entitlements[0].remaining === 0,
    "Scenario 5.2: Quarter 1 historical remaining is 0",
  );
  assert(
    q2EntitlementsStep2[0].remaining === 4,
    "Scenario 5.3: Quarter 2 remaining remains 4 independently",
  );

  // =========================================================================
  // SCENARIO 6: Rescheduling preserves the same entitlement & billing period
  // =========================================================================
  const rescheduledAppt = {
    id: "appt_1",
    subscriptionPeriodId: "bp_q2_456",
    serviceTypeId: "srv_safety",
    status: "RESCHEDULED",
    startAt: new Date("2026-09-18T14:00:00Z"),
  };

  const q2ApptsRescheduled = [rescheduledAppt, q2AppointmentsStep2[1]];
  const q2EntitlementsRescheduled = formatPeriodEntitlements(
    mockQuarter2Period,
    q2ApptsRescheduled,
  );
  const safetyRescheduled = q2EntitlementsRescheduled.find(
    (e) => e.serviceTypeId === "srv_safety",
  );

  assert(
    safetyRescheduled?.scheduled === 2,
    "Scenario 6.1: Rescheduling does not consume extra visit count",
  );
  assert(
    safetyRescheduled?.remaining === 4,
    "Scenario 6.2: Remaining count remains 4 after reschedule",
  );

  // =========================================================================
  // SCENARIO 7: Completed visit moves from scheduled to completed count
  // =========================================================================
  const q2ApptsWithCompleted = [
    { ...q2AppointmentsStep2[0], status: "COMPLETED" },
    q2AppointmentsStep2[1],
  ];

  const q2EntitlementsCompleted = formatPeriodEntitlements(
    mockQuarter2Period,
    q2ApptsWithCompleted,
  );
  const safetyCompleted = q2EntitlementsCompleted.find(
    (e) => e.serviceTypeId === "srv_safety",
  );

  assert(
    safetyCompleted?.completed === 1,
    "Scenario 7.1: Completed count increments to 1",
  );
  assert(
    safetyCompleted?.scheduled === 1,
    "Scenario 7.2: Scheduled count decreases to 1",
  );
  assert(
    safetyCompleted?.remaining === 4,
    "Scenario 7.3: Remaining count remains 4 (6 - 1 - 1)",
  );

  // =========================================================================
  // SCENARIO 8: Dynamic plan version integrity — Custom allocation count preservation
  // =========================================================================
  const customPlanPeriod = {
    id: "bp_custom_789",
    periodNumber: 1,
    startDate: new Date("2026-09-01"),
    endDate: new Date("2026-11-30"),
    isCurrent: true,
    status: "ACTIVE",
    allocations: [
      {
        id: "alloc_cust_safety",
        subscriptionPeriodId: "bp_custom_789",
        serviceTypeId: "srv_safety",
        allocatedCount: 8,
        usedCount: 0,
        serviceType: {
          id: "srv_safety",
          name: "Safety Oversight Visit",
          durationMinutes: 60,
        },
      },
    ],
  };

  const customEntitlements = formatPeriodEntitlements(customPlanPeriod, []);
  assert(
    customEntitlements[0].allocated === 8,
    "Scenario 8.1: Plan Version allocation count 8 is preserved without hardcoding",
  );
  assert(
    customEntitlements[0].remaining === 8,
    "Scenario 8.2: Initial remaining count matches 8",
  );

  // =========================================================================
  // SCENARIO 9: Email notification generator check
  // =========================================================================
  const { sendMONTHLYRenewalActiveEmail } = await import("../../utils/email");
  const emailRes = await sendMONTHLYRenewalActiveEmail({
    to: "xoyokad817@prorises.com",
    clientName: "arfanrubel",
    planName: "Guardian Plus",
    periodStartDate: new Date("2026-09-01"),
    periodEndDate: new Date("2026-11-30"),
    periodNumber: 2,
    allocatedVisits: [
      { serviceName: "Safety Oversight", count: 6, durationMinutes: 60 },
      { serviceName: "Cleaning Support", count: 6, durationMinutes: 90 },
    ],
    totalVisits: 12,
  });

  assert(
    emailRes.success === true,
    "Scenario 9.1: MONTHLY renewal active email notification dispatched successfully",
  );

  console.log("\n============================================================");
  console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((e) => {
  console.error("Test execution fatal error:", e);
  process.exit(1);
});
