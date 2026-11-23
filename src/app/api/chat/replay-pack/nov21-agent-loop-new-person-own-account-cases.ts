import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * "THE SAME FOR <B>, <ACCOUNT ON A DATE>" IS A NEW REQUEST, EVEN WITHOUT new_form_evidence (QA2, 21 Nov 2026; #1199)
 * ============================================================================
 *
 * With CARD_PERSON_THIS_REQUEST on, a card for another person while one is open needs new_form_evidence. The live model
 * passes it for "do the same … for <B>" (QA2's live check, 14:05Z), and this is belt-and-braces: a manager message that
 * names a roster person other than the open card's, does not name the open card's person, and states its own date is
 * that person's own request, by the records (the roster and the message's dates), never a word list. A person named
 * inside an account about the open card's person ("Salon Director, <B>, messaged <A> …") still names <A>, so it is not.
 * Invented people: Remy Calder (<A>), Juno Paxton (<B>).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEW_FLAG = "CARD_PERSON_THIS_REQUEST_ENABLED";
const LIVE = process.env.AGENT_LOOP_LIVE === "1";
const REPORT = "QA2 (21 Nov 2026), #1199: \"the same for juno paxton, she was late on 11/10/26\" refused without new_form_evidence";

/* The rule is CARD_PERSON_THIS_REQUEST's: with it off no card for another person is refused, so there is nothing to show. */
const cardPersonOn = () => process.env[NEW_FLAG] === "true";

function setup(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const card = (employeeId: string, account: string) => ({ tool: "propose_form" as const, input: { template_key: "dpoa", employee_id: employeeId, policy: "Attendance", what_happened: account, warning_level: "verbal" } });

export const NOV21_AGENT_LOOP_NEW_PERSON_OWN_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov21-new-person-own-dated-account-is-a-new-request",
    title: "\"verbal ca for remy calder, …\" then \"the same for juno paxton, she was late on 11/10/26\" with no new_form_evidence: Juno's card is made",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEW_FLAG],
    async run(t) {
      if (!t.loopOn?.() || !cardPersonOn()) return;
      setup(t);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here is the card." } : card("e-2", "Late on 11/9/26."))));
      const thread = t.thread();
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      // Juno's card states no level of its own: this case is about whose card it is, not the level.
      const second = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here is the second card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", policy: "Attendance", what_happened: "Late on 11/10/26." } }));
      t.loopModel!(second);
      await thread.say("the same for juno paxton, she was late on 11/10/26");
      const result = lastResult(second.views.at(-1)!, "propose_form") as { reason_code?: string } | null;
      expect(result?.reason_code, `Juno's card was refused:\n${JSON.stringify(result).slice(0, 600)}`).toBeUndefined();
      expect((thread.proposal as { employeeName?: string } | undefined)?.employeeName).toBe("Juno Paxton");
    },
  },
  {
    id: "nov21-new-person-inside-account-about-open-person-still-refused",
    title: "Control: Remy's card open, then \"On 11/14/26 Salon Director, Juno Paxton, messaged Remy Calder asking …\" (names Remy too): a card for Juno is still refused",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEW_FLAG],
    async run(t) {
      if (!t.loopOn?.() || !cardPersonOn()) return;
      setup(t);
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here is the card." } : card("e-2", "Late on 11/9/26."))));
      const thread = t.thread();
      await thread.say("verbal ca for remy calder, she was 20 minutes late on 11/9/26");
      const second = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Kept Remy's card." } : { ...card("e-3", "Juno messaged Remy."), input: { ...card("e-3", "Juno messaged Remy.").input, person_evidence: evidenceFrom(view, "Juno Paxton") } }));
      t.loopModel!(second);
      const reply = await thread.say("On 11/14/26 Salon Director, Juno Paxton, messaged Remy Calder asking if she forgot to clock in on 11/13/26");
      // QA's live run (22 Nov 2026): the real model never proposed a card for Juno (it added the message to Remy's
      // account), so there was no refusal to read. What the manager sees: Remy's card stays, no card for Juno. The refusal
      // is asserted whenever a card for Juno was proposed (the stand-in always proposes one).
      expect((thread.proposal as { employeeName?: string } | undefined)?.employeeName, `the open card is no longer Remy's:\n${reply.content}`).toBe("Remy Calder");
      expect(reply.formProposal?.employeeName ?? null, "a card for Juno was shown").not.toBe("Juno Paxton");
      const result = lastResult(second.views.at(-1)!, "propose_form") as { reason_code?: string } | null;
      if (!LIVE || result !== null) expect(result?.reason_code).toBe("person_change_not_asked");
    },
  },
];
