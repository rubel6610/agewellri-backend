import {
  getFirstBillingDate,
  getServiceCommencementDate,
  getStripeTrialEndTimestamp,
  isChargeAllowed,
  calculatePeriodEndDate,
  getReminderDate,
  getCancellationCutoffDate,
  isWithinCancellationCutoff,
  formatBillingDate,
  getEasternDateParts,
} from "./billing-dates.util";

function runTests() {
  console.log("==================================================");
  console.log("🧪 RUNNING COMPREHENSIVE BILLING LIFECYCLE TESTS");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  function assert(
    condition: boolean,
    testName: string,
    actual?: any,
    expected?: any,
  ) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (actual !== undefined) console.error(`   Actual:   ${actual}`);
      if (expected !== undefined) console.error(`   Expected: ${expected}`);
    }
  }

  // TEST 1: Signup September 9, 2026 -> First billing October 1, 2026
  const signup1 = new Date("2026-09-09T14:00:00.000Z");
  const firstBilling1 = getFirstBillingDate(signup1);
  const parts1 = getEasternDateParts(firstBilling1);
  assert(
    parts1.year === 2026 && parts1.month === 10 && parts1.day === 1,
    "TEST 1: Signup Sep 9, 2026 -> First billing Oct 1, 2026",
    formatBillingDate(firstBilling1),
    "October 1, 2026",
  );

  // TEST 2: Signup September 30, 2026 -> First billing October 1, 2026
  const signup2 = new Date("2026-09-30T18:00:00.000Z");
  const firstBilling2 = getFirstBillingDate(signup2);
  const parts2 = getEasternDateParts(firstBilling2);
  assert(
    parts2.year === 2026 && parts2.month === 10 && parts2.day === 1,
    "TEST 2: Signup Sep 30, 2026 -> First billing Oct 1, 2026",
    formatBillingDate(firstBilling2),
    "October 1, 2026",
  );

  // TEST 3: Signup October 1, 2026 -> First billing November 1, 2026
  const signup3 = new Date("2026-10-01T12:00:00.000Z");
  const firstBilling3 = getFirstBillingDate(signup3);
  const parts3 = getEasternDateParts(firstBilling3);
  assert(
    parts3.year === 2026 && parts3.month === 11 && parts3.day === 1,
    "TEST 3: Signup Oct 1, 2026 -> First billing Nov 1, 2026",
    formatBillingDate(firstBilling3),
    "November 1, 2026",
  );

  // TEST 4: January 31 signup -> February 1 (Leap Year Handling)
  const signupJan31 = new Date("2028-01-31T20:00:00.000Z"); // 2028 is leap year
  const firstBillingFeb = getFirstBillingDate(signupJan31);
  const partsFeb = getEasternDateParts(firstBillingFeb);
  assert(
    partsFeb.year === 2028 && partsFeb.month === 2 && partsFeb.day === 1,
    "TEST 4: Signup Jan 31 (Leap year) -> First billing Feb 1, 2028",
    formatBillingDate(firstBillingFeb),
    "February 1, 2028",
  );

  // TEST 5: December 31 signup -> January 1 of the following year
  const signupDec31 = new Date("2026-12-31T22:00:00.000Z");
  const firstBillingJan = getFirstBillingDate(signupDec31);
  const partsJan = getEasternDateParts(firstBillingJan);
  assert(
    partsJan.year === 2027 && partsJan.month === 1 && partsJan.day === 1,
    "TEST 5: Signup Dec 31, 2026 -> First billing Jan 1, 2027 (Year rollover)",
    formatBillingDate(firstBillingJan),
    "January 1, 2027",
  );

  // TEST 6: Service commencement matches first billing date exactly
  const commDate1 = getServiceCommencementDate(signup1);
  assert(
    commDate1.getTime() === firstBilling1.getTime(),
    "TEST 6: Service commencement equals first billing date (Oct 1, 2026)",
    formatBillingDate(commDate1),
    formatBillingDate(firstBilling1),
  );

  // TEST 7: Backend charge protection - Block charge on Sep 30 for Oct 1 billing
  const attemptSep30 = new Date("2026-09-30T23:59:59.000Z");
  const isChargeAllowedSep30 = isChargeAllowed(firstBilling1, attemptSep30);
  assert(
    isChargeAllowedSep30 === false,
    "TEST 7: Attempt charge on Sep 30 for Oct 1 billing -> BLOCKED",
    isChargeAllowedSep30,
    false,
  );

  // TEST 8: Backend charge protection - Allow charge on Oct 1 for Oct 1 billing
  const attemptOct1 = new Date("2026-10-01T08:00:00.000Z");
  const isChargeAllowedOct1 = isChargeAllowed(firstBilling1, attemptOct1);
  assert(
    isChargeAllowedOct1 === true,
    "TEST 8: Attempt charge on Oct 1 for Oct 1 billing -> ALLOWED",
    isChargeAllowedOct1,
    true,
  );

  // TEST 9: Stripe trial_end timestamp guarantees Oct 1 across all US timezones
  const trialEndTs = getStripeTrialEndTimestamp(signup1);
  const trialEndDate = new Date(trialEndTs * 1000);
  const trialParts = getEasternDateParts(trialEndDate);
  assert(
    trialParts.year === 2026 && trialParts.month === 10 && trialParts.day === 1,
    "TEST 9: Stripe trial_end timestamp resolves strictly to Oct 1 in America/New_York",
    trialEndDate.toISOString(),
    "2026-10-01T12:00:00.000Z",
  );

  // TEST 10: 15-day reminder for Oct 1 billing -> Sep 16
  const reminderOct1 = getReminderDate(firstBilling1, 15);
  const reminderParts = getEasternDateParts(reminderOct1);
  assert(
    reminderParts.year === 2026 &&
      reminderParts.month === 9 &&
      reminderParts.day === 16,
    "TEST 10: 15-day reminder for Oct 1 -> Sep 16",
    formatBillingDate(reminderOct1),
    "September 16, 2026",
  );

  // TEST 11: 15-day reminder for Nov 1 billing -> Oct 17
  const reminderNov1 = getReminderDate(firstBilling3, 15);
  const reminderPartsNov = getEasternDateParts(reminderNov1);
  assert(
    reminderPartsNov.year === 2026 &&
      reminderPartsNov.month === 10 &&
      reminderPartsNov.day === 17,
    "TEST 11: 15-day reminder for Nov 1 -> Oct 17",
    formatBillingDate(reminderNov1),
    "October 17, 2026",
  );

  // TEST 12: Cancellation cutoff for Nov 1 renewal -> Oct 22 (10 days before)
  const cutoffNov1 = getCancellationCutoffDate(firstBilling3, 10);
  const cutoffParts = getEasternDateParts(cutoffNov1);
  assert(
    cutoffParts.year === 2026 &&
      cutoffParts.month === 10 &&
      cutoffParts.day === 22,
    "TEST 12: Cancellation cutoff for Nov 1 renewal -> Oct 22",
    formatBillingDate(cutoffNov1),
    "October 22, 2026",
  );

  // TEST 13: Client cancels on Oct 15 for Nov 1 renewal (before cutoff) -> ALLOWED
  const isEligibleEarly = isWithinCancellationCutoff(
    new Date("2026-10-15T12:00:00.000Z"),
    firstBilling3,
    10,
  );
  assert(
    isEligibleEarly === true,
    "TEST 13: Client cancels on Oct 15 for Nov 1 renewal -> Allowed",
    isEligibleEarly,
    true,
  );

  // TEST 14: Client cancels on Oct 25 for Nov 1 renewal (after cutoff) -> REJECTED
  const isEligibleLate = isWithinCancellationCutoff(
    new Date("2026-10-25T12:00:00.000Z"),
    firstBilling3,
    10,
  );
  assert(
    isEligibleLate === false,
    "TEST 14: Client cancels on Oct 25 for Nov 1 renewal -> Rejected",
    isEligibleLate,
    false,
  );

  // TEST 15: Period end calculation for Monthly interval: Oct 1, 2026 -> Oct 31, 2026 (Last day of month)
  const periodEndM = calculatePeriodEndDate(firstBilling1, "MONTHLY");
  const periodPartsM = getEasternDateParts(periodEndM);
  assert(
    periodPartsM.year === 2026 &&
      periodPartsM.month === 10 &&
      periodPartsM.day === 31,
    "TEST 15: Monthly period end for Oct 1, 2026 -> Oct 31, 2026 (Last day of month)",
    formatBillingDate(periodEndM),
    "October 31, 2026",
  );

  // TEST 16: Period end calculation for December: Dec 1, 2026 -> Dec 31, 2026 (Last day of month)
  const decDate = new Date("2026-12-01T12:00:00.000Z");
  const periodEndDec = calculatePeriodEndDate(decDate, "MONTHLY");
  const periodPartsDec = getEasternDateParts(periodEndDec);
  assert(
    periodPartsDec.year === 2026 &&
      periodPartsDec.month === 12 &&
      periodPartsDec.day === 31,
    "TEST 16: Monthly period end for Dec 1, 2026 -> Dec 31, 2026 (Last day of month)",
    formatBillingDate(periodEndDec),
    "December 31, 2026",
  );

  // TEST 17: Period end calculation for February: Feb 1, 2026 -> Feb 28, 2026 (Last day of month)
  const febDate = new Date("2026-02-01T12:00:00.000Z");
  const periodEndFeb = calculatePeriodEndDate(febDate, "MONTHLY");
  const periodPartsFeb = getEasternDateParts(periodEndFeb);
  assert(
    periodPartsFeb.year === 2026 &&
      periodPartsFeb.month === 2 &&
      periodPartsFeb.day === 28,
    "TEST 17: Monthly period end for Feb 1, 2026 -> Feb 28, 2026 (Last day of month)",
    formatBillingDate(periodEndFeb),
    "February 28, 2026",
  );

  // TEST 18: Period end calculation for Leap Year February: Feb 1, 2028 -> Feb 29, 2028 (Last day of month)
  const febLeapDate = new Date("2028-02-01T12:00:00.000Z");
  const periodEndFebLeap = calculatePeriodEndDate(febLeapDate, "MONTHLY");
  const periodPartsFebLeap = getEasternDateParts(periodEndFebLeap);
  assert(
    periodPartsFebLeap.year === 2028 &&
      periodPartsFebLeap.month === 2 &&
      periodPartsFebLeap.day === 29,
    "TEST 18: Monthly period end for Feb 1, 2028 (Leap Year) -> Feb 29, 2028 (Last day of month)",
    formatBillingDate(periodEndFebLeap),
    "February 29, 2028",
  );

  // TEST 19: Period end calculation for 30-day month (April): Apr 1, 2026 -> Apr 30, 2026 (Last day of month)
  const aprDate = new Date("2026-04-01T12:00:00.000Z");
  const periodEndApr = calculatePeriodEndDate(aprDate, "MONTHLY");
  const periodPartsApr = getEasternDateParts(periodEndApr);
  assert(
    periodPartsApr.year === 2026 &&
      periodPartsApr.month === 4 &&
      periodPartsApr.day === 30,
    "TEST 19: Monthly period end for Apr 1, 2026 -> Apr 30, 2026 (Last day of month)",
    formatBillingDate(periodEndApr),
    "April 30, 2026",
  );

  console.log("==================================================");
  console.log(`📊 TEST RESULTS: ${passed} / ${total} PASSED`);
  console.log("==================================================");
}

runTests();
