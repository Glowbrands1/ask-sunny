/**
 * THE CALENDAR'S HOLIDAYS (the owner, 27 Nov 2026: "can you also add holidays in the calendar in all apps pls US holiday").
 * One list, the same in the Leadership Hub, Ask Sunny and Ask Bubbles (each keeps its own copy of this file: change all
 * three together). Every date is worked out in code for any year (src/lib/calendar/holidays.ts); nothing is fetched.
 *
 *   federal     the 11 US federal holidays. A fixed-date one that falls on a Saturday is also marked on the Friday
 *               before, and on a Sunday the Monday after, as "(observed)".
 *   observance  common days that matter for staffing, marked as observances, never as federal holidays.
 *
 * A rule is one of: fixed (month, day); nth weekday of a month (n = -1 for the last); Easter Sunday; or a number of days
 * after another holiday on this list (by name).
 */
export type HolidayKind = "federal" | "observance";
export type HolidayRule =
  | { readonly name: string; readonly kind: HolidayKind; readonly fixed: { readonly month: number; readonly day: number } }
  | { readonly name: string; readonly kind: HolidayKind; readonly nth: { readonly month: number; readonly weekday: number; readonly n: number } }
  | { readonly name: string; readonly kind: HolidayKind; readonly easter: true }
  | { readonly name: string; readonly kind: HolidayKind; readonly after: { readonly name: string; readonly days: number } };

// Months 1-12; weekdays 0 (Sunday) to 6.
export const HOLIDAY_RULES: readonly HolidayRule[] = [
  { name: "New Year's Day", kind: "federal", fixed: { month: 1, day: 1 } },
  { name: "Martin Luther King Jr. Day", kind: "federal", nth: { month: 1, weekday: 1, n: 3 } },
  { name: "Presidents' Day", kind: "federal", nth: { month: 2, weekday: 1, n: 3 } },
  { name: "Memorial Day", kind: "federal", nth: { month: 5, weekday: 1, n: -1 } },
  { name: "Juneteenth", kind: "federal", fixed: { month: 6, day: 19 } },
  { name: "Independence Day", kind: "federal", fixed: { month: 7, day: 4 } },
  { name: "Labor Day", kind: "federal", nth: { month: 9, weekday: 1, n: 1 } },
  { name: "Columbus Day", kind: "federal", nth: { month: 10, weekday: 1, n: 2 } },
  { name: "Veterans Day", kind: "federal", fixed: { month: 11, day: 11 } },
  { name: "Thanksgiving", kind: "federal", nth: { month: 11, weekday: 4, n: 4 } },
  { name: "Christmas Day", kind: "federal", fixed: { month: 12, day: 25 } },
  { name: "Easter Sunday", kind: "observance", easter: true },
  { name: "Mother's Day", kind: "observance", nth: { month: 5, weekday: 0, n: 2 } },
  { name: "Black Friday", kind: "observance", after: { name: "Thanksgiving", days: 1 } },
  { name: "Christmas Eve", kind: "observance", fixed: { month: 12, day: 24 } },
  { name: "New Year's Eve", kind: "observance", fixed: { month: 12, day: 31 } },
];
