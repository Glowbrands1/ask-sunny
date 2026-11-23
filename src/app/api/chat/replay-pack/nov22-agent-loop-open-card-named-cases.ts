import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * WITH A CARD ON SCREEN, THE MODEL IS TOLD WHICH CARD IT IS (the 266-chat run's 011, QA's step 3 item 15, 22 Nov 2026)
 * ============================================================================
 *
 * The manager's turns, word for word (the people invented, the pack's roster): "Make me A CA form for <P> for staying
 * over her scheduled shift to do extracleaning. ASD <Q> spoke to <P> on November 9 going over the policy for this. <P>
 * Stsyed late again on 11/11.", then "it should be the policy for staying past shceduled shift". The second reply ended
 * "Which form do you want it on, and who is it for?" with the Corrective Action card on screen.
 *
 * Mechanism: the system block's open-card line said only "A card is open". It now names the card's form (its card
 * record's template name, never the person's name, which the record does not hold) and says a message naming no other
 * form or person is about that card, so the model never asks which form or who. A prompt line: the stand-in cannot show
 * the model's choice, so the case checks what the model is shown; QA's live batch checks the reply.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The 266-chat run (case 011), re-checked on main 7787aa9: with the CA card on screen, \"it should be the policy for staying past shceduled shift\" got \"Which form do you want it on, and who is it for?\"";
const T1 = "Make me A CA form for Remy Calder for staying over her scheduled shift to do extracleaning. ASD Juno Paxton spoke to Remy Calder on November 9 going over the policy for this. Remy Calder Stsyed late again on 11/11.";
const T2 = "it should be the policy for staying past shceduled shift";

export const NOV22_AGENT_LOOP_OPEN_CARD_NAMED_CASES: ReplayCase[] = [
  {
    id: "nov22-f038-011-open-card-named-in-prompt",
    title: "011: \"it should be the policy for staying past shceduled shift\" with the CA card on screen: the model is told the Corrective Action Form card is open and the message is about it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("assistant_salon_director", KEARNEY);
      const model = loopStandIn((view): LoopDecision => {
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
        if (view.turns.filter((turn) => turn.role === "user").length > 1) return { text: "Which policy do you want on the card?" };
        return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: "Remy Calder stayed over the scheduled shift to do extra cleaning. Remy Calder stayed late again on 11/11." } };
      });
      t.loopModel!(model);
      const thread = t.thread();
      await thread.say(T1);
      expect(thread.proposal?.templateKey, "no CA card on screen (the case proves nothing)").toBe("dpoa");
      await thread.say(T2);
      const shown = model.views.at(-1)!.system;
      expect(shown, `the model is not told the card is open:\n${shown.slice(0, 600)}`).toMatch(/A card is open/);
      expect(shown, "the model is not told WHICH card is open").toMatch(/A card is open: your last reply showed the Corrective Action Form card/);
      expect(shown, "the model is not told the message is about that card").toMatch(/never ask which form it is for or who it is for/);
    },
  },
];
