import { parseDateAndTimeSlot, formatAppointmentRecord, isValidObjectId } from "./appointment.service";
import { formatPeriodEntitlements } from "../payment/visit-entitlement.service";

console.log("============================================================");
console.log("🧪 RUNNING VISIT SCHEDULING & APPOINTMENT WORKFLOW TEST SUITE");
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

// 0. Test MongoDB ObjectId validator
assert(isValidObjectId("64b1f28e34a0a1b2c3d4e5f6") === true, "0a. 24-char hex is valid ObjectId");
assert(isValidObjectId("AW-1015") === false, "0b. ClientNumber 'AW-1015' is recognized as non-ObjectId slug");
assert(isValidObjectId("AW-1027") === false, "0c. ClientNumber 'AW-1027' is recognized as non-ObjectId slug");
assert(isValidObjectId("") === false, "0d. Empty string is invalid ObjectId");
assert(isValidObjectId(undefined) === false, "0e. Undefined is invalid ObjectId");

// 1. Test Date & Time Slot Parser
const { startAt, endAt } = parseDateAndTimeSlot("2026-09-20", "10:00 AM – 12:00 PM");
assert(startAt instanceof Date && !isNaN(startAt.getTime()), "1. startAt is valid Date object");
assert(endAt instanceof Date && !isNaN(endAt.getTime()), "2. endAt is valid Date object");
assert(startAt.getHours() === 10 && startAt.getMinutes() === 0, "3. startAt hour is 10:00");
assert(endAt.getHours() === 12 && endAt.getMinutes() === 0, "4. endAt hour is 12:00");

// 2. Test PM Timeslot
const afternoon = parseDateAndTimeSlot("2026-09-20", "01:30 PM – 03:30 PM");
assert(afternoon.startAt.getHours() === 13 && afternoon.startAt.getMinutes() === 30, "5. Afternoon startAt hour is 13:30");
assert(afternoon.endAt.getHours() === 15 && afternoon.endAt.getMinutes() === 30, "6. Afternoon endAt hour is 15:30");

// 3. Test formatAppointmentRecord mapping
const mockAppt = {
  id: "appt_test_01",
  clientId: "client_101",
  serviceTypeId: "srv_safety",
  subscriptionPeriodId: "period_01",
  technicianId: "tech_01",
  startAt: new Date("2026-09-20T14:00:00.000Z"),
  endAt: new Date("2026-09-20T16:00:00.000Z"),
  status: "SCHEDULED",
  location: "123 Elm St, Providence RI",
  notes: "Please call on arrival.",
  createdAt: new Date(),
  serviceType: {
    id: "srv_safety",
    name: "Safety Oversight Visit",
    category: "SAFETY_OVERSIGHT",
    durationMinutes: 60,
  },
  technician: {
    id: "tech_01",
    name: "Marcus Vance",
    title: "Certified Home Safety Specialist",
    phone: "401-555-0199",
    color: "#294B68",
  },
  client: {
    id: "client_101",
    clientNumber: "AW-1001",
    address: "123 Elm St",
    city: "Providence",
    state: "RI",
    postalCode: "02903",
    user: {
      firstName: "Martha",
      lastName: "Stewart",
      email: "martha@example.com",
      phone: "401-555-0100",
    },
  },
  createdByUser: {
    firstName: "Martha",
    lastName: "Stewart",
  },
};

const formatted = formatAppointmentRecord(mockAppt);
assert(formatted.id === "appt_test_01", "7. Appointment ID matches");
assert(formatted.clientName === "Martha Stewart", "8. Client name matches");
assert(formatted.serviceType === "Safety Oversight Visit", "9. Service type name matches");
assert(formatted.technicianName === "Marcus Vance", "10. Technician name matches");
assert(formatted.status === "scheduled", "11. Status normalized to lowercase");

// 4. Test Entitlement Deduction when Appointment is Scheduled
const mockPeriod = {
  id: "period_01",
  startDate: new Date("2026-09-01"),
  endDate: new Date("2026-11-30"),
  status: "ACTIVE",
  allocations: [
    {
      id: "alloc_01",
      serviceTypeId: "srv_safety",
      allocatedCount: 6,
      usedCount: 0,
      serviceType: { id: "srv_safety", name: "Safety Oversight Visit", category: "SAFETY_OVERSIGHT" },
    },
  ],
};

// Initial state: 0 appointments scheduled
const entBefore = formatPeriodEntitlements(mockPeriod, []);
assert(entBefore[0].remaining === 6, "12. Initial remaining count is 6");
assert(entBefore[0].scheduled === 0, "13. Initial scheduled count is 0");

// After 1 appointment scheduled
const entAfterSchedule = formatPeriodEntitlements(mockPeriod, [
  { serviceTypeId: "srv_safety", status: "SCHEDULED", subscriptionPeriodId: "period_01" },
]);
assert(entAfterSchedule[0].scheduled === 1, "14. Scheduled count increases to 1");
assert(entAfterSchedule[0].remaining === 5, "15. Remaining visits decrements to 5 (6 - 1)");

// After appointment is cancelled
const entAfterCancel = formatPeriodEntitlements(mockPeriod, [
  { serviceTypeId: "srv_safety", status: "CANCELLED", subscriptionPeriodId: "period_01" },
]);
assert(entAfterCancel[0].scheduled === 0, "16. Cancelled appointment is excluded from scheduled count");
assert(entAfterCancel[0].remaining === 6, "17. Entitlement quota is fully restored to 6");

console.log("\n============================================================");
console.log(`📊 SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log("============================================================\n");

if (failed > 0) {
  process.exit(1);
}
