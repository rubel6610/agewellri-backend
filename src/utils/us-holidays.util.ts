/**
 * US Federal Holidays dynamic calculation utility for past, present, and future years (2026, 2027, 2028, 2029, 2030, etc.)
 * Strictly complies with US Office of Personnel Management (OPM) federal holiday rules, including weekend observed dates.
 */

export interface USHoliday {
  name: string;
  date: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  description?: string;
  isFederalHoliday: boolean;
  isObserved?: boolean;
}

/**
 * Returns the date of the N-th occurrence of a weekday in a given month.
 * @param year e.g. 2026
 * @param monthIndex 0 for January, 11 for December
 * @param dayOfWeek 0 for Sunday, 1 for Monday, ..., 6 for Saturday
 * @param nth 1 for 1st, 2 for 2nd, etc.
 */
function getNthDayOfWeek(
  year: number,
  monthIndex: number,
  dayOfWeek: number,
  nth: number
): number {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  let dayOffset = dayOfWeek - firstDay.getUTCDay();
  if (dayOffset < 0) dayOffset += 7;
  return 1 + dayOffset + (nth - 1) * 7;
}

/**
 * Returns the date of the LAST occurrence of a weekday in a given month.
 */
function getLastDayOfWeek(
  year: number,
  monthIndex: number,
  dayOfWeek: number
): number {
  const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 0));
  const lastDay = nextMonth.getUTCDate();
  const lastDayOfWeek = nextMonth.getUTCDay();
  let diff = lastDayOfWeek - dayOfWeek;
  if (diff < 0) diff += 7;
  return lastDay - diff;
}

function formatDateStr(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

/**
 * Helper to add a fixed-date holiday and its federal observed date if it falls on a weekend.
 */
function addFixedHoliday(
  list: USHoliday[],
  name: string,
  year: number,
  month: number,
  day: number,
  description: string
) {
  const actualDateStr = formatDateStr(year, month, day);
  const actualHoliday: USHoliday = {
    name,
    date: actualDateStr,
    year,
    month,
    day,
    description,
    isFederalHoliday: true,
  };
  list.push(actualHoliday);

  // Federal observed rule:
  // - If holiday falls on Saturday, federal observance is on preceding Friday.
  // - If holiday falls on Sunday, federal observance is on following Monday.
  const dObj = new Date(Date.UTC(year, month - 1, day));
  const dow = dObj.getUTCDay();

  if (dow === 6) {
    // Saturday -> Friday before
    const obsDay = new Date(Date.UTC(year, month - 1, day - 1));
    const obsDateStr = formatDateStr(
      obsDay.getUTCFullYear(),
      obsDay.getUTCMonth() + 1,
      obsDay.getUTCDate()
    );
    list.push({
      name: `${name} (Observed)`,
      date: obsDateStr,
      year: obsDay.getUTCFullYear(),
      month: obsDay.getUTCMonth() + 1,
      day: obsDay.getUTCDate(),
      description: `Federal observance of ${name}`,
      isFederalHoliday: true,
      isObserved: true,
    });
  } else if (dow === 0) {
    // Sunday -> Monday after
    const obsDay = new Date(Date.UTC(year, month - 1, day + 1));
    const obsDateStr = formatDateStr(
      obsDay.getUTCFullYear(),
      obsDay.getUTCMonth() + 1,
      obsDay.getUTCDate()
    );
    list.push({
      name: `${name} (Observed)`,
      date: obsDateStr,
      year: obsDay.getUTCFullYear(),
      month: obsDay.getUTCMonth() + 1,
      day: obsDay.getUTCDate(),
      description: `Federal observance of ${name}`,
      isFederalHoliday: true,
      isObserved: true,
    });
  }
}

const holidayCache = new Map<number, USHoliday[]>();

/**
 * Computes all official US Federal Holidays + Federal Observances for a given year.
 */
export function getUSHolidaysForYear(year: number): USHoliday[] {
  if (holidayCache.has(year)) {
    return holidayCache.get(year)!;
  }

  const holidays: USHoliday[] = [];

  // 1. New Year's Day — Jan 1
  addFixedHoliday(holidays, "New Year's Day", year, 1, 1, "First day of the new year");

  // 2. Martin Luther King Jr. Day — 3rd Monday in January
  const mlkDay = getNthDayOfWeek(year, 0, 1, 3);
  holidays.push({
    name: "Martin Luther King Jr. Day",
    date: formatDateStr(year, 1, mlkDay),
    year,
    month: 1,
    day: mlkDay,
    description: "Honoring civil rights leader Dr. Martin Luther King Jr.",
    isFederalHoliday: true,
  });

  // 3. Washington's Birthday / Presidents' Day — 3rd Monday in February
  const presDay = getNthDayOfWeek(year, 1, 1, 3);
  holidays.push({
    name: "Presidents' Day",
    date: formatDateStr(year, 2, presDay),
    year,
    month: 2,
    day: presDay,
    description: "Honoring George Washington and all US Presidents",
    isFederalHoliday: true,
  });

  // 4. Memorial Day — Last Monday in May
  const memDay = getLastDayOfWeek(year, 4, 1);
  holidays.push({
    name: "Memorial Day",
    date: formatDateStr(year, 5, memDay),
    year,
    month: 5,
    day: memDay,
    description: "Honoring military personnel who died in service",
    isFederalHoliday: true,
  });

  // 5. Juneteenth National Independence Day — June 19
  addFixedHoliday(
    holidays,
    "Juneteenth",
    year,
    6,
    19,
    "Commemorating the emancipation of enslaved African Americans"
  );

  // 6. Independence Day — July 4
  addFixedHoliday(
    holidays,
    "Independence Day",
    year,
    7,
    4,
    "US Declaration of Independence anniversary"
  );

  // 7. Labor Day — 1st Monday in September
  const laborDay = getNthDayOfWeek(year, 8, 1, 1);
  holidays.push({
    name: "Labor Day",
    date: formatDateStr(year, 9, laborDay),
    year,
    month: 9,
    day: laborDay,
    description: "Honoring the American labor movement and workers",
    isFederalHoliday: true,
  });

  // 8. Indigenous Peoples' Day / Columbus Day — 2nd Monday in October
  const columbusDay = getNthDayOfWeek(year, 9, 1, 2);
  holidays.push({
    name: "Indigenous Peoples' Day / Columbus Day",
    date: formatDateStr(year, 10, columbusDay),
    year,
    month: 10,
    day: columbusDay,
    description: "Federal holiday in October",
    isFederalHoliday: true,
  });

  // 9. Veterans Day — November 11
  addFixedHoliday(
    holidays,
    "Veterans Day",
    year,
    11,
    11,
    "Honoring all military veterans who served in the US Armed Forces"
  );

  // 10. Thanksgiving Day — 4th Thursday in November
  const tgivingDay = getNthDayOfWeek(year, 10, 4, 4);
  holidays.push({
    name: "Thanksgiving Day",
    date: formatDateStr(year, 11, tgivingDay),
    year,
    month: 11,
    day: tgivingDay,
    description: "Day of giving thanks and traditional harvest celebration",
    isFederalHoliday: true,
  });

  // 11. Christmas Day — December 25
  addFixedHoliday(holidays, "Christmas Day", year, 12, 25, "Celebration of Christmas");

  const sorted = holidays.sort((a, b) => a.date.localeCompare(b.date));
  holidayCache.set(year, sorted);
  return sorted;
}

/**
 * Checks if a specific date string (YYYY-MM-DD) is a US Federal Holiday or Federal Observance.
 */
export function getUSHolidayForDate(dateStr: string): USHoliday | null {
  if (!dateStr) return null;
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length < 3) return null;
  const year = parseInt(parts[0], 10);
  if (isNaN(year)) return null;

  const targetFormatted = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;

  // Check current year holidays
  const holidays = getUSHolidaysForYear(year);
  const found = holidays.find((h) => h.date === targetFormatted);
  if (found) return found;

  // If near beginning of year (e.g. Jan 1 observed on Dec 31 of prev year), check prev year
  if (parts[1] === "12" && parts[2] === "31") {
    const nextYearHolidays = getUSHolidaysForYear(year + 1);
    const nextYearObserved = nextYearHolidays.find((h) => h.date === targetFormatted);
    if (nextYearObserved) return nextYearObserved;
  }

  // If near end of year (e.g. Dec 25 observed on Dec 26 of current year or Jan 2), check adjacent years
  if (parts[1] === "01" && (parts[2] === "01" || parts[2] === "02" || parts[2] === "03")) {
    const prevYearHolidays = getUSHolidaysForYear(year - 1);
    const prevYearObserved = prevYearHolidays.find((h) => h.date === targetFormatted);
    if (prevYearObserved) return prevYearObserved;
  }

  return null;
}
