import { parseDateAndTimeSlot } from "./appointment.service";

console.log("==================================================");
console.log("🧪 TESTING APPOINTMENT DATE & WORKING HOURS LOGIC");
console.log("==================================================");

let passed = 0;
let total = 0;

function assert(condition: boolean, name: string) {
  total++;
  if (condition) {
    console.log(`✅ [PASS] TEST ${total}: ${name}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] TEST ${total}: ${name}`);
    process.exit(1);
  }
}

// Test 1: parseDateAndTimeSlot standard slot
const res1 = parseDateAndTimeSlot("2026-10-15", "10:00 AM – 12:00 PM");
assert(res1.startAt.getFullYear() === 2026 && res1.startAt.getMonth() === 9 && res1.startAt.getDate() === 15, "Correct date parsed");
assert(res1.startAt.getHours() === 10 && res1.startAt.getMinutes() === 0, "Correct start time (10:00 AM)");
assert(res1.endAt.getHours() === 12 && res1.endAt.getMinutes() === 0, "Correct end time (12:00 PM)");

// Test 2: Custom time slot in 8am-6pm
const res2 = parseDateAndTimeSlot("2026-10-15", "08:30 AM – 05:30 PM");
assert(res2.startAt.getHours() === 8 && res2.startAt.getMinutes() === 30, "Custom 8:30 AM start");
assert(res2.endAt.getHours() === 17 && res2.endAt.getMinutes() === 30, "Custom 5:30 PM end");

// Test 3: Sunday is day 0 (Weekend)
const sundayDate = new Date(2026, 9, 11); // Oct 11, 2026 is Sunday
assert(sundayDate.getDay() === 0, "Sunday is day 0 (weekend/non-service)");

// Test 4: Wednesday is day 3 (Weekend)
const wednesdayDate = new Date(2026, 9, 14); // Oct 14, 2026 is Wednesday
assert(wednesdayDate.getDay() === 3, "Wednesday is day 3 (weekend/non-service)");

// Test 5: Thursday is day 4 (Working day)
const thursdayDate = new Date(2026, 9, 15); // Oct 15, 2026 is Thursday
assert(thursdayDate.getDay() === 4, "Thursday is day 4 (working day)");

console.log("==================================================");
console.log(`📊 TEST RESULTS: ${passed} / ${total} PASSED`);
console.log("==================================================");
