import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * WHAT SUNNY ASKED IS READ FROM THE SERVER'S RECORDS, NEVER FROM THE REPLY OR TURN ORDER (QA, #1055's follow-up, 20 Nov 2026)
 * ============================================================================
 *
 * Two readers on main broke the loop's rules: dates_asked_before read Sunny's own replies with a regex ("more than one
 * date|which date goes on the form"), so a paraphrased date question was asked again; and a "yes" passed as
 * yes_to_exit_offer was accepted on turn order alone (any reply before it), so a "yes" to another question made an exit
 * card. General rule: a card that asks which date records "form_date" in its asked fields; the tools' exit-form offer
 * (the exit refusals, a termination card) writes an exit_offer record; each later turn reads the record. Invented names
 * only (Remy Calder, Rowan Kestrel).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (#1055's follow-up, 20 Nov 2026): dates_asked_before read the reply text; yes_to_exit_offer was accepted by turn order";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const lastSaid = (view: LoopView) => [...view.turns].reverse().find((turn) => turn.role === "user")?.text ?? "";
const proposeOut = (views: readonly LoopView[]) => views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form").map((result) => result.output));

function setup(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
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
    setup(t);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_ASKED_FROM_RECORDS_CASES: ReplayCase[] = [
  fixed("nov20-asked-records-yes-without-exit-offer-refused", "A coaching card for Rowan Kestrel that offered nothing, a question in the reply, then \"yes\" passed as yes_to_exit_offer: refused (exit_offer_not_answered), no exit card; turn order alone is no offer", async (t) => {
    const model = loopStandIn((view): LoopDecision => {
      const card = lastResult(view, "propose_form") as { card?: unknown } | null;
      if (/^yes/i.test(lastSaid(view))) {
        if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "yes"), kind: "yes_to_exit_offer" } } };
        return { text: card.card ? "Here's the exit card." : "OK." };
      }
      if (!card) return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-4", what_happened: "Rowan Kestrel skipped the closing checklist." } };
      return { text: "Here's the Coaching Form for **Rowan**. Want me to add a follow-up date?" };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("coaching for rowan kestrel, she skipped the closing checklist");
    await thread.say("yes");
    const out = proposeOut(model.views).at(-1) as { reason_code?: string; evidence?: string };
    expect(out.reason_code, JSON.stringify(out)).toBe("exit_not_stated");
    expect(out.evidence).toBe("exit_offer_not_answered");
    expect(thread.proposal?.templateKey, "a yes to another question made an exit card").not.toBe("stc-exit");
  }),
  fixed("nov20-asked-records-yes-to-paraphrased-exit-offer-kept", "Control: \"ugh rowan quit yesterday\" (resignation told, the tools offer the exit form), the reply paraphrases the offer, then \"yes\": the exit card is made from the record", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const card = lastResult(view, "propose_form") as { card?: unknown; ask_exactly?: string } | null;
      if (/^yes/i.test(lastSaid(view))) {
        if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "yes"), kind: "yes_to_exit_offer" } } };
        return { text: "Here's the exit card." };
      }
      if (!card) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-4", exit_type: "resignation", exit_evidence: { ...evidenceFrom(view, "rowan quit yesterday"), kind: "resignation_told" } } };
      return { text: "Sorry to hear that. Should I start her exit paperwork?" };
    }));
    const thread = t.thread();
    await thread.say("ugh rowan quit yesterday, short staffed again");
    await thread.say("yes");
    expect(thread.proposal?.templateKey, "the yes to the recorded offer made no exit card").toBe("stc-exit");
  }),
  fixed("nov20-asked-records-dates-asked-paraphrased", "\"ca for remy calder, late on 11/10 and 11/12\": the card asks which date in its own words (\"Which day should the form carry?\"); the next turn's card gets dates_asked_before from the record, never asked again", async (t) => {
    const model = loopStandIn((view): LoopDecision => {
      const card = lastResult(view, "propose_form");
      if (card) return { text: "Here's the Corrective Action Form for **Remy**. Which day should the form carry, 11/10 or 11/12?" };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: /checklist/.test(lastSaid(view)) ? "Remy Calder was late on 11/10 and 11/12. She also skipped the checklist." : "Remy Calder was late on 11/10 and 11/12." } };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("ca for remy calder, late on 11/10 and 11/12");
    await thread.say("she also skipped the checklist");
    const out = proposeOut(model.views).at(-1) as { facts?: { dates_asked_before?: boolean; dates_given?: string[] } };
    expect(out.facts?.dates_given?.length, JSON.stringify(out.facts)).toBe(2);
    expect(out.facts?.dates_asked_before, "the paraphrased date question was not known as asked").toBe(true);
  }),
];
