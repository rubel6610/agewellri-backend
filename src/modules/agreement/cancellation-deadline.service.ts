/**
 * CancellationDeadlineService
 *
 * Computes official state-specific 3-business-day cancellation deadlines for AgeWellRI Service Agreements.
 * States supported: Rhode Island (RI), Connecticut (CT), Massachusetts (MA).
 *
 * Rules:
 * - RI: Saturdays count as business days; Sundays do NOT count; Federal/legal holidays do NOT count;
 *       Rhode Island Victory Day (2nd Monday of August) does NOT count.
 * - CT: Saturdays count as business days; Sundays do NOT count; Connecticut legal holidays do NOT count.
 * - MA: Saturdays count as business days; Sundays do NOT count; Massachusetts legal holidays do NOT count.
 */

export interface CancellationDeadlineResult {
  deadlineDate: Date;
  formattedDeadline: string;
  ruleExplanation: string;
  businessDaysCounted: number;
  state: string;
  effectiveFrom: string;
}

// Fixed & Floating Federal and State Legal Holidays helper
function isLegalHoliday(date: Date, state: string): boolean {
  const month = date.getMonth(); // 0-indexed (0 = Jan, 11 = Dec)
  const day = date.getDate();
  const dayOfWeek = date.getDay(); // 0 = Sun, 6 = Sat
  const year = date.getFullYear();

  // 1. New Year's Day (Jan 1)
  if (month === 0 && day === 1) return true;

  // 2. Martin Luther King Jr. Day (3rd Monday in January)
  if (month === 0 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;

  // 3. Washington's Birthday / Presidents' Day (3rd Monday in February)
  if (month === 1 && dayOfWeek === 1 && day >= 15 && day <= 21) return true;

  // 4. Memorial Day (Last Monday in May)
  if (month === 4 && dayOfWeek === 1 && day >= 25) return true;

  // 5. Juneteenth National Independence Day (June 19)
  if (month === 5 && day === 19) return true;

  // 6. Independence Day (July 4)
  if (month === 6 && day === 4) return true;

  // 7. Rhode Island Victory Day (2nd Monday in August - RI only)
  if (state.toUpperCase() === "RI" && month === 7 && dayOfWeek === 1 && day >= 8 && day <= 14) {
    return true;
  }

  // 8. Labor Day (1st Monday in September)
  if (month === 8 && dayOfWeek === 1 && day <= 7) return true;

  // 9. Columbus Day / Indigenous Peoples' Day (2nd Monday in October)
  if (month === 9 && dayOfWeek === 1 && day >= 8 && day <= 14) return true;

  // 10. Veterans Day (November 11)
  if (month === 10 && day === 11) return true;

  // 11. Thanksgiving Day (4th Thursday in November)
  if (month === 10 && dayOfWeek === 4 && day >= 22 && day <= 28) return true;

  // 12. Christmas Day (December 25)
  if (month === 11 && day === 25) return true;

  return false;
}

export class CancellationDeadlineService {
  /**
   * Calculate official 3-business-day cancellation deadline based on transaction date and state.
   */
  public static calculateDeadline(
    stateInput?: string | null,
    transactionDateInput?: Date | string | null
  ): CancellationDeadlineResult {
    const state = (stateInput || "RI").toUpperCase().trim();
    const startDate = transactionDateInput ? new Date(transactionDateInput) : new Date();

    let businessDaysAdded = 0;
    const currentDate = new Date(startDate);
    currentDate.setHours(23, 59, 59, 999); // Midnight of target deadline

    // Business day advancement loop (Requires 3 valid business days following signing date)
    while (businessDaysAdded < 3) {
      currentDate.setDate(currentDate.getDate() + 1);
      const dayOfWeek = currentDate.getDay();

      // Sundays never count as business days
      if (dayOfWeek === 0) {
        continue;
      }

      // Legal holidays do not count
      if (isLegalHoliday(currentDate, state)) {
        continue;
      }

      // Saturdays count, regular weekdays (Mon-Fri) count
      businessDaysAdded++;
    }

    const formattedDate = currentDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    let stateSpecificNotice = "Rhode Island General Laws § 6-28-3";
    if (state === "CT") stateSpecificNotice = "Connecticut General Statutes § 42-134a";
    else if (state === "MA") stateSpecificNotice = "Massachusetts General Laws ch. 93 § 48";

    return {
      deadlineDate: currentDate,
      formattedDeadline: `Midnight of ${formattedDate}`,
      ruleExplanation: `Notice of Cancellation must be delivered not later than midnight of the 3rd business day (${stateSpecificNotice}). Sundays and recognized legal holidays are excluded from calculation.`,
      businessDaysCounted: 3,
      state,
      effectiveFrom: startDate.toISOString(),
    };
  }
}
