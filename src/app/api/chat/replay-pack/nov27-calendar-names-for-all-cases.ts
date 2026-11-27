import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A MEETING THE MANAGER DOES NOT ATTEND: ITS NAME AND WHEN, NOTHING MORE (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * The owner, choosing "B": someone who does not attend a meeting sees it on the calendar by its name and day (and time,
 * if set) only; opening it says only "You are not an attendee of this meeting". The Leadership Hub's calendar marks such
 * a meeting attending false and sends no team or people. Through the real chat route, Hub stubbed:
 *   "when is the Leadership L10 this week?" from a manager who attends only the STC DM L10 — read_calendar gives the
 *   model the Leadership L10's day and time, marked you_attend false, and nothing about who is in it.
 * Invented people only.
 */
const REPORT = "The owner, 27 Nov 2026 (\"B\"): non-attendees see a meeting's name and day only";
const FLAG = "AGENT_LOOP_ENABLED";

type CalendarOutput = { events?: Record<string, unknown>[]; note?: string; error?: string };
const calendarOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_calendar")).at(-1)?.output as CalendarOutput | undefined;

const EVENTS = [
  { id: "hub:meeting:leadership:2026-11-30", source: "leadership-hub", kind: "meeting", title: "Leadership L10", date: "2026-11-30", startTime: "09:00", minutes: 90, status: "upcoming", href: "/meetings/leadership", meetingKey: "leadership", opensInApp: false, attending: false },
  { id: "hub:meeting:stc-dm:2026-11-30", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-11-30", minutes: 90, status: "upcoming", href: "/meetings/stc-dm", meetingKey: "stc-dm" },
];

export const NOV27_CALENDAR_NAMES_FOR_ALL_CASES: ReplayCase[] = [
  {
    id: "nov27-calendar-non-attendee-sees-name-and-time-only",
    title: `"when is the Leadership L10 this week?" from a manager who does not attend it — its day and time, marked you_attend false, and nothing about who is in it`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      const secret = process.env.HUB_PARTNER_SECRET;
      process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
      vi.stubGlobal("fetch", async (_url: string, init: { body: string }) =>
        new Response(JSON.stringify(JSON.parse(init.body).op === "calendar" ? { ok: true, events: EVENTS } : { ok: true, meetings: [] }), { status: 200 }));
      try {
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "Monday at 9:00 AM." } : { tool: "read_calendar", input: { from: "2026-11-30", to: "2026-12-06" } }));
        t.loopModel!(model);
        await t.thread().say("when is the Leadership L10 this week?");
        const output = calendarOf(model);
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        const lead = (output?.events ?? []).find((e) => e.title === "Leadership L10");
        expect(lead).toMatchObject({ date: "2026-11-30", time_ct: "09:00", you_attend: false });
        expect(Object.keys(lead ?? {})).not.toEqual(expect.arrayContaining(["attendees", "leader", "team"]));
        expect((output?.events ?? []).find((e) => e.title === "STC DM L10")?.you_attend).toBeUndefined();
        expect(output?.note).toMatch(/you_attend false .* say only that it exists and when/);
      } finally {
        vi.unstubAllGlobals();
        if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
        else process.env.HUB_PARTNER_SECRET = secret;
      }
    },
  },
];
