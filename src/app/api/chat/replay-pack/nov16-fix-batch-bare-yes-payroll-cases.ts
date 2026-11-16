import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIX BATCH ITEM 7: A BARE "YES" IS NO PAYROLL ANSWER TO TWO QUESTIONS (QA's targeted re-run, c163, 16 Nov 2026)
 * ============================================================================
 *
 * The card's reply said "Payroll deduct and warning level aren't set; tell me if they apply." The manager answered "yes",
 * the model passed that whole message as payroll_evidence, and payroll was set to yes. One word answering two questions
 * says neither. The card record now keeps what the card asked (`asked`); a one-word message quoted whole as the payroll
 * answer to the two-part line sets nothing, and the reply asks payroll alone. Code never reads the words.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's targeted re-run (16 Nov 2026), fix batch item 7, c163: a bare \"yes\" after \"Payroll deduct and warning level aren't set\" set payroll";
const UNSET_BOTH = "Payroll deduct and warning level aren't set; tell me if they apply.";
const ASK = "Is payroll deduct applicable for **Remy Calder**? Yes or no.";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

type CardOut = { reason_code?: string; payroll_evidence?: string; facts?: { unset?: string[]; payroll_answer_unclear?: { ask_exactly: string } }; card?: { payroll_deduct?: unknown } };
const proposeOutputs = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output as CardOut);
const lastSaid = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";

/** The live model's turns: the card, then any answer passed whole as payroll_evidence with payroll_deduct "yes". */
function liveModel() {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    const card = lastResult(view, "propose_form") as CardOut | null;
    if (!card) {
      const answer = /^ca for/i.test(said) ? {} : { payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, said) };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12", ...answer } };
    }
    if (card.facts?.payroll_answer_unclear) return { text: `Here's the Corrective Action Form for **Remy Calder**. ${card.facts.payroll_answer_unclear.ask_exactly}` };
    return { text: `Here's the Corrective Action Form for **Remy Calder**.${card.facts?.unset?.length === 2 ? ` ${UNSET_BOTH}` : ""}` };
  });
}

export const NOV16_FIX_BATCH_BARE_YES_PAYROLL_CASES: ReplayCase[] = [
  {
    id: "nov16-fix-batch-7-bare-yes-after-unset-both-sets-no-payroll-c163",
    title: "Fix batch item 7 (c163): after \"Payroll deduct and warning level aren't set; tell me if they apply.\", a bare \"yes\" passed whole as payroll_evidence sets no payroll (payroll_not_stated, answer_to_two_questions) and the reply asks \"Is payroll deduct applicable for **Remy Calder**? Yes or no.\"; the \"yes\" to that question sets it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const model = liveModel();
      t.loopModel!(model);
      const thread = t.thread();
      const card = await thread.say("ca for remy calder, late on 11/12");
      expect(card.content, "the first card did not ask both").toContain(UNSET_BOTH);
      const reply = await thread.say("yes");
      const out = proposeOutputs(model.views).at(-1)!;
      expect(out.card?.payroll_deduct ?? null, `a bare "yes" to two questions set payroll:\n${JSON.stringify(out)}`).toBeNull();
      expect(out.reason_code).toBe("payroll_not_stated");
      expect(out.payroll_evidence).toBe("answer_to_two_questions");
      expect(reply.content, "the reply does not ask payroll alone").toContain(ASK);
      await thread.say("yes");
      const answered = proposeOutputs(model.views).at(-1)!;
      expect(answered.reason_code, JSON.stringify(answered)).toBeUndefined();
      expect(answered.card?.payroll_deduct, "the yes to the payroll question alone was not kept").toBe("yes");
    },
  },
  {
    id: "nov16-fix-batch-7-an-answer-that-says-which-is-kept",
    title: "Fix batch item 7 control: after the same two-part line, \"yes payroll deduct\" (it says which) is kept, as before",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      const model = liveModel();
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      await thread.say("yes payroll deduct");
      const out = proposeOutputs(model.views).at(-1)!;
      expect(out.reason_code, JSON.stringify(out)).toBeUndefined();
      expect(out.card?.payroll_deduct).toBe("yes");
    },
  },
];
