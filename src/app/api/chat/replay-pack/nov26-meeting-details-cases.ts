import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE AI CAN READ EACH L10'S DAY, TIME AND ATTENDEES (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * The Calendar's meeting panel shows each L10's day, Central time, length, who leads it and who attends, from the
 * Leadership Hub (the partner API's "meeting-schedules" op); it ships with its reader (CLAUDE.md §5):
 * read_meeting_details. Asked in a manager's words, through the real chat route, with the Hub stubbed:
 *   1. "who's in the STC DM L10?" — the Hub's attendees and leader reach the model.
 *   2. "what time is the STC DM L10?" — the Hub has no time set: the model is told it is not set, never a guess.
 *   3. The Hub does not answer — the model is told it could not be read, never an empty meeting.
 * Invented people only.
 */
const REPORT = "Pau, 26 Nov 2026: the Calendar's meeting details (day, time, attendees), readable by the AI";
const FLAG = "AGENT_LOOP_ENABLED";

const STC_DM = { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", weekday: 1, startTime: null, minutes: 90, leader: "Robin Example", attendees: ["Robin Example", "Pat Sample", "Lee Demo"], href: "/meetings/stc-dm" };

type DetailsOutput = { meetings?: { name: string; day: string | null; time_ct: string | null; minutes: number | null; leader: string | null; attendees: string[] }[]; note?: string; refused?: string; error?: string; reason_code?: string };
const detailsOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_meeting_details")).at(-1)?.output as DetailsOutput | undefined;

/** The Hub answers "meeting-schedules" with `answer` (status 200) or fails with `status`. */
async function withHub(answer: unknown, status: number, body: (asked: string[]) => Promise<void>) {
  const secret = process.env.HUB_PARTNER_SECRET;
  process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    asked.push(JSON.parse(init.body).op);
    return new Response(JSON.stringify(answer), { status: url.endsWith("/api/partner/l10") ? status : 404 });
  });
  try {
    await body(asked);
  } finally {
    vi.unstubAllGlobals();
    if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
    else process.env.HUB_PARTNER_SECRET = secret;
  }
}

function asManager(t: ReplayContext) {
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
}

export const NOV26_MEETING_DETAILS_CASES: ReplayCase[] = [
  {
    id: "nov26-meeting-details-whos-in-the-stc-dm-l10",
    title: `"who's in the STC DM L10?" — read_meeting_details gives the model the Leadership Hub's attendees and who leads it`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      asManager(t);
      await withHub({ ok: true, meetings: [STC_DM] }, 200, async (asked) => {
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_meeting_details") ? { text: "Here's who's in it." } : { tool: "read_meeting_details", input: { meeting: "STC DM" } }));
        t.loopModel!(model);
        await t.thread().say("who's in the STC DM L10?");
        const output = detailsOf(model);
        expect(asked).toContain("meeting-schedules");
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        expect(output?.meetings).toEqual([expect.objectContaining({ name: "STC DM L10", leader: "Robin Example", attendees: ["Robin Example", "Pat Sample", "Lee Demo"] })]);
      });
    },
  },
  {
    id: "nov26-meeting-details-what-time-is-the-stc-dm-l10-not-set",
    title: `"what time is the STC DM L10?" — the Hub has no start time set: the model gets Monday, 90 min and time not set, never a guessed time`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      asManager(t);
      await withHub({ ok: true, meetings: [STC_DM] }, 200, async () => {
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_meeting_details") ? { text: "It's on Mondays; the time isn't set yet." } : { tool: "read_meeting_details", input: { meeting: "the STC DM L10" } }));
        t.loopModel!(model);
        await t.thread().say("what time is the STC DM L10?");
        const output = detailsOf(model);
        expect(output?.meetings?.[0]).toMatchObject({ day: "Monday", time_ct: null, minutes: 90 });
        expect(output?.note).toMatch(/never guess/);
      });
    },
  },
  {
    id: "nov26-meeting-details-hub-down-is-not-an-empty-meeting",
    title: `"who's in my L10?" with the Leadership Hub not answering — the model is told the details could not be read, never given an empty attendee list`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      asManager(t);
      await withHub({ error: "unavailable" }, 503, async () => {
        const model = loopStandIn((view: LoopView) => (lastResult(view, "read_meeting_details") ? { text: "I couldn't read that just now." } : { tool: "read_meeting_details", input: {} }));
        t.loopModel!(model);
        await t.thread().say("who's in my L10?");
        const output = detailsOf(model);
        expect(output?.reason_code).toBe("read_failed");
        expect(output?.meetings).toBeUndefined();
      });
    },
  },
];
