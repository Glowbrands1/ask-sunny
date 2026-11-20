import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE EXIT CARD FILLS THE EXIT FORM'S OWN FIELDS (QA item 17, 20 Nov 2026; the production audit's real exit form)
 * ============================================================================
 *
 * "create exit for <P>. payroll deduct no apply" → "involuntary immediate term" → the reason: the card and Create drafted
 * only Additional Details and payroll; the manager hand-filled 13 fields (the termination type, the reason, last day
 * worked, …) and the termination story landed in "resignation method". General rule: what the manager states for the
 * exit form's own fields goes in those fields (the type: involuntary / voluntary; the reason; last day worked; eligible
 * for rehire when said), never a termination's story in the resignation method. Invented name: Rowan Kestrel.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 17, the production audit's exit form: the card arrived nearly empty and the manager hand-filled 13 fields";
const T1 = "create exit for Rowan Kestrel. payroll deduct no apply";
const T2 = "involuntary immediate term";
const T3 = "she walked out in the middle of her shift on 11/18 after arguing with a guest. last day worked 11/18. not eligible for rehire";

const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user");

/** The live model: the exit card each turn, a termination from T2 on, with the account the manager gave. */
const exitModel = () => loopStandIn((view): LoopDecision => {
  if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form for **Rowan Kestrel**." };
  const n = userTurns(view).length;
  return {
    tool: "propose_form",
    input: {
      template_key: "stc-exit", employee_id: "e-4",
      exit_evidence: { ...evidenceFrom(view, "create exit for Rowan Kestrel", n - 1), kind: "asks_for_exit_form" },
      exit_type: n >= 2 ? "termination" : "resignation",
      payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "payroll deduct no apply", n - 1),
      ...(n >= 3 ? { what_happened: "Walked out in the middle of her shift on 11/18 after arguing with a guest.", effective_date: "11/18" } : {}),
      ...(n >= 2 ? { request_evidence: Array.from({ length: n - 1 }, (_unused, back) => evidenceFrom(view, undefined, back + 1)) } : {}),
    },
  };
});

export const NOV20_AGENT_LOOP_EXIT_CARD_FIELDS_CASES: ReplayCase[] = [
  {
    id: "nov20-exit-card-fields-involuntary-term-with-reason",
    title: "Audit shape: \"create exit for <P>. payroll deduct no apply\" → \"involuntary immediate term\" → the reason, last day and rehire: Create fills the involuntary type, last day worked, the reason, rehire No and payroll No; the story is never the resignation method",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of [T1, T2, T3]) {
        t.loopModel!(exitModel());
        await thread.say(turn);
      }
      expect(thread.proposal?.templateKey).toBe("stc-exit");
      const id = await thread.create();
      const values = t.values(id);
      const checked = t.checked(id);
      const saved = JSON.stringify({ values, checked });
      expect(checked.resignation_type ?? [], `the termination type is not ticked:\n${saved}`).toContain("immediate_involuntary_separation");
      expect(values.last_day_worked ?? "", `last day worked is empty:\n${saved}`).toMatch(/11\/18|2026-11-18/);
      expect(checked.eligible_for_rehire ?? [], `rehire is not No:\n${saved}`).toEqual(["no"]);
      expect(checked.payroll_deduction_applicable ?? [], `payroll is not the manager's No ("payroll deduct no apply"):\n${saved}`).toEqual(["no"]);
      expect(values.resignation_reason ?? "", `the reason is empty:\n${saved}`).toMatch(/walked out|arguing/i);
      expect(values.resignation_method ?? "", `the story is in the resignation method:\n${saved}`).not.toMatch(/walked out|arguing|involuntary|term/i);
    },
  },
  {
    id: "nov20-exit-card-fields-asks-last-day",
    title: "An exit card with no last day worked said (\"create exit for <P>, she gave notice\") asks for it (exit_unset), as the CA asks its level; with the last day said, it does not",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      for (const [said, asks] of [["create exit for Rowan Kestrel, she gave notice", true], ["create exit for Rowan Kestrel, she gave notice, last day worked 11/18", false]] as const) {
        const model = loopStandIn((view): LoopDecision => {
          if (lastResult(view, "propose_form")) return { text: "Here's the card." };
          return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "create exit for Rowan Kestrel"), kind: "asks_for_exit_form" } } };
        });
        t.loopModel!(model);
        await t.thread().say(said);
        const result = JSON.stringify(lastResult(model.views.at(-1)!, "propose_form"));
        if (asks) expect(result, `no ask for the last day:\n${result}`).toMatch(/"exit_unset":\["last_day_worked"\]/);
        else expect(result).not.toMatch(/exit_unset/);
      }
    },
  },
];
