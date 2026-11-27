import { CALENDAR_EVENT, SOURCE_LABELS, type CalendarEvent, type CalendarView, type SourceResult } from "./types";

/**
 * One person's calendar from every source that answered (docs/calendar-design.md §3d). A source that failed adds a note
 * and never hides the others. A source that is not configured is left out quietly. Events outside the range, events
 * a source sent under another source's name, and events of an unknown kind are dropped. Pure.
 */
const WHAT: Record<string, string> = {
  "leadership-hub": "meetings and reminders from the Leadership Hub",
  "ask-sunny": "Ask Sunny's forms and reminders",
  "ask-bubbles": "Ask Bubbles' forms and reminders",
};

export function failureNote(source: keyof typeof SOURCE_LABELS): string {
  return `Couldn't load ${WHAT[source]} just now. Showing everything else. Refresh to try again.`;
}

/** Only a path in this app or an https link: never javascript:, data: or a protocol-relative URL. */
export const safeHref = (href: string) => (href.startsWith("/") && !href.startsWith("//")) || /^https:\/\/[^/\s]+/.test(href);

export function mergeSources(from: string, to: string, results: SourceResult[]): CalendarView {
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  const notes: string[] = [];
  for (const r of results) {
    if (r.state === "failed" && !notes.includes(failureNote(r.source))) notes.push(failureNote(r.source));
    if (r.state !== "ok") continue;
    for (const raw of r.events) {
      const parsed = CALENDAR_EVENT.safeParse(raw);
      if (!parsed.success) continue;
      const e = parsed.data;
      if (e.source !== r.source || e.date < from || e.date > to || seen.has(e.id) || !safeHref(e.href)) continue;
      seen.add(e.id);
      events.push(e);
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99") || a.title.localeCompare(b.title));
  return { from, to, events, notes };
}
