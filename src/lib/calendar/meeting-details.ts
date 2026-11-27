import { z } from "zod";

/**
 * Each L10's schedule and attendees as the Leadership Hub gives them (the partner API's "meeting-schedules" op;
 * leadership-hub docs/calendar-design.md §5d): the day, Central start time and length, who leads it and who attends
 * (names only). The Hub is the one place a schedule is set; this app only reads it. Pure.
 */
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DETAILS = z.object({
  key: z.string().regex(/^[a-z][a-z-]{0,40}$/),
  name: z.string().min(1).max(300),
  team: z.string().max(300).nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  minutes: z.number().int().min(1).max(1440).nullable(),
  leader: z.string().max(200).nullable().optional(),
  attendees: z.array(z.string().min(1).max(200)).max(100),
  /** False when this app shows the meeting but opens it in the Leadership Hub (the Leadership and Maintenance L10s). */
  opensInApp: z.boolean().optional(),
});
export type MeetingDetails = z.infer<typeof DETAILS>;

export type MeetingDetailsResult = { state: "ok"; meetings: MeetingDetails[] } | { state: "off" } | { state: "failed" };

/** The Hub's list; a malformed entry is dropped, never shown half-read. */
export function parseMeetingDetails(raw: unknown): MeetingDetails[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const r = DETAILS.safeParse(m);
    return r.success ? [r.data] : [];
  });
}

/** The meetings that never appear on the calendar because no day is set. */
export function noDaySet(meetings: readonly MeetingDetails[]): MeetingDetails[] {
  return meetings.filter((m) => m.weekday === null);
}

/** "9:30" -> "9:30 AM". */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Mondays at 9:00 AM CT · 90 min", "Tuesdays · time not set · 60 min", "No day set". */
export function scheduleLabel(m: Pick<MeetingDetails, "weekday" | "startTime" | "minutes">): string {
  if (m.weekday === null) return "No day set";
  const day = `${WEEKDAY_NAMES[m.weekday]}s`;
  return [m.startTime ? `${day} at ${clock(m.startTime)} CT` : `${day} · time not set`, m.minutes ? `${m.minutes} min` : null].filter(Boolean).join(" · ");
}

/** "BCS DM", "the stc-dm l10" -> letters and digits only, to match a meeting's key or name. */
const squash = (s: string) => s.toLowerCase().replace(/\bthe\b|\bl10s?\b/g, "").replace(/[^a-z0-9]/g, "");

/** The meetings a question names (by key or name, exact first), or all of them when it names none. */
export function pickMeetings(meetings: readonly MeetingDetails[], named?: string): MeetingDetails[] {
  const q = named ? squash(named) : "";
  if (!q) return [...meetings];
  const exact = meetings.filter((m) => squash(m.key) === q || squash(m.name) === q);
  return exact.length ? exact : meetings.filter((m) => squash(m.name).includes(q) || squash(m.key).includes(q));
}

/** Where "Open the L10" goes: this app's L10 tab, or the Leadership Hub's meeting page for one this app cannot open. */
export function meetingHref(m: { key: string; opensInApp?: boolean }, hubUrl: string | null): string {
  return m.opensInApp === false && hubUrl ? `${hubUrl}/meetings/${m.key}` : `/meetings/${m.key}`;
}

/**
 * A day, Central time and length set from this app (the owner, 27 Nov 2026). Stored in the Leadership Hub (the partner
 * API's "set-meeting-schedule" op), so the Hub and both apps follow it; the Hub allows it for its admins only.
 */
export const MEETING_SCHEDULE_INPUT = z.object({
  key: z.string().regex(/^[a-z][a-z-]{0,40}$/),
  weekday: z.number().int().min(0).max(6).nullable(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  minutes: z.number().int().min(5).max(480).nullable(),
});
export type MeetingScheduleInput = z.infer<typeof MEETING_SCHEDULE_INPUT>;
export type MeetingScheduleSaveResult = { ok: true } | { ok: false; reason: "forbidden" | "invalid" | "unavailable" | "signin" };
