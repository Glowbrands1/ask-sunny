import "server-only";

import { callHub } from "@/features/l10/partner/client.server";
import { leadershipHubUrl } from "@/lib/config/app-switcher";
import type { CalendarEvent, SourceResult } from "./types";

/**
 * L10 meetings (and the person's Leadership Hub reminders) for the calendar, from the Hub: the partner API's
 * "calendar" op, signed like every L10 call, for the signed-in person's verified email. The Hub returns only the
 * meetings this app may open that the person attends. Nothing is stored here. A meeting links to this app's own L10
 * tab; a Hub reminder links to the Hub's calendar (it is changed there).
 */
export async function meetingEventsFromHub(email: string | null | undefined, range: { from: string; to: string }, call: typeof callHub = callHub): Promise<SourceResult> {
  if (!email) return { source: "leadership-hub", state: "off" };
  const answer = await call("calendar", email, { from: range.from, to: range.to });
  if (answer.status === 0 && answer.body.error === "not_configured") return { source: "leadership-hub", state: "off" };
  if (answer.status === 404) return { source: "leadership-hub", state: "ok", events: [] };
  if (answer.status !== 200 || answer.body.ok !== true || !Array.isArray(answer.body.events)) return { source: "leadership-hub", state: "failed" };
  const hub = leadershipHubUrl();
  const events = (answer.body.events as CalendarEvent[]).map((e) => {
    if (e && typeof e === "object" && e.kind === "meeting" && typeof e.meetingKey === "string") return { ...e, href: `/meetings/${e.meetingKey}` };
    if (e && typeof e === "object" && typeof e.href === "string" && e.href.startsWith("/")) return { ...e, href: `${hub}${e.href}`, reminderId: undefined };
    return e;
  });
  return { source: "leadership-hub", state: "ok", events };
}
