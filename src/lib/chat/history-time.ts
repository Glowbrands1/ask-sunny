import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * WHEN A CONVERSATION WAS LAST ACTIVE, AND HOW THE HISTORY PANEL SAYS SO
 * ============================================================================
 *
 * Three decisions live here so the History panel makes each of them once:
 *
 *   WHICH INSTANT. `lastActivityAt` — the later of the conversation's
 *   `updatedAt` and its newest turn. An older thread that gets a new message
 *   today is a thread from today, and moves back to the top.
 *
 *   WHICH ZONE. Central, as `America/Chicago` rather than a fixed offset, so
 *   CST and CDT are the IANA database's problem and never an hour wrong for
 *   half the year. The panel prints "CT" beside every time, and the day
 *   sections (Today, Yesterday…) are Central calendar days — so a question
 *   asked at 8 p.m. Central is "Today", not tomorrow's UTC date. Nothing here
 *   reads the browser's zone or formats in UTC.
 *
 *   WHICH ORDER. Newest first, everywhere: across sections and within each.
 *
 * Display only. Nothing here changes a stored timestamp, a conversation or
 * its turns — sorting a copy and formatting an instant is all it does.
 *
 * Client-safe: pure `Intl`, no database client and no server-only import.
 */

/**
 * The zone chat history is rendered and grouped in.
 *
 * `history-time.test.ts` pins it to `REPORTING_TIME_ZONE`, the zone the rest
 * of the product already renders timestamps in, so the two cannot drift.
 */
export const CHAT_HISTORY_TIME_ZONE = "America/Chicago";

export const HISTORY_SECTIONS = [
  "Today",
  "Yesterday",
  "Previous 7 Days",
  "Earlier",
] as const;

export type HistorySection = (typeof HISTORY_SECTIONS)[number];

function time(value: string | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

/**
 * The conversation's latest activity, in epoch milliseconds — or 0 when
 * nothing on it is a readable time, so a malformed record sorts to the bottom
 * rather than throwing.
 */
export function lastActivityTime(
  conversation: Pick<ChatConversation, "updatedAt" | "messages">,
): number {
  let latest = time(conversation.updatedAt);
  for (const message of conversation.messages) {
    const at = time(message.createdAt);
    if (Number.isFinite(at) && !(at <= latest)) latest = at;
  }
  return Number.isFinite(latest) ? latest : 0;
}

/** The same instant as an ISO string, for `<time dateTime>`. */
export function lastActivityAt(
  conversation: Pick<ChatConversation, "updatedAt" | "messages">,
): string {
  return new Date(lastActivityTime(conversation)).toISOString();
}

/**
 * Newest first. Ties break on id so two renderings of the same data never
 * shuffle. Returns a copy — the caller's array is not reordered.
 */
export function sortByLastActivity<
  T extends Pick<ChatConversation, "id" | "updatedAt" | "messages">,
>(conversations: readonly T[]): T[] {
  return conversations
    .map((conversation) => ({ conversation, at: lastActivityTime(conversation) }))
    .sort(
      (a, b) =>
        b.at - a.at ||
        (a.conversation.id < b.conversation.id
          ? -1
          : a.conversation.id > b.conversation.id
            ? 1
            : 0),
    )
    .map((entry) => entry.conversation);
}

const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: CHAT_HISTORY_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

const CALENDAR_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: CHAT_HISTORY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parts(date: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of DATE_PARTS.formatToParts(date)) out[part.type] = part.value;
  return out;
}

/**
 * `Sep 25, 2026 • 7:05 PM CT` — the line under every history title.
 *
 * "CT" rather than CDT/CST, so every row reads the same way; the conversion
 * underneath still follows daylight saving, and `formatHistoryTimestampExact`
 * names the specific one for a tooltip.
 */
export function formatHistoryTimestamp(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "—";
  const p = parts(date);
  return `${p.month} ${p.day}, ${p.year} • ${p.hour}:${p.minute} ${p.dayPeriod} CT`;
}

/** `Sep 25, 2026 • 7:05 PM CDT` — the same instant with the zone spelled out. */
export function formatHistoryTimestampExact(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "—";
  const p = parts(date);
  return `${p.month} ${p.day}, ${p.year} • ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/** The Central calendar day an instant falls on, as a UTC-midnight epoch. */
function centralDay(date: Date): number {
  const [year, month, day] = CALENDAR_DAY.format(date).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

/**
 * Which section an instant belongs to, judged in Central calendar days.
 *
 * Calendar days, not 24-hour spans: 11:59 p.m. yesterday is "Yesterday" at
 * 12:01 a.m. today. "Previous 7 Days" is two to seven days back. Anything in
 * the future (a fast clock somewhere) counts as today rather than
 * disappearing.
 */
export function historySection(
  value: string | number | Date,
  now: Date,
): HistorySection {
  const date = toDate(value);
  if (!date) return "Earlier";
  const daysAgo = Math.round((centralDay(now) - centralDay(date)) / 86_400_000);
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "Previous 7 Days";
  return "Earlier";
}

export type HistoryGroup<T> = { section: HistorySection; items: T[] };

/**
 * The History panel's whole structure: sections in fixed order, empty ones
 * omitted, each sorted newest → oldest.
 */
export function groupConversationHistory<
  T extends Pick<ChatConversation, "id" | "updatedAt" | "messages">,
>(conversations: readonly T[], now: Date): HistoryGroup<T>[] {
  const buckets = new Map<HistorySection, T[]>();
  for (const conversation of sortByLastActivity(conversations)) {
    const section = historySection(lastActivityTime(conversation), now);
    const list = buckets.get(section) ?? [];
    list.push(conversation);
    buckets.set(section, list);
  }
  return HISTORY_SECTIONS.filter((section) => buckets.has(section)).map(
    (section) => ({ section, items: buckets.get(section)! }),
  );
}

/**
 * `7:05 PM CT` — the time on a single chat turn, in the same zone as the
 * History panel, so a thread never shows a UTC time beside a Central one.
 */
export function formatChatTime(value: string | number | Date): string {
  const date = toDate(value);
  if (!date) return "—";
  const p = parts(date);
  return `${p.hour}:${p.minute} ${p.dayPeriod} CT`;
}
