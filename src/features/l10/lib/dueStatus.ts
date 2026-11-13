// Copied from the Leadership Hub (src/lib/meetings/dueStatus.ts); keep in step with it. See src/features/l10/README.md.
/**
 * Due-date status for to-dos, rocks and milestones: done, overdue, due soon, or nothing to flag.
 * All dates are plain YYYY-MM-DD business dates (compared as calendar days, never as clock times).
 */

/** A to-do is "due soon" from today up to this many days ahead. */
export const TODO_SOON_DAYS = 3;
/** A rock (or one of its milestones) is "due soon" within this many days. */
export const ROCK_SOON_DAYS = 14;
/** The company's time zone: "today" means today here, not in the browser's or the server's UTC. */
export const BUSINESS_TIME_ZONE = "America/Chicago";

export type DueState = "done" | "overdue" | "soon" | "none";

const DAY = 24 * 60 * 60 * 1000;
const parse = (s: string | undefined): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // Reject impossible dates such as 2026-02-31 (which Date.UTC would roll over).
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : null;
};

/** Whole days from `today` to `due` (negative = in the past); null when either is not a real date. */
export function daysUntil(due: string | undefined, today: string): number | null {
  const a = parse(due);
  const b = parse(today);
  return a === null || b === null ? null : Math.round((a - b) / DAY);
}

/** Done always wins; then overdue (before today); then due soon (today up to `soonDays` ahead); otherwise none. */
export function dueState(item: { done: boolean; dueDate?: string }, today: string, soonDays: number): DueState {
  if (item.done) return "done";
  const d = daysUntil(item.dueDate, today);
  if (d === null) return "none";
  if (d < 0) return "overdue";
  return d <= soonDays ? "soon" : "none";
}

export const todoState = (t: { done: boolean; dueDate?: string }, today: string) => dueState(t, today, TODO_SOON_DAYS);
export const rockState = (r: { status: string; dueDate?: string }, today: string) => dueState({ done: r.status === "done", dueDate: r.dueDate }, today, ROCK_SOON_DAYS);
export const milestoneState = (m: { done: boolean; dueDate?: string }, today: string) => dueState(m, today, ROCK_SOON_DAYS);

/** Today's date (YYYY-MM-DD) in the company's time zone. */
export function businessDate(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
