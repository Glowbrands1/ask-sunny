import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * FIX BATCH ITEM 1: AN EXIT CARD NOBODY ASKED FOR (QA's live re-test, 16 Nov 2026)
 * ============================================================================
 *
 * "ugh <D> quit yesterday, short staffed again" built an Employee Exit Form card. The exit_evidence quote was real
 * ("quit yesterday"), so the evidence check passed, but a resignation told in passing is not an ask. The model now says
 * what its quote is (exit_evidence.kind); a resignation told with no ask makes no card and gets the offer, and the card
 * is made on the manager's yes. Code checks the kind and where the quote sits, never what the words mean.
 * Invented names only (Rowan Kestrel).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live re-test (16 Nov 2026), fix batch item 1: \"ugh <D> quit yesterday, short staffed again\" built an exit card nobody asked for";
const SAID = "ugh Rowan quit yesterday, short staffed again";
const OFFER = "Want the Resignation/Exit Form for **Rowan Kestrel**?";

function setup(t: ReplayContext): void {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const lastSaid = (view: LoopView): string => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";

/** The live model's first turn: Rowan looked up, then an exit card on "quit yesterday" told as a resignation. */
function exitModel(kind: string | null) {
  return loopStandIn((view): LoopDecision => {
    if (/^yes/i.test(lastSaid(view))) {
      const card = lastResult(view, "propose_form") as { exit_not_stated?: boolean } | null;
      if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "yes"), kind: "yes_to_exit_offer" } } };
      return { text: card.exit_not_stated ? "No exit asked." : "Here's the Employee Exit Form for **Rowan Kestrel**." };
    }
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Rowan", person_evidence: evidenceFrom(view, "Rowan") } };
    const card = lastResult(view, "propose_form") as { ask_exactly?: string } | null;
    if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "Rowan quit yesterday"), ...(kind ? { kind } : {}) } } };
    return { text: card.ask_exactly ? `Sorry you're short staffed. ${card.ask_exactly}` : "Here's the Employee Exit Form for **Rowan Kestrel**." };
  });
}

export const NOV16_FIX_BATCH_EXIT_ASKED_CASES: ReplayCase[] = [
  {
    id: "nov16-fix-batch-1-a-resignation-told-in-passing-is-no-exit-card",
    title: "Fix batch item 1: \"ugh Rowan quit yesterday, short staffed again\" makes no exit card; the reply ends with \"Want the Resignation/Exit Form for **Rowan Kestrel**?\" (exit_evidence kind resignation_told, exit_not_asked); \"yes\" makes the card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setup(t);
      t.loopModel!(exitModel("resignation_told"));
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal, `an exit card was built from a resignation told in passing:\n${reply.content}`).toBeFalsy();
      expect(reply.content, "the reply does not offer the exit form").toContain(OFFER);
      await thread.say("yes");
      expect(thread.proposal?.templateKey, "the manager's yes to the offer made no exit card").toBe("stc-exit");
      expect(thread.proposal?.employeeName).toBe("Rowan Kestrel");
    },
  },
  {
    id: "nov16-fix-batch-1-exit-evidence-without-its-kind-makes-no-card",
    title: "Fix batch item 1: the same message with exit_evidence quoting \"Rowan quit yesterday\" and no kind (the live model's call) is refused (exit_not_stated, exit_kind_missing): no card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setup(t);
      const model = exitModel(null);
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal, `an exit card was built on exit_evidence with no kind:\n${reply.content}`).toBeFalsy();
      const result = model.views.at(-1)?.results.find((entry) => entry.tool === "propose_form")?.output as { reason_code?: string; evidence?: string } | undefined;
      expect(result?.reason_code).toBe("exit_not_stated");
      expect(result?.evidence).toBe("exit_kind_missing");
    },
  },
  {
    id: "nov16-fix-batch-1-a-yes-to-the-offer-is-this-message",
    title: "Fix batch item 1: kind yes_to_exit_offer quoting an earlier message (not a yes right after the app's reply) is refused (exit_offer_not_answered); an ask (\"exit form for rowan kestrel, she quit yesterday\") still makes the card at once",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      setup(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Rowan" } };
        const card = lastResult(view, "propose_form") as { evidence?: string } | null;
        if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "Rowan quit yesterday", 1), kind: "yes_to_exit_offer" } } };
        return { text: card.evidence ?? "carded" };
      }));
      const thread = t.thread();
      await thread.say(SAID);
      const reply = await thread.say("she was a good one too");
      expect(thread.proposal, "an earlier message was taken as a yes to an offer").toBeFalsy();
      expect(reply.content).toBe("exit_offer_not_answered");

      t.loopModel!(loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "Rowan Kestrel" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "exit form for rowan kestrel"), kind: "asks_for_exit_form" } } };
        return { text: "Here's the Employee Exit Form for **Rowan Kestrel**." };
      }));
      const asked = t.thread();
      await asked.say("exit form for rowan kestrel, she quit yesterday");
      expect(asked.proposal?.templateKey, "an exit the manager asked for made no card").toBe("stc-exit");
    },
  },
];
