import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A STATED ANSWER STAYS FOR THE REST OF THE REQUEST (port from Ask Bubbles #1019: its QA's round 2, 22 Nov 2026, U35)
 * ============================================================================
 *
 * The manager's words (the person invented): T2 "i have an employee, <P13> that needs a corrective action form with a
 * customer complaint", T3 "verbal warning, no payroll deduct, part-time team member," … later turns answered with no card
 * (T10 "can i review the card"), then T11 "Create a Corrective Action Form from this conversation." got "Payroll deduct
 * and warning level aren't set", and the saved draft had no payroll tick. QA's ruling (22 Nov, amending 16 Nov for
 * no-card replies): an answer stated for THIS request stays on THIS person's card for the rest of the request, across a
 * reply with no card, until a new request, another person or another form. Sunny's invented person: Remy Calder (STAFF).
 */

const FLAG = "AGENT_LOOP_ENABLED";

const REPORT = "QA's Bubbles round 2 (22 Nov 2026, U35): \"verbal warning, no payroll deduct\" was lost after replies with no card";
const T2 = "i have an employee, Remy Calder that needs a corrective action form with a customer complaint";
const T3 = "verbal warning, no payroll deduct, part-time team member,";
const T10 = "can i review the card";
const T11 = "Create a Corrective Action Form from this conversation.";

export const NOV22_AGENT_LOOP_ANSWERS_CARRY_IN_REQUEST_CASES: ReplayCase[] = [
  {
    id: "nov22-r2-u35-level-and-payroll-carry-across-no-card-reply",
    title: "U35: T3 \"verbal warning, no payroll deduct, …\", T10 \"can i review the card\" (a reply with no card), T11 \"Create a Corrective Action Form from this conversation.\": the card still has Verbal and payroll No, and Create saves both",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const said = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
        if (said === T10) return { text: "Here is the card as it stands." };
        if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
        const card = { template_key: "dpoa", employee_id: "e-2", what_happened: "A customer complained about the experience with Remy.", incident_date: "2026-11-20", policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "Remy Calder", said === T2 ? 0 : said === T3 ? 1 : 3) };
        if (said === T3) return { tool: "propose_form", input: { ...card, warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal warning"), payroll_deduct: "no", payroll_evidence: evidenceFrom(view, "no payroll deduct") } };
        return { tool: "propose_form", input: card };
      }));
      const thread = t.thread();
      await thread.say(T2);
      await thread.say(T3);
      expect(thread.proposal?.warningLevel, "T3's card has no level (the case proves nothing)").toBe("verbal");
      await thread.say(T10);
      await thread.say(T11);
      expect(thread.proposal?.warningLevel, "the level was lost after the reply with no card").toBe("verbal");
      expect((thread.proposal as { payrollDeduct?: string | null } | null)?.payrollDeduct, "the payroll answer was lost after the reply with no card").toBe("no");
      const id = await thread.create();
      expect(t.checked(id).payroll_deduct ?? [], "the saved form has no payroll answer").toEqual(["no"]);
    },
  },
];
