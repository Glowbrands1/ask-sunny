import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE OVERDUE COUNT IS ONE NUMBER, AND THE AI SAYS IT TOO (QA, 24 Nov 2026)
 * ============================================================================
 *
 * QA tested Ask Sunny live: "The overdue counts disagree. The Overview, the sidebar and the Form Monitoring banner say
 * 19 overdue. Form Monitoring's Overdue filter says 8 and Open says 6." The screens now count one queue
 * (`readFollowUpQueue`: every outstanding follow-up the reader may open, uncapped, test records left out), and the AI
 * reads the same queue through read_follow_ups (CLAUDE.md §5). This case seeds QA's shape: 19 overdue and 9 open
 * follow-ups at the manager's salon, buried under 210 newer forms with no follow-up (so the newest 200 rows, which the
 * pills used to count, hold none of them), plus one test record. Through the real chat route, the model sees 19.
 */
const REPORT = "QA, 24 Nov 2026 (Ask Sunny, live): the overdue counts disagree (19 on the Overview, 8 on the Overdue filter)";
const FLAG = "AGENT_LOOP_ENABLED";
const ASKED = "how many follow-ups are overdue?";

type Row = Record<string, unknown>;

async function seed(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.loopModel!(loopStandIn((view: LoopView) => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "coaching", employee_id: STAFF[0]!.id, what_happened: "Arrived late to open.", incident_date: "2026-11-10" } })));
  const setup = t.thread();
  await setup.say(`coaching form for ${STAFF[0]!.firstName} ${STAFF[0]!.lastName}, late to open`);
  const id = await setup.create();
  const forms = t.forms() as unknown as Row[];
  const base = forms.find((row) => row.id === id)!;
  forms.splice(forms.indexOf(base), 1);
  const add = (id: string, followUp: string | null, created: string, extra: Row = {}) =>
    forms.push({ ...base, id, status: "finalized", revises_instance_id: null, follow_up_date: followUp, followed_up_at: null, created_at: created, ...extra });
  for (let i = 0; i < 19; i += 1) add(`late-${i}`, `2026-11-${String(1 + (i % 9)).padStart(2, "0")}`, "2026-10-01T10:00:00Z");
  for (let i = 0; i < 9; i += 1) add(`open-${i}`, `2026-12-${String(1 + i).padStart(2, "0")}`, "2026-10-02T10:00:00Z");
  for (let i = 0; i < 210; i += 1) add(`newer-${i}`, null, `2026-11-${String(10 + (i % 10)).padStart(2, "0")}T10:00:00Z`);
  // A test record (a salon the business does not operate): left out, as on the Overview.
  add("test-record", "2026-11-02", "2026-10-03T10:00:00Z", { location_name: "Maple Crossing" });
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
}

export const NOV24_FOLLOW_UPS_OVERDUE_CASES: ReplayCase[] = [
  {
    id: "nov24-follow-ups-overdue-same-count-as-the-overview",
    title: `QA: "The Overview, the sidebar and the Form Monitoring banner say 19 overdue. Form Monitoring's Overdue filter says 8" — asked "${ASKED}", read_follow_ups gives the model the Overview's 19 overdue and 9 open, test record left out`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      await seed(t);
      const model = loopStandIn((view: LoopView) => (lastResult(view, "read_follow_ups") ? { text: "Here are your follow-ups." } : { tool: "read_follow_ups", input: {} }));
      t.loopModel!(model);
      await t.thread().say(ASKED);
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_follow_ups")).at(-1)?.output as
        | { counts?: Record<string, number>; test_records_not_counted?: number; refused?: string; error?: string }
        | undefined;
      expect(output?.refused, JSON.stringify(output)).toBeUndefined();
      expect(output?.error, JSON.stringify(output)).toBeUndefined();
      expect(output?.counts).toMatchObject({ overdue: 19, open: 9, outstanding: 28 });
      expect(output?.test_records_not_counted).toBe(1);
    },
  },
];
