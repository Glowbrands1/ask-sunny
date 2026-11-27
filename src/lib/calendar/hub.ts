import "server-only";

import { callHub } from "@/features/l10/partner/client.server";
import { leadershipHubUrl } from "@/lib/config/app-switcher";
import { parseMeetingDetails, type MeetingDetailsResult, type MeetingScheduleInput, type MeetingScheduleSaveResult } from "./meeting-details";
import type { CalendarEvent, SourceResult } from "./types";

/**
 * L10 meetings (and the person's Leadership Hub reminders) for the calendar, from the Hub: the partner API's
 * "calendar" op, signed like every L10 call, for the signed-in person's verified email. The Hub returns only the
 * meetings this app may show that the person attends. Nothing is stored here. A meeting links to this app's own L10
 * tab, or to the Hub's meeting page for one this app only shows (opensInApp false: the Leadership and Maintenance L10s,
 * the owner, 27 Nov 2026); a Hub reminder links to the Hub's calendar (it is changed there).
 */
export async function meetingEventsFromHub(email: string | null | undefined, range: { from: string; to: string }, call: typeof callHub = callHub): Promise<SourceResult> {
  if (!email) return { source: "leadership-hub", state: "off" };
  const answer = await call("calendar", email, { from: range.from, to: range.to });
  if (answer.status === 0 && answer.body.error === "not_configured") return { source: "leadership-hub", state: "off" };
  if (answer.status === 404) return { source: "leadership-hub", state: "ok", events: [] };
  if (answer.status !== 200 || answer.body.ok !== true || !Array.isArray(answer.body.events)) return { source: "leadership-hub", state: "failed" };
  const hub = leadershipHubUrl();
  const events = (answer.body.events as CalendarEvent[]).map((e) => {
    if (e && typeof e === "object" && e.kind === "meeting" && typeof e.meetingKey === "string")
      return { ...e, href: (e as { opensInApp?: boolean }).opensInApp === false ? `${hub}/meetings/${e.meetingKey}` : `/meetings/${e.meetingKey}` };
    if (e && typeof e === "object" && typeof e.href === "string" && e.href.startsWith("/")) return { ...e, href: `${hub}${e.href}`, reminderId: undefined };
    return e;
  });
  return { source: "leadership-hub", state: "ok", events };
}

/**
 * Each L10 this person may open here, with its day, Central time, length, leader and attendees: the partner API's
 * "meeting-schedules" op. Read-only: a schedule is set in the Leadership Hub. An unknown person is an empty list.
 */
export async function meetingDetailsFromHub(email: string | null | undefined, call: typeof callHub = callHub): Promise<MeetingDetailsResult> {
  if (!email) return { state: "off" };
  const answer = await call("meeting-schedules", email);
  if (answer.status === 0 && answer.body.error === "not_configured") return { state: "off" };
  if (answer.status === 404) return { state: "ok", meetings: [] };
  if (answer.status !== 200 || answer.body.ok !== true || !Array.isArray(answer.body.meetings)) return { state: "failed" };
  return { state: "ok", meetings: parseMeetingDetails(answer.body.meetings) };
}

/**
 * Set a meeting's day, Central time and length in the Leadership Hub, as this person (the partner API's
 * "set-meeting-schedule" op). The Hub allows it for its admins only, on a meeting this app shows; it stores the schedule,
 * so every calendar follows it on its next load. Nothing is stored here.
 */
export async function setMeetingScheduleInHub(email: string | null | undefined, input: MeetingScheduleInput, call: typeof callHub = callHub): Promise<MeetingScheduleSaveResult> {
  if (!email) return { ok: false, reason: "signin" };
  const answer = await call("set-meeting-schedule", email, { key: input.key, weekday: input.weekday, time: input.time, minutes: input.minutes });
  if (answer.status === 200 && answer.body.ok === true) return { ok: true };
  if (answer.status === 200 && (answer.body.reason === "forbidden" || answer.body.reason === "invalid")) return { ok: false, reason: answer.body.reason };
  if (answer.status === 404) return { ok: false, reason: "forbidden" };
  if (answer.status === 400) return { ok: false, reason: "invalid" };
  return { ok: false, reason: "unavailable" };
}
