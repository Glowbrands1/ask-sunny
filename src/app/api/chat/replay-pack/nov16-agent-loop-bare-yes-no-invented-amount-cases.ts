import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A BARE "YES" TO A TWO-QUESTION CARD INVENTS NO PAYROLL AMOUNT (QA's pre-launch live re-test, main 63ba4c48, E r2)
 * ============================================================================
 *
 * T1 a Coaching card; T2 "edit <name> ca" built a Corrective Action whose card asked payroll AND level (card.asked =
 * [payroll_deduct, warning_level]); T3 the manager typed "yes". The chat never mentioned payroll or any amount, yet the
 * model's reply said payroll $20 (the rules book's own example, "yes payroll, $20"), and the self-review fallback echoed
 * it: "That change isn't on the card yet: payroll amount ($20). Tell me again and I'll update the card."
 * General rules (QA): (1) the rules book and tool descriptions give a placeholder amount ("$<amount>"), never a figure;
 * (2) the self-review never echoes a value the manager did not type in this chat; it asks the field's question instead;
 * (3) a one-word answer quoted whole while the card asks two things answers neither (payroll and level both refused) and
 * the reply asks which it answers and, for payroll, the amount. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's pre-launch live re-test (16 Nov 2026, main 63ba4c48, E r2): a bare \"yes\" to a card asking payroll and level got a reply claiming payroll $20";
const UNSET_BOTH = "Payroll deduct and warning level aren't set; tell me if they apply.";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type CardOut = {
  reason_code?: string;
  payroll_evidence?: string;
  level_evidence?: string;
  facts?: { unset?: string[]; payroll_answer_unclear?: { ask_exactly: string } };
  card?: { form?: string; payroll_deduct?: unknown; payroll_amount?: unknown; warning_level?: unknown };
};
const proposeOutputs = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => result.output as CardOut);
const lastSaid = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/**
 * The live model's three turns: a Coaching card; "edit remy calder ca" makes the Corrective Action card (asks both); a bare
 * "yes" is passed whole as the payroll AND level evidence with an amount nobody typed, and the reply claims that amount
 * whatever the tool said (`claimsAmount`), as the live reply did.
 */
function liveModel(claimsAmount: boolean) {
  return loopStandIn((view): LoopDecision => {
    const said = lastSaid(view);
    const card = lastResult(view, "propose_form") as CardOut | null;
    const base = { employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" };
    if (/^coaching/i.test(said)) return card ? { text: "Here's the Coaching Form for **Remy Calder**." } : { tool: "propose_form", input: { template_key: "coaching", ...base } };
    // Changed on purpose (QA item 7, 20 Nov 2026, the form lock): a different form for the card's person needs this turn's words asking for it (form_change_evidence).
    if (/^edit/i.test(said)) return card ? { text: `Here's the Corrective Action Form for **Remy Calder**.${card.facts?.unset?.length === 2 ? ` ${UNSET_BOTH}` : ""}` } : { tool: "propose_form", input: { template_key: "dpoa", ...base, form_change_evidence: evidenceFrom(view, "edit remy calder ca") } };
    if (!card) {
      return {
        tool: "propose_form",
        input: { template_key: "dpoa", ...base, payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view, said), warning_level: "verbal", level_evidence: evidenceFrom(view, said) },
      };
    }
    if (claimsAmount) return { text: "Updated the Corrective Action Form for **Remy Calder**.\n\n**Is payroll deduct applicable?** Yes, as you said.\n**Payroll deduction amount:** $20" };
    return { text: `Here's the Corrective Action Form for **Remy Calder**. ${card.facts?.payroll_answer_unclear?.ask_exactly ?? ""}`.trim() };
  });
}

async function threeTurns(t: ReplayContext, claimsAmount: boolean) {
  start(t);
  const model = liveModel(claimsAmount);
  t.loopModel!(model);
  const thread = t.thread();
  await thread.say("coaching for remy calder, late on 11/12");
  const ca = await thread.say("edit remy calder ca");
  expect(ca.content, "the Corrective Action card did not ask both (the case proves nothing)").toContain(UNSET_BOTH);
  const reply = await thread.say("yes");
  return { model, thread, reply };
}

export const NOV16_AGENT_LOOP_BARE_YES_NO_INVENTED_AMOUNT_CASES: ReplayCase[] = [
  {
    id: "nov16-bare-yes-two-questions-sets-neither-asks-which-and-amount",
    title: "E r2: Coaching card, then \"edit remy calder ca\" (the card asks payroll and level), then \"yes\" passed whole as payroll and level evidence with an amount nobody typed: nothing is set (payroll, amount and level), and the reply asks which it answers and, for payroll, how much",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const { model, thread, reply } = await threeTurns(t, false);
      const out = proposeOutputs(model.views).at(-1)!;
      expect(out.card?.payroll_deduct ?? null, `a bare "yes" to two questions set payroll:\n${JSON.stringify(out)}`).toBeNull();
      expect(out.card?.payroll_amount ?? null, "an amount nobody typed reached the card").toBeNull();
      expect(out.card?.warning_level ?? null, `a bare "yes" to two questions set the level:\n${JSON.stringify(out)}`).toBeNull();
      expect(out.level_evidence, JSON.stringify(out)).toBe("answer_to_two_questions");
      expect(out.payroll_evidence, JSON.stringify(out)).toBe("answer_to_two_questions");
      expect(reply.content, "the reply does not ask which the answer is for").toMatch(/payroll deduct, the warning level, or both\?/);
      expect(reply.content, "the reply does not ask the amount").toMatch(/how much\?/);
      expect(reply.content).not.toMatch(/\$\s*20\b/);
      expect((thread.proposal as { payrollDeduct?: string | null } | undefined)?.payrollDeduct ?? null).toBeNull();
    },
  },
  {
    id: "nov16-bare-yes-self-review-never-echoes-an-untyped-amount",
    title: "E r2: the same three turns, and the model's reply claims \"Payroll deduction amount: $20\" (twice): the final reply never says $20 (nobody typed it) and asks \"Is payroll deduct applicable, and how much?\" instead of \"Tell me again\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const { reply } = await threeTurns(t, true);
      expect(reply.content, `the reply echoed an amount the manager never typed:\n${reply.content}`).not.toMatch(/\$\s*20\b|\b20\b/);
      expect(reply.content).not.toMatch(/Tell me again/);
      expect(reply.content).toContain("Is payroll deduct applicable, and how much?");
    },
  },
  {
    id: "nov16-bare-yes-control-typed-amount-still-offered",
    title: "E r2 control: an amount the manager DID type (\"payroll deduct $15\") that the reply claims but the card lacks is still offered back (\"That change isn't on the card yet: payroll amount ($15). Tell me again …\")",
    report: `${REPORT}; a typed value is still said back`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      start(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as CardOut | null;
        const base = { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 11/12.", incident_date: "2026-11-12" };
        if (/^ca for/i.test(lastSaid(view))) return card ? { text: "Here's the Corrective Action Form for **Remy Calder**." } : { tool: "propose_form", input: base };
        // The model claims the typed amount without proposing the card again.
        return { text: "Updated.\n\n**Payroll deduction amount:** $15" };
      }));
      const thread = t.thread();
      await thread.say("ca for remy calder, late on 11/12");
      const reply = await thread.say("payroll deduct $15");
      expect(reply.content).toContain("That change isn't on the card yet: payroll amount ($15). Tell me again and I'll update the card.");
    },
  },
];
