/**
 * Authoritative Billing Date & Lifecycle Calculation Utility for AgeWellRI.
 *
 * FINAL BUSINESS RULES:
 * 1. First Billing Date: ALWAYS the 1st day of the calendar month following signup.
 * 2. Service Commencement Date: ALWAYS the 1st day of the calendar month following signup (First Billing Date === Service Commencement Date).
 * 3. Period End Date: ALWAYS the LAST DAY of the calendar month (e.g. Oct 1 -> Oct 31, Feb 1 -> Feb 28/29, Dec 1 -> Dec 31).
 * 4. Stripe trial_end: Anchored to the 1st of the next month at 12:00:00 UTC (08:00 AM EDT / 07:00 AM EST), guaranteed to be the 1st of the month across all US timezones.
 * 5. Recurring Billing: 1st day of each subsequent month (strictly Monthly interval).
 * 6. Billing Reminder: Sent exactly 15 days before the upcoming billing date.
 * 7. Cancellation Cutoff: Client can cancel auto-renewal only if at least 10 days remain before upcoming renewal / month-end.
 *
 * Authoritative Business Timezone: America/New_York (US Eastern Time)
 */

/**
 * Helper to get the year and month (1-indexed) in America/New_York timezone.
 */
export function getEasternDateParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(date);
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  let day = date.getDate();

  for (const p of parts) {
    if (p.type === "year") year = parseInt(p.value, 10);
    if (p.type === "month") month = parseInt(p.value, 10);
    if (p.type === "day") day = parseInt(p.value, 10);
  }

  return { year, month, day };
}

/**
 * Returns the 1st day of the following calendar month anchored at 12:00:00 UTC.
 *
 * Formula:
 * signupDate (in America/New_York) -> next calendar month -> day = 1
 *
 * Examples:
 * - Sep 1 signup  -> Oct 1
 * - Sep 9 signup  -> Oct 1
 * - Sep 30 signup -> Oct 1
 * - Oct 1 signup  -> Nov 1
 * - Oct 31 signup -> Nov 1
 * - Jan 31 signup -> Feb 1
 * - Dec 31 signup -> Jan 1 (next year)
 */
export function getFirstBillingDate(referenceDate: Date = new Date()): Date {
  const { year, month } = getEasternDateParts(referenceDate);

  let nextYear = year;
  let nextMonth = month + 1; // 1-12
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  // Anchor to 12:00:00 UTC (8:00 AM EDT / 7:00 AM EST in America/New_York)
  // This guarantees the date never regresses to the previous day under any negative UTC offset.
  const monthStr = String(nextMonth).padStart(2, "0");
  return new Date(`${nextYear}-${monthStr}-01T12:00:00.000Z`);
}

/**
 * Service commencement date is strictly the 1st of the calendar month following signup.
 * First Payment Date === First Service Start Date
 */
export function getServiceCommencementDate(
  signupDate: Date = new Date(),
): Date {
  return getFirstBillingDate(signupDate);
}

/**
 * Returns the Unix timestamp (in seconds) for Stripe's `trial_end`.
 * Set to 12:00:00 UTC (8:00 AM EDT / 7:00 AM EST) on the 1st of the next month.
 *
 * Why 12:00:00 UTC?
 * - In America/New_York (EDT): 8:00 AM on the 1st
 * - In America/New_York (EST): 7:00 AM on the 1st
 * - In America/Los_Angeles (PDT): 5:00 AM on the 1st
 * - In UTC: 12:00 PM (Noon) on the 1st
 *
 * This mathematically prevents Stripe or any payment processor from evaluating the timestamp
 * as the 30th / 31st of the prior month, regardless of UTC offset or server/client timezone!
 */
export function getStripeTrialEndTimestamp(
  referenceDate: Date = new Date(),
): number {
  const firstBilling = getFirstBillingDate(referenceDate);
  return Math.floor(firstBilling.getTime() / 1000);
}

/**
 * Backend-level charge protection.
 * Verifies whether `now` has reached or passed the first billing date in Eastern Time.
 */
export function isChargeAllowed(
  firstBillingDate: Date,
  now: Date = new Date(),
): boolean {
  const nowParts = getEasternDateParts(now);
  const billParts = getEasternDateParts(firstBillingDate);

  if (nowParts.year < billParts.year) return false;
  if (nowParts.year === billParts.year && nowParts.month < billParts.month)
    return false;
  if (
    nowParts.year === billParts.year &&
    nowParts.month === billParts.month &&
    nowParts.day < billParts.day
  )
    return false;

  return true;
}

/**
 * Calculates the end date for a billing period starting on `startDate` with a given interval.
 *
 * FINAL BUSINESS RULE:
 * - Every plan starts on the 1st of the month and ends on the LAST DAY of that month.
 * Examples:
 * - Start: October 1, 2026   -> End: October 31, 2026
 * - Start: November 1, 2026  -> End: November 30, 2026
 * - Start: February 1, 2026  -> End: February 28, 2026
 * - Start: February 1, 2028  -> End: February 29, 2028 (Leap Year)
 * - Start: December 1, 2026  -> End: December 31, 2026
 */
export function calculatePeriodEndDate(
  startDate: Date,
  interval: "MONTHLY" | "ONE_TIME" | string = "MONTHLY",
): Date {
  const { year, month } = getEasternDateParts(startDate);

  // Month is 1-indexed (1 to 12)
  // Day 0 of the following month (month in 1-based index) gives the last day of the current month
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const monthStr = String(month).padStart(2, "0");
  const dayStr = String(lastDay).padStart(2, "0");
  return new Date(`${year}-${monthStr}-${dayStr}T12:00:00.000Z`);
}

/**
 * Calculates the 15-day reminder date for a target billing/renewal date.
 * Example: For 2026-10-01 billing date -> reminder date is 2026-09-16.
 * Example: For 2026-11-01 billing date -> reminder date is 2026-10-17.
 */
export function getReminderDate(
  billingDate: Date,
  daysBefore: number = 15,
): Date {
  const d = new Date(billingDate);
  d.setDate(d.getDate() - daysBefore);
  return d;
}

/**
 * Calculates the cancellation cutoff date (10 days before the upcoming renewal / month-end).
 * Example: For 2026-11-01 renewal date -> cutoff is 2026-10-22 (10 days before Nov 1).
 */
export function getCancellationCutoffDate(
  renewalDate: Date,
  cutoffDaysBefore: number = 10,
): Date {
  const d = new Date(renewalDate);
  d.setDate(d.getDate() - cutoffDaysBefore);
  return d;
}

/**
 * Checks whether a cancellation request made at `now` is on or before the 10-day cutoff date.
 */
export function isWithinCancellationCutoff(
  now: Date = new Date(),
  upcomingRenewalDate: Date,
  cutoffDaysBefore: number = 10,
): boolean {
  const nowParts = getEasternDateParts(now);
  const cutoff = getCancellationCutoffDate(
    upcomingRenewalDate,
    cutoffDaysBefore,
  );
  const cutoffParts = getEasternDateParts(cutoff);

  if (nowParts.year < cutoffParts.year) return true;
  if (nowParts.year > cutoffParts.year) return false;
  if (nowParts.month < cutoffParts.month) return true;
  if (nowParts.month > cutoffParts.month) return false;
  return nowParts.day <= cutoffParts.day;
}

/**
 * Formats a Date consistently for UI / billing display (e.g., "October 1, 2026").
 */
export function formatBillingDate(
  date: Date | string | null | undefined,
): string {
  if (!date) return "Not Scheduled";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}
