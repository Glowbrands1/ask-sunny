import { z } from "zod";

/**
 * The calendar's shared event shape (Glowbrands1/leadership-hub docs/calendar-design.md §5; the Hub keeps the same
 * file at src/lib/calendar/types.ts: change both together). Every app answers for its OWN events in this shape and
 * gathers the others' through signed partner calls; nothing is copied between databases. Pure: no server-only imports.
 */
export const SOURCES = ["leadership-hub", "ask-sunny", "ask-bubbles"] as const;
export type CalendarSource = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<CalendarSource, string> = {
  "leadership-hub": "Leadership Hub",
  "ask-sunny": "Ask Sunny",
  "ask-bubbles": "Ask Bubbles",
};

export const KINDS = ["meeting", "form-follow-up", "hr-approval", "google-reviews", "reminder"] as const;
export type CalendarKind = (typeof KINDS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One event, as any of the three apps sends it. Unknown kinds (time off, anything new) are refused, not shown. */
export const CALENDAR_EVENT = z.object({
  id: z.string().min(1).max(200),
  source: z.enum(SOURCES),
  kind: z.enum(KINDS),
  title: z.string().min(1).max(300),
  date: isoDate,
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  minutes: z.number().int().min(1).max(1440).optional(),
  status: z.enum(["due", "overdue", "upcoming"]).optional(),
  location: z.string().max(200).optional(),
  href: z.string().min(1).max(2000),
  /** Meetings only: the Hub's meeting key, so a partner app can link to its own L10 tab instead of the Hub. */
  meetingKey: z.string().regex(/^[a-z][a-z-]{0,40}$/).optional(),
  /** Reminders only: "only_me" or "my_team", whether the viewer made it (and may delete it), and who did if not. */
  visibility: z.enum(["only_me", "my_team"]).optional(),
  mine: z.boolean().optional(),
  by: z.string().max(120).optional(),
  /** Reminders only: the owning app's id, for Delete (only in that app, only by its owner). */
  reminderId: z.string().max(64).optional(),
});
export type CalendarEvent = z.infer<typeof CALENDAR_EVENT>;

/** What one source gave back: events, nothing configured, or a failure the page names in a note. */
export type SourceResult =
  | { source: CalendarSource; state: "ok"; events: CalendarEvent[] }
  | { source: CalendarSource; state: "off" }
  | { source: CalendarSource; state: "failed" };

export interface CalendarView {
  from: string;
  to: string;
  events: CalendarEvent[];
  /** One line per source that did not answer ("Couldn't load Ask Sunny's forms and reminders just now. …"). */
  notes: string[];
}

export const MAX_RANGE_DAYS = 62;
