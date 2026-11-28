import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE AI READS WHAT IS ON AN L10, BY THE USER'S ACCESS (Pau, 28 Nov 2026)
 * ============================================================================
 *
 * Pau, looking at the admins' AI-readable pages list, where every meeting page said "No": "why it cant read this?", then
 * "ok but depends on the access of the user ok? admin gets all". read_meeting reads the meeting pages from the Leadership
 * Hub as the person asking, so the Hub decides as it does for the pages: the meeting's attendees, and the Hub's admins,
 * who get every meeting. Through the real chat route with production's flags, Hub stubbed by op:
 *   1. An attendee of the STC DM L10 asks "what are my to-dos from the DM L10?" — the meeting's to-dos, owners, due dates
 *      and the last meeting reach the model.
 *   2. A manager who attends only the STC DM L10 asks what is open on the Leadership L10 — "You are not an attendee of
 *      this meeting", and the Hub is never asked for that meeting's content.
 *   3. An admin who attends no meeting asks the same — the Hub lists every meeting for admins, so its content reaches the
 *      model.
 * Invented people only.
 */
const REPORT = "Pau, 28 Nov 2026: \"why it cant read this?\" (the meeting pages) — \"ok but depends on the access of the user ok? admin gets all\"";
const FLAG = "AGENT_LOOP_ENABLED";

const STC_DM = { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", weekday: 1, startTime: "10:00", minutes: 90, leader: "Robin Example", attendees: ["Robin Example", "Pat Sample"] };
const LEADERSHIP = { key: "leadership", name: "Leadership L10", team: "Executive Team", weekday: 1, startTime: "09:00", minutes: 90, leader: "Lee Demo", attendees: ["Lee Demo", "Casey Example"] };

const DOCS: Record<string, Record<string, unknown>> = {
  "stc-dm": {
    todos: [
      { id: "t1", text: "Order the invented lamps", owner: "Pat Sample", dueDate: "2026-11-20", done: false },
      { id: "t2", text: "Call the invented landlord", owner: "Robin Example", dueDate: "2026-12-02", done: false },
    ],
    issues: [{ id: "i1", title: "Invented staffing gap", notes: "", resolved: false, owner: "Robin Example" }],
  },
  leadership: {
    todos: [{ id: "l1", text: "Invented budget review", owner: "Lee Demo", dueDate: "2026-12-01", done: false }],
    issues: [{ id: "l2", title: "Invented expansion question", notes: "", resolved: false, owner: "Casey Example" }],
  },
};
const RECAPS = [{ id: "r1", meeting_key: "stc-dm", session_id: "s1", held_at: "2026-11-23T16:00:00Z", rating_avg: 8.5, attendee_count: 2, duration_seconds: 5400, cascade: null, attendees: [{ name: "Pat Sample", rating: 9 }, { name: "Robin Example", rating: 8 }], open_todos: [], resolved_issues: [{ title: "Invented solved issue", owner: "Pat Sample" }] }];

type MeetingOutput = { meeting?: string; to_dos?: { untrusted_text: string } | "none"; issues?: { untrusted_text: string } | "none"; past_meetings?: { untrusted_text: string } | "none"; error?: string; reason_code?: string };
const meetingOf = (model: ReturnType<typeof loopStandIn>) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_meeting")).at(-1)?.output as MeetingOutput | undefined;

/** The Hub, by op: "meeting-schedules" lists `meetings` for this person; "load" and "recaps" answer only for those. */
async function withHub(meetings: (typeof STC_DM)[], body: (asked: string[]) => Promise<void>) {
  const secret = process.env.HUB_PARTNER_SECRET;
  process.env.HUB_PARTNER_SECRET = "replay-hub-secret-0123456789abcdef0123";
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const { op, key } = JSON.parse(init.body) as { op: string; key?: string };
    asked.push(key ? `${op}:${key}` : op);
    if (op === "meeting-schedules") return new Response(JSON.stringify({ ok: true, meetings }), { status: 200 });
    if (!meetings.some((m) => m.key === key)) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    if (op === "load") return new Response(JSON.stringify({ loaded: { version: 4, updatedAt: "2026-11-26T15:00:00Z", doc: DOCS[key!] } }), { status: 200 });
    if (op === "recaps") return new Response(JSON.stringify({ recaps: key === "stc-dm" ? RECAPS : [] }), { status: 200 });
    return new Response("{}", { status: 500 });
  });
  try {
    await body(asked);
  } finally {
    vi.unstubAllGlobals();
    if (secret === undefined) delete process.env.HUB_PARTNER_SECRET;
    else process.env.HUB_PARTNER_SECRET = secret;
  }
}

async function ask(t: ReplayContext, words: string, meeting: string) {
  const model = loopStandIn((view: LoopView) => (lastResult(view, "read_meeting") ? { text: "Done." } : { tool: "read_meeting", input: { meeting } }));
  t.loopModel!(model);
  await t.thread().say(words);
  return meetingOf(model);
}
const textOf = (v: { untrusted_text: string } | "none" | undefined) => (v && typeof v === "object" ? v.untrusted_text : String(v));

export const NOV28_MEETING_CONTENT_CASES: ReplayCase[] = [
  {
    id: "nov28-meeting-content-reaches-the-model",
    title: `"what are my to-dos from the DM L10?" from an attendee — the meeting's to-dos, owners, due dates and last meeting reach the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("district_manager", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      await withHub([STC_DM], async () => {
        const output = await ask(t, "what are my to-dos from the DM L10?", "DM L10");
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        expect(output?.meeting).toBe("STC DM L10");
        expect(textOf(output?.to_dos)).toContain("Pat Sample: Order the invented lamps (Due Fri, Nov 20) OVERDUE");
        expect(textOf(output?.to_dos)).toContain("Robin Example: Call the invented landlord (Due Wed, Dec 2)");
        expect(textOf(output?.issues)).toContain("Invented staffing gap (owner Robin Example)");
        expect(textOf(output?.past_meetings)).toContain("rated 8.5");
        expect(textOf(output?.past_meetings)).toContain("Invented solved issue (Pat Sample)");
      });
    },
  },
  {
    id: "nov28-meeting-content-not-an-attendee",
    title: `"what's open on the Leadership L10?" from a manager who does not attend it — "You are not an attendee of this meeting", and its content is never asked for`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      await withHub([STC_DM], async (asked) => {
        const output = await ask(t, "what's open on the Leadership L10?", "the Leadership L10");
        expect(output?.reason_code, JSON.stringify(output)).toBe("not_attendee");
        expect(output?.error).toMatch(/^You are not an attendee of this meeting\./);
        expect(JSON.stringify(output)).not.toMatch(/Invented budget|Invented expansion|Lee Demo|Casey Example/);
        expect(asked.filter((op) => op.endsWith(":leadership")), "the Hub was asked for the Leadership L10's content").toEqual([]);
      });
    },
  },
  {
    id: "nov28-meeting-content-admin-reads-every-meeting",
    title: `"what's open on the Leadership L10?" from an admin who attends no meeting — the Hub gives admins every meeting, so its content reaches the model`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("admin", KEARNEY);
      vi.setSystemTime(new Date("2026-11-27T16:00:00Z"));
      await withHub([STC_DM, LEADERSHIP], async () => {
        const output = await ask(t, "what's open on the Leadership L10?", "the Leadership L10");
        expect(output?.error, JSON.stringify(output)).toBeUndefined();
        expect(output?.meeting).toBe("Leadership L10");
        expect(textOf(output?.to_dos)).toContain("Lee Demo: Invented budget review");
        expect(textOf(output?.issues)).toContain("Invented expansion question (owner Casey Example)");
      });
    },
  },
];
