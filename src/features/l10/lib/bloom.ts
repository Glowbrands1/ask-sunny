// Copied from the Leadership Hub (src/lib/meetings/bloom.ts); keep in step with it. See src/features/l10/README.md.
import type { Issue } from "./types";
// Small helpers for the meeting pages laid out like Bloom Growth's (the DM L10s; see config.ts bloomStyle).

/** "MM-DD-YYYY", as Bloom shows dates. A plain date ("2026-11-03") is taken as it is; a time is read in Central. */
export function mmddyyyy(value: string | null | undefined): string {
  if (!value) return "";
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plain) return `${plain[2]}-${plain[3]}-${plain[1]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) return `${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}-${slash[3]}`;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t));
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("month")}-${get("day")}-${get("year")}`;
}

/** Up to two initials from a full name ("Avery Quill" → "AQ"). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** "1h 5m" / "42m" / "—". */
export function durationLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A week ending "MM/DD/YYYY" as Bloom heads its column: "2 Nov / 8 Nov" (the six days before it, then the day). */
export function weekRange(ending: string | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ending ?? "");
  if (!m) return ending ?? "";
  const end = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  const start = new Date(end.getTime() - 6 * 86_400_000);
  const day = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return `${day(start)} / ${day(end)}`;
}

/** A week's first and last day ("9 Nov", "15 Nov"), for the scorecard's two-line week headers; null if unreadable. */
export function weekBounds(ending: string | undefined): { start: string; end: string } | null {
  const range = weekRange(ending);
  const parts = range.split(" / ");
  return parts.length === 2 ? { start: parts[0], end: parts[1] } : null;
}

/** How many colours the owners' avatars cycle through (globals.css --owner-1 … --owner-6). */
export const OWNER_COLORS = 6;

/**
 * An owner's avatar colour, 1 to 6, picked by a hash of the name so the same person always gets the same colour,
 * everywhere (the owner's request, 15 Nov 2026, as in Bloom Growth). Case and spacing do not change it.
 */
export function ownerColor(name: string): number {
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % OWNER_COLORS) + 1;
}

/** Whether "YYYY-MM-DD" falls in the week ending "MM/DD/YYYY" (that day and the six before it). */
export function inWeek(ending: string | undefined, today: string): boolean {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ending ?? "");
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m || !t) return false;
  const end = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const day = Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  return day <= end && day > end - 7 * 86_400_000;
}

/* ── IDS priority numbers (Ask Sunny and Ask Bubbles; not in the Hub) ─────────────────────────────────────────────
 * The DM L10 run-through (17 Nov 2026): "We need to assign topics a priority of 1, 2, 3, etc., and have them move into
 * that order as we select them. We should then work through and solve issues in that order." As in Bloom Growth: press
 * an issue's number circle and it takes the next number; numbered issues sit on top in that order.
 *
 * The number shown is the issue's place among the open, numbered, short-term issues (1, 2, 3 … with no gaps), worked
 * out from the stored `priorityNumber` each time. So solving #1 makes #2 the new #1, clearing a number closes the gap,
 * and two people numbering at the same moment (both saving the same stored value) still see 1, 2, 3.
 */
const stored = (i: Issue): number | null => (typeof i.priorityNumber === "number" && Number.isFinite(i.priorityNumber) ? i.priorityNumber : null);
const isNumberable = (i: Issue) => !i.resolved && i.term !== "long";

/** The numbered open short-term issues, in their order (stored number, then the order they were added). */
export function numberedIssues(issues: Issue[]): Issue[] {
  return issues
    .map((i, n) => ({ i, n }))
    .filter(({ i }) => isNumberable(i) && stored(i) !== null)
    .sort((a, b) => stored(a.i)! - stored(b.i)! || a.n - b.n)
    .map(({ i }) => i);
}

/** Each numbered issue's number as shown: 1, 2, 3 … */
export function priorityNumbers(issues: Issue[]): Map<string, number> {
  return new Map(numberedIssues(issues).map((i, n) => [i.id, n + 1]));
}

/** Press the number circle: an unnumbered issue takes the next number; a numbered one is cleared (the rest close up). */
export function togglePriorityNumber(issues: Issue[], id: string): Issue[] {
  const target = issues.find((i) => i.id === id);
  if (!target) return issues;
  if (stored(target) !== null || !isNumberable(target)) return issues.map((i) => (i.id === id ? withoutPriorityNumber(i) : i));
  const next = Math.max(0, ...numberedIssues(issues).map((i) => stored(i)!)) + 1;
  return issues.map((i) => (i.id === id ? { ...i, priorityNumber: next } : i));
}

/** An issue without its number (when it is solved or moved to long-term). */
export function withoutPriorityNumber<T extends Issue>(i: T): T {
  if (!("priorityNumber" in i)) return i;
  const copy = { ...i } as Record<string, unknown>;
  delete copy.priorityNumber;
  return copy as T;
}

/**
 * The order the IDS list shows: numbered issues first (1, 2, 3 …), then the issues flagged "!" before numbers existed,
 * then the rest in the order given (Oldest or Newest).
 */
export function orderByPriority(issues: Issue[]): Issue[] {
  const numbers = priorityNumbers(issues);
  const numbered = [...issues].filter((i) => numbers.has(i.id)).sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!);
  const rest = issues.filter((i) => !numbers.has(i.id));
  return [...numbered, ...rest.filter((i) => !!i.priority), ...rest.filter((i) => !i.priority)];
}
