import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE POLICY THE CARD CITED IS KEPT ACROSS TURNS (the sibling app's
 * production, 2 Nov 2026, R6/R7; run here in this app's setting)
 * ============================================================================
 *
 * The manager asked for a Corrective Action "with a customer complaint"; the
 * card cited "Standards of Conduct, from what you described ("customer
 * complaint") — the policy manual's section on page 12" (R7, after the warning
 * level, payroll and position turn). Several turns later, after corrections
 * to the name, "Create a Corrective Action Form from this conversation." (R6)
 * made a card with no Policy line and an Action Plan to "review the applicable
 * company policy": the account given earlier in the same chat, for the same
 * person and form, was no longer read.
 *
 * The manager's turns are verbatim, in order (as the tester replayed them:
 * text turns only, no clicks). The person is invented, with the same typos
 * mapped onto the invented name: the manager first typed the surname with two
 * letters swapped, then corrected it, then mistyped the second given name
 * twice. She is on the directory under the corrected spelling.
 */

type T = ReplayContext;

const MARISOL: DirectoryRow = {
  id: "e-marisol-ortega-valdez",
  firstName: "Marisol",
  lastName: "Ortega Valdez",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function policyKeptPeople(): readonly DirectoryRow[] {
  return [MARISOL];
}

const REPORT = "Coordinator's full-conversation replays, 5 Nov 2026 (R6/R7; the sibling app's production, 2 Nov 2026; this app's setting)";

const TURNS = [
    "i have an employee, Marisol Ortega Valdze that needs a corrective action form with a customer complaint",
  "verbal warning, no payroll deduct, tanning consultant,",
  "fix her last name valdez",
  "make that update",
  "under the employee line the name is supposed to be marisol otrega valdez",
  "redo marisol ortega valdez",
  "make that change to Marisol Prtega Valdez",
  "okay the correct way is Marisol Ortega Valdez",
  "can i review the card",
] as const;
const CREATE = "Create a Corrective Action Form from this conversation.";

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-02T18:00:00Z"));
  t.directory([...STAFF, MARISOL]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

/** The card's Policy line, or "". */
function policyLine(content: string): string {
  return content.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

export const NOV5_POLICY_KEPT_ACROSS_TURNS_CASES: ReplayCase[] = [
  {
    id: "nov5-r6-policy-kept-across-turns",
    title: "R6/R7: \"Create a Corrective Action Form from this conversation.\" after name corrections keeps the Standards of Conduct the card cited for \"a customer complaint\"",
    report: `${REPORT}: the card cited Standards of Conduct p.12 at R7; at R6 it read "review the applicable company policy" with no Policy line`,
    status: { open: "with production's flags the card made at R6 has no Policy line" },
    fixFlags: ["REQUEST_KEPT_IN_WINDOW_ENABLED", "NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED"],
    async run(t) {
      const thread = start(t);
      let cited = "";
      for (const turn of TURNS) {
        const reply = await thread.say(turn);
        if (!cited && /Standards of Conduct/.test(policyLine(reply.content))) cited = policyLine(reply.content);
      }
      // The earlier card's citation is the premise: without it this case proves nothing.
      expect(cited, "no earlier card cited the Standards of Conduct for \"a customer complaint\"").toMatch(/Standards of Conduct/);
      const card = await thread.say(CREATE);
      expect(thread.proposal, `no Corrective Action card:\n${card.content}`).toMatchObject({ templateKey: "dpoa" });
      expect(policyLine(card.content), `the policy the card cited was dropped:\n${card.content}`).toMatch(/Standards of Conduct/);
      expect(card.content, `the Action Plan fell back to "the applicable company policy":\n${card.content}`).not.toMatch(/review the applicable company policy/i);
    },
  },
];
