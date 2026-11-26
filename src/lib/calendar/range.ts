import { MAX_RANGE_DAYS } from "./types";

/**
 * Date ranges for the calendar, always as Central calendar days (YYYY-MM-DD). Pure functions.
 */
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s) && toIso(toMs(s)) === s;
}

export function addDays(iso: string, days: number): string {
  return toIso(toMs(iso) + days * DAY_MS);
}

/** A valid range: both real dates, `to` not before `from`, at most MAX_RANGE_DAYS apart. */
export function validRange(from: unknown, to: unknown): from is string {
  if (!isIsoDate(from) || !isIsoDate(to)) return false;
  const days = (toMs(to) - toMs(from)) / DAY_MS;
  return days >= 0 && days <= MAX_RANGE_DAYS;
}

/** The Monday of the week holding `iso`. */
export function mondayOf(iso: string): string {
  const day = new Date(toMs(iso)).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

/** The calendar's default window: this week's Monday plus `weeks` full weeks (Monday..Sunday). */
export function defaultRange(todayIso: string, weeks = 4): { from: string; to: string } {
  const from = mondayOf(todayIso);
  return { from, to: addDays(from, weeks * 7 - 1) };
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (s: unknown): s is string => typeof s === "string" && MONTH.test(s);

/** "2026-11" for a day in November 2026. */
export const monthOf = (iso: string) => iso.slice(0, 7);

/** The month `n` months after `month` ("2026-12", 1 -> "2027-01"). */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** The month grid: six whole weeks, Sunday first, starting on the Sunday on or before the 1st (42 days, under the 62-day limit). */
export function monthGrid(month: string): { from: string; to: string; days: string[] } {
  const first = `${month}-01`;
  const from = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return { from, to: days[41], days };
}

/** Today in Central time (the calendar is always Central: the owner, 18 Nov 2026), YYYY-MM-DD. */
export function centralToday(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
