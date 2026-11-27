import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * ONLY ATTENDEES (AND ADMINS) OPEN A MEETING (the owner, 27 Nov 2026)
 * ============================================================================
 *
 * The owner: "make sure only attendees of that meeting can access that page, if not attendee it will show "you are not
 * an attendee of this meeting"", and "should admins be able to open every meeting? - yes for all 3 apps". The Leadership
 * Hub lists a meeting for a person only when they attend it or are an admin; the AI must not hand a meeting's details
 * to anyone else. Through the real chat route, Hub stubbed:
 *   1. A manager who attends only the STC DM L10 asks "what time is the Leadership L10?" — the model is told exactly
 *      "You are not an attendee of this meeting", with no time and no attendees.
 *   2. An admin who attends no meeting asks the same — the Hub lists it for them, so its details reach the model.
 * Invented people only.
 */
const REPORT = "The owner, 27 Nov 2026: only a meeting's attendees (and admins) open it; others see \"You are not an attendee of this meeting\"";
const FLAG = "AGENT_LOOP_ENABLED";

const STC_DM = { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", weekday: 1, startTime: null, minutes: 90, leader: "Robin Example", attendees: ["Robin Example", "Pat Sample"] };
const LEADERSHIP = { key: "leadership", name: "Leadership L10", team: "Executive Team", weekday: 1, startTime: "09:00", minutes: 90, leader: "Lee Demo", attendees: ["Lee Demo", "Casey Example"], opensInApp: false };

type DetailsOutput = { meetings?: { name: string; time_ct: string | null; attendees: string[] }[]; error?: string; reason_code?: string };
const detailsOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_meeting_details")).at(-1)?.output as DetailsOutput | undefined;

/** The Hub answers "meeting-schedules" with `meetings`. */
async function withHub(meetings: unknown[], body: () => Promise<void>) {
  const secret = process.env.HUB_PARTNER_SECRET;
  process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true, meetings }), { status: 200 }));
  try {
    await body();
  } finally {
    vi.unstubAllGlobals();
    if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
    else process.env.HUB_PARTNER_SECRET = secret;
  }
}

async function ask(t: ReplayContext) {
  const model = loopStandIn((view: LoopView) => (lastResult(view, "read_meeting_details") ? { text: "Done." } : { tool: "read_meeting_details", input: { meeting: "the Leadership L10" } }));
  t.loopModel!(model);
  await t.thread().say("what time is the Leadership L10?");
  return detailsOf(model);
}

export const NOV27_MEETING_ATTENDEES_ONLY_CASES: ReplayCase[] = [
  {
    id: "nov27-meeting-not-an-attendee",
    title: `"what time is the Leadership L10?" from a manager who does not attend it — "You are not an attendee of this meeting", and no time or attendees`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      await withHub([STC_DM], async () => {
        const output = await ask(t);
        expect(output?.reason_code, JSON.stringify(output)).toBe("not_attendee");
        expect(output?.error).toMatch(/^You are not an attendee of this meeting\./);
        expect(JSON.stringify(output)).not.toMatch(/09:00|Lee Demo|Casey Example|Robin Example/);
      });
    },
  },
  {
    id: "nov27-meeting-admin-not-attendee-opens-it",
    title: `"what time is the Leadership L10?" from an admin who attends no meeting — the Hub lists it for admins, so its time and attendees reach the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("admin", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      await withHub([STC_DM, LEADERSHIP], async () => {
        const output = await ask(t);
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        expect(output?.meetings).toEqual([expect.objectContaining({ name: "Leadership L10", time_ct: "09:00", attendees: ["Lee Demo", "Casey Example"] })]);
      });
    },
  },
];
