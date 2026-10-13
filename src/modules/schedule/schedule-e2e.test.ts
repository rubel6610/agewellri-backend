import {
  calculateDateAvailability,
  getCalendarRangeAvailability,
  validateAppointmentTimeWithinSchedule,
  minutesToTimeString,
  timeStringToMinutes,
  INITIAL_DEFAULT_DAYS,
} from "./schedule.service";
import { getUSHolidaysForYear, getUSHolidayForDate } from "../../utils/us-holidays.util";

console.log("==================================================");
console.log("🚀 COMPREHENSIVE COMMAND SCHEDULE & AVAILABILITY E2E TEST SUITE");
console.log("==================================================");

let passed = 0;
let total = 0;

function assert(condition: boolean, testName: string) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] TEST ${total}: ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] TEST ${total}: ${testName}`);
    process.exit(1);
  }
}

async function runE2ETests() {
  // Scenario 1: Default Weekly Schedule
  console.log("\n📌 [Scenario 1] Default Weekly Schedule Verification");
  assert(INITIAL_DEFAULT_DAYS.length === 7, "7 days in default weekly schedule");
  const mon = INITIAL_DEFAULT_DAYS.find(d => d.dayOfWeek === 1);
  const wed = INITIAL_DEFAULT_DAYS.find(d => d.dayOfWeek === 3);
  const sun = INITIAL_DEFAULT_DAYS.find(d => d.dayOfWeek === 0);
  assert(mon?.isOpen === true, "Monday is Open in default schedule");
  assert(wed?.isOpen === false, "Wednesday is Closed in default schedule");
  assert(sun?.isOpen === false, "Sunday is Closed in default schedule");

  // Scenario 2: Multi-window Time Range Generation
  console.log("\n📌 [Scenario 2] Multi-window Time Windows Logic");
  const customWindows = [
    { start: "09:00", end: "12:00" },
    { start: "14:00", end: "17:00" },
  ];
  const duration = 60;
  const generatedSlots: string[] = [];
  customWindows.forEach(win => {
    const sMin = timeStringToMinutes(win.start);
    const eMin = timeStringToMinutes(win.end);
    for (let m = sMin; m + duration <= eMin; m += duration) {
      generatedSlots.push(`${minutesToTimeString(m)} – ${minutesToTimeString(m + duration)}`);
    }
  });

  assert(generatedSlots.includes("09:00 AM – 10:00 AM"), "Includes 09:00 AM – 10:00 AM");
  assert(generatedSlots.includes("10:00 AM – 11:00 AM"), "Includes 10:00 AM – 11:00 AM");
  assert(generatedSlots.includes("11:00 AM – 12:00 PM"), "Includes 11:00 AM – 12:00 PM");
  assert(!generatedSlots.includes("12:00 PM – 01:00 PM"), "Lunch gap 12:00 PM – 01:00 PM is NOT available");
  assert(!generatedSlots.includes("01:00 PM – 02:00 PM"), "Lunch gap 01:00 PM – 02:00 PM is NOT available");
  assert(generatedSlots.includes("02:00 PM – 03:00 PM"), "Afternoon slot 02:00 PM – 03:00 PM is available");
  assert(generatedSlots.includes("03:00 PM – 04:00 PM"), "Afternoon slot 03:00 PM – 04:00 PM is available");
  assert(generatedSlots.includes("04:00 PM – 05:00 PM"), "Afternoon slot 04:00 PM – 05:00 PM is available");

  // Scenario 3: US Federal Holidays Dynamic Multi-year Calculation
  console.log("\n📌 [Scenario 3] US Federal Holidays (2026, 2027, 2028, 2029, 2030)");
  const h2026 = getUSHolidaysForYear(2026);
  const h2027 = getUSHolidaysForYear(2027);
  const h2028 = getUSHolidaysForYear(2028);
  const h2029 = getUSHolidaysForYear(2029);
  const h2030 = getUSHolidaysForYear(2030);

  assert(h2026.find(h => h.name === "Memorial Day")?.date === "2026-05-25", "2026 Memorial Day: 2026-05-25");
  assert(h2027.find(h => h.name === "Memorial Day")?.date === "2027-05-31", "2027 Memorial Day: 2027-05-31");
  assert(h2028.find(h => h.name === "Memorial Day")?.date === "2028-05-29", "2028 Memorial Day: 2028-05-29");
  assert(h2029.find(h => h.name === "Memorial Day")?.date === "2029-05-28", "2029 Memorial Day: 2029-05-28");
  assert(h2030.find(h => h.name === "Memorial Day")?.date === "2030-05-27", "2030 Memorial Day: 2030-05-27");

  assert(h2026.find(h => h.name === "Labor Day")?.date === "2026-09-07", "2026 Labor Day: 2026-09-07");
  assert(h2027.find(h => h.name === "Labor Day")?.date === "2027-09-06", "2027 Labor Day: 2027-09-06");

  // Scenario 4: Holiday Recognition
  console.log("\n📌 [Scenario 4] Holiday Date Lookup");
  const thanksgiving26 = getUSHolidayForDate("2026-11-26");
  assert(thanksgiving26?.name === "Thanksgiving Day", "2026-11-26 is Thanksgiving Day");
  const randomDate = getUSHolidayForDate("2026-10-15");
  assert(randomDate === null, "2026-10-15 is a standard operational date (not a federal holiday)");

  console.log("==================================================");
  console.log(`🎉 ALL ${total} E2E TESTS PASSED SUCCESSFULLY!`);
  console.log("==================================================");
}

runE2ETests().catch(err => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
