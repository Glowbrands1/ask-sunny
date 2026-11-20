import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A LOOP CARD'S SAVED PAYROLL IS THE CARD'S OWN (QA's code audit on d7960a5f, 20 Nov 2026; item 20)
 * ============================================================================
 *
 * On the real Create path (createInlineForm → POST /api/forms/instances → POST …/draft). Names invented.
 * (a) QA's shape: Ava's card says $20, a later card for Ben says $45, Create on Ava's card saved $45, because
 *     `instances/route.ts` re-read the whole chat with `payrollAmountFromConversation` (the latest amount wins). On
 *     d7960a5f Create on the older card is refused ("This proposal is out of date"), so the case keeps Remy's card the
 *     newest and states an older $45 in a later turn that makes no card: the same reader, the same failure.
 * (b) The loop asks for the amount and the manager answers "25". The card shows $25, but the bare-figure reader counts
 *     only an answer to the app's own PAYROLL_AMOUNT_QUESTION, and the card's draft line "Payroll deduct amount: $25"
 *     matches no pattern, so the saved amount was blank.
 * Rule: for a loop card, the saved payroll Yes/No and amount are the card's own values.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's code audit (20 Nov 2026): a loop card's saved payroll amount did not follow the card";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

const card = (view: LoopView, name: string, late: string, amount: string | null) => ({
  tool: "propose_form" as const,
  input: {
    template_key: "dpoa",
    employee_name: name,
    person_evidence: evidenceFrom(view, name),
    what_happened: `${name.split(" ")[0]} was 20 minutes late to the shift on ${late}.`,
    policy: "Attendance",
    warning_level: "written",
    level_evidence: evidenceFrom(view, "written CA"),
    payroll_deduct: "yes",
    payroll_evidence: evidenceFrom(view, "payroll deduct"),
    ...(amount ? { payroll_amount: amount } : {}),
  },
});

export const NOV20_LOOP_CARD_PAYROLL_CASES: ReplayCase[] = [
  fixed("nov20-loop-card-payroll-own-amount", "(a) Remy's card says $20, then a later turn states an older $45 deduction (no card): Create on Remy's card saves $20, not the chat's latest $45", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (users(view) === 2) return { text: "I don't see that October deduction on file." };
      return lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Remy**." } : card(view, "Remy Calder", "11/14", "20");
    }));
    t.draftWrites({ observation: "Observed:\nRemy was 20 minutes late to the shift on November 14, 2026." });
    const thread = t.thread();
    await thread.say("written CA for Remy Calder, she was 20 minutes late on 11/14, payroll deduct $20");
    await thread.say("she also had a payroll deduct of $45 back in October, is that on file?");
    const id = await thread.createCard!("Remy Calder");
    expect(t.checked(id).payroll_deduct ?? []).toEqual(["yes"]);
    expect(t.values(id).payroll_deduct_amount ?? "", "the saved amount is not Remy's card's").toMatch(/^\$20(?:\.00)?$/);
  }),
  fixed("nov20-loop-card-payroll-bare-answer", "(b) The loop asks for the amount and the manager answers \"25\": the card shows $25 and Create saves $25", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (lastResult(view, "propose_form")) return { text: users(view) === 1 ? "Here's the card. How much is the payroll deduction?" : "Updated the card: payroll deduction $25." };
      return users(view) === 1 ? card(view, "Remy Calder", "11/14", null) : { ...card(view, "Remy Calder", "11/14", "25"), input: { ...card(view, "Remy Calder", "11/14", "25").input, person_evidence: evidenceFrom(view, "written CA for Remy Calder", 1), level_evidence: evidenceFrom(view, "written CA", 1), payroll_evidence: evidenceFrom(view, "payroll deduct yes", 1) } };
    }));
    t.draftWrites({ observation: "Observed:\nRemy was 20 minutes late to the shift on November 14, 2026." });
    const thread = t.thread();
    await thread.say("written CA for Remy Calder, she was 20 minutes late on 11/14, payroll deduct yes");
    await thread.say("25");
    expect((thread.proposal as { payrollDeductAmount?: string } | null)?.payrollDeductAmount ?? "", "the card does not carry $25 (the case proves nothing)").toMatch(/25/);
    const id = await thread.create();
    expect(t.values(id).payroll_deduct_amount ?? "", "the saved amount is not the card's $25").toMatch(/^\$25(?:\.00)?$/);
  }),
];
