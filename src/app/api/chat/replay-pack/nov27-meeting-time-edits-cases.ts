import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A ONE-OFF TIME CHANGE REACHES THE AI (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * The owner: "ability to edit times pls and make it recurring or just for that specific time and get people notified for
 * time changes if they are attendee for ALL apps". A meeting's attendee changes Mon, Nov 2's STC DM L10 to 11:30 for that
 * date only; the Leadership Hub stores it and its calendar gives that date's own time, marked one-off. Through the real
 * chat route, Hub stubbed:
 *   "what time is the STC DM L10 on Nov 2?" — read_calendar gives the model 11:30 for Nov 2, marked as changed for that
 *   date only, and the weekly time for the next Monday.
 * Invented people only.
 */
const REPORT = "The owner, 27 Nov 2026: edit a meeting's time every week or only for one date, and the AI reads it";
const FLAG = "AGENT_LOOP_ENABLED";

type CalendarOutput = { events?: { date: string; what: string; title: string; time_ct?: string | null; changed_for_this_date_only?: boolean }[]; error?: string };
const calendarOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_calendar")).at(-1)?.output as CalendarOutput | undefined;

const EVENTS = [
  { id: "hub:meeting:stc-dm:2026-11-02", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-11-02", startTime: "11:30", minutes: 90, status: "upcoming", href: "/meetings/stc-dm", meetingKey: "stc-dm", oneOff: true },
  { id: "hub:meeting:stc-dm:2026-11-09", source: "leadership-hub", kind: "meeting", title: "STC DM L10", date: "2026-11-09", startTime: "10:00", minutes: 90, status: "upcoming", href: "/meetings/stc-dm", meetingKey: "stc-dm" },
];

export const NOV27_MEETING_TIME_EDITS_CASES: ReplayCase[] = [
  {
    id: "nov27-meeting-time-one-off-nov-2",
    title: `"what time is the STC DM L10 on Nov 2?" after a one-off change — the model gets 11:30 for that date, marked as changed for that date only`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-01T16:00:00Z"));
      const secret = process.env.HUB_PARTNER_SECRET;
      process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
      vi.stubGlobal("fetch", async (_url: string, init: { body: string }) =>
        new Response(JSON.stringify(JSON.parse(init.body).op === "calendar" ? { ok: true, events: EVENTS } : { ok: true, meetings: [] }), { status: 200 }));
      try {
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_calendar") ? { text: "11:30 that day." } : { tool: "read_calendar", input: { from: "2026-11-02", to: "2026-11-09" } }));
        t.loopModel!(model);
        await t.thread().say("what time is the STC DM L10 on Nov 2?");
        const output = calendarOf(model);
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        const meetings = (output?.events ?? []).filter((e) => e.what === "meeting");
        expect(meetings.find((e) => e.date === "2026-11-02")).toMatchObject({ time_ct: "11:30", changed_for_this_date_only: true });
        expect(meetings.find((e) => e.date === "2026-11-09")).toMatchObject({ time_ct: "10:00" });
        expect(meetings.find((e) => e.date === "2026-11-09")?.changed_for_this_date_only).toBeUndefined();
      } finally {
        vi.unstubAllGlobals();
        if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
        else process.env.HUB_PARTNER_SECRET = secret;
      }
    },
  },
];
