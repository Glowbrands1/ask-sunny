import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE SALON THE MANAGER NAMED LEAVES THE ACCOUNT WHOLE, STATE AND ALL (port from Ask Bubbles #1027, R13)
 * ============================================================================
 *
 * The manager's turn, word for word (QA's test name, on no directory), with Sunny's salon and a salon's account in place
 * of the sibling app's store and its work: "create a verbal CA for team member Testy Testerson at <store>, NE. location.
 * On 10-16-26 Testy was not properly … payroll deduct is not applicable". The card's Observation read "NE on 10/16/26 …":
 * the phrase "At <store>" left the account (QA item 20, `withoutNamedSalon`) but its state ", NE" stayed.
 *
 * Mechanism (`withoutNamedSalon`): a salon phrase followed by ", <word>" where the word is part of that salon's own name
 * (its state, "NE") is that salon's phrase too, and leaves the account with it.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from Ask Bubbles (#1027; its QA's round 2, R13): the Observation read \"NE on 10/16/26 …\", a fragment of \"at <store>, NE\"";
const T1 = "create a verbal CA for team member Testy Testerson at Kearney, NE. location. On 10-16-26 Testy did not sanitize the tanning beds between guests. payroll deduct is not applicable";
const T2 = "employee name is Testy Testerson";
const LIVE_ACCOUNT = "At Kearney, NE on 10/16/26 Testy did not sanitize the tanning beds between guests.";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const said = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
const issueOf = (proposal: unknown) => (proposal as { issue?: string | null } | null)?.issue ?? "";

const live = () =>
  loopStandIn((view): LoopDecision => {
    if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Testy**." };
    return {
      tool: "propose_form",
      input: {
        template_key: "dpoa",
        employee_name: "Testy Testerson",
        what_happened: LIVE_ACCOUNT,
        incident_date: "2026-10-16",
        warning_level: "verbal",
        level_evidence: evidenceFrom(view, "create a verbal CA", said(view) === T1 ? 0 : 1),
        payroll_deduct: "no",
        payroll_evidence: evidenceFrom(view, "payroll deduct is not applicable", said(view) === T1 ? 0 : 1),
        policy: headingWith(view, /standards of conduct/i),
        person_evidence: evidenceFrom(view, "Testy Testerson"),
      },
    };
  });

export const NOV22_AGENT_LOOP_PLACE_FRAGMENT_CASES: ReplayCase[] = [
  {
    id: "nov22-r13-salon-with-state-leaves-account-whole",
    title: "R13: \"… Testy Testerson at Kearney, NE. location. On 10-16-26 Testy did not sanitize …\": the Observation is \"On 10/16/26 Testy did not sanitize the tanning beds between guests.\", never \"NE on …\" or \"At Kearney, NE on …\"",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = t.thread();
      t.loopModel!(live());
      await thread.say(T1);
      expect(thread.proposal?.locationId, "the case proves nothing: the card is not filed at the salon the manager named").toBe("loc-0309");
      expect(issueOf(thread.proposal), "a fragment of the salon phrase stayed in the Observation").not.toMatch(/\bNE\b|Kearney/);
      expect(issueOf(thread.proposal)).toMatch(/^On 10\/16\/26 Testy did not sanitize the tanning beds between guests\.$/);
      await thread.say(T2);
      expect(issueOf(thread.proposal), "T2's card brought the salon phrase back").not.toMatch(/\bNE\b|Kearney/);
    },
  },
];
