/**
 * Date helpers.
 *
 * Everything relative in the prototype ("due in 3 days", "3 follow-ups need
 * attention") is measured against DEMO_ANCHOR rather than the wall clock. That
 * keeps the demo deterministic — identical on the server and in the browser, so
 * there is no hydration drift, and identical every time it is presented.
 *
 * When the prototype moves to real data, delete DEMO_ANCHOR and pass `new Date()`.
 * To refresh the demo before a presentation, move this one constant.
 */
export const DEMO_ANCHOR = "2026-08-26T09:00:00.000Z";

export function demoNow(): Date {
  return new Date(DEMO_ANCHOR);
}

/** Wall-clock milliseconds when this module was first evaluated. */
const MODULE_LOADED_AT = Date.now();

/**
 * Timestamp for records created during a session (a new message, an upload, a
 * saved form).
 *
 * It advances from DEMO_ANCHOR by however long the page has been open, so
 * everything created live reads as "just now" against the same clock the
 * seeded data uses. Stamping records with the real wall clock instead would
 * make a brand-new conversation show up as "13 hours ago".
 *
 * Only ever called from event handlers, so it cannot affect hydration.
 * In production this becomes `new Date().toISOString()`.
 */
export function nowIso(): string {
  return new Date(
    demoNow().getTime() + (Date.now() - MODULE_LOADED_AT),
  ).toISOString();
}

/** ISO date (YYYY-MM-DD) offset from the demo anchor. */
export function isoDaysFromAnchor(days: number): string {
  const d = demoNow();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Full ISO timestamp offset from the demo anchor. */
export function isoHoursFromAnchor(hours: number): string {
  const d = demoNow();
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parse(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Bare YYYY-MM-DD is parsed as UTC midnight by spec; keep it in UTC so the
  // rendered day never shifts by timezone.
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

/** "12 Aug 2026" -> compact, unambiguous. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatLongDate(value: string | Date): string {
  const d = parse(value);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function formatDateTime(value: string | Date): string {
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${formatDate(d)} · ${display}:${minutes} ${suffix}`;
}

export function formatTime(value: string | Date): string {
  const d = parse(value);
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes().toString().padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

/** Whole days between the demo anchor and a date. Negative = in the past. */
export function daysFromNow(value: string | Date): number {
  const target = parse(value);
  const anchor = demoNow();
  const dayMs = 86_400_000;
  const a = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  const b = Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
  );
  return Math.round((a - b) / dayMs);
}

/** "Today", "Tomorrow", "in 4 days", "3 days ago". */
export function relativeDay(value: string | Date | null): string {
  if (!value) return "No date set";
  const diff = daysFromNow(value);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1) return `in ${diff} days`;
  return `${Math.abs(diff)} days ago`;
}

/** "2 hours ago", "3 days ago" — used for activity feeds and chat history. */
export function relativeTime(value: string | Date): string {
  const target = parse(value);
  const diffMs = demoNow().getTime() - target.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  return formatDate(target);
}

/** Groups chat history into "Today" / "This week" / "Earlier" buckets. */
export function historyBucket(value: string | Date): string {
  const diff = -daysFromNow(value);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 7) return "Previous 7 days";
  if (diff <= 30) return "Previous 30 days";
  return "Earlier";
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
