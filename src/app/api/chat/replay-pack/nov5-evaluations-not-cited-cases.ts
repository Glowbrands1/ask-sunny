import { expect, vi } from "vitest";

import { cardPolicyHeading } from "@/lib/forms/card-policy";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "EVALUATIONS AND RAISES" ON AN UNDERPERFORMANCE CA (QA round 2, row B, 5 Nov
 * 2026; this app, flags on)
 * ============================================================================
 *
 * Message 8 ("<name> - verbal / 146 tans / Below in PPTA, LPSVA, Average
 * Club, CC%, Spa%"; the person is invented) made a card with two policy lines,
 * "Standards of Conduct Policy, JBA Policy Manual p.12" and "Evaluations and
 * Raises Policy, JBA Policy Manual p.34", an Action Plan reviewing both, and
 * an Evaluations and Raises excerpt among the sources. A sales or performance
 * account cites the Standards of Conduct (Pau, 4 Nov 2026); the heading the
 * model chose from the manual's list (here, as the testers saw it, "Evaluations
 * and Raises") is not cited beside it. Fixed behind CA_SALES_POLICY_ENABLED
 * (`ai/form-card-slots.ts` salesConductOnly).
 */

const WYNNE: DirectoryRow = {
  id: "e-wynne-sarrow",
  firstName: "Wynne",
  lastName: "Sarrow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function evaluationsNotCitedPeople(): readonly DirectoryRow[] {
  return [WYNNE];
}

const MSG_8 = "Wynne Sarrow - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";

export const NOV5_EVALUATIONS_NOT_CITED_CASES: ReplayCase[] = [
  {
    id: "nov5-msg8-no-evaluations-and-raises",
    title: "message 8: an underperformance CA cites the Standards of Conduct, never \"Evaluations and Raises\" beside it (card, Action Plan, sources)",
    report: "QA round 2, row B, 5 Nov 2026 (this app, flags on)",
    // The route hands the card's citation step the heading the manager's turns
    // name (statedManualHeading), and here they name none, so the live
    // "Evaluations and Raises" line does not reproduce: with the fix flags this is
    // a guard. The fix is proved against the production manual in
    // src/lib/ai/form-card-sales-conduct-only.test.ts.
    status: { open: "with this app's production flags (CA_SALES_POLICY_ENABLED off) the request is answered as metric-only, with no Corrective Action card" },
    fixFlags: ["CA_SALES_POLICY_ENABLED", "FORM_NAME_FROM_ROSTER_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
      t.directory([...STAFF, WYNNE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      // Message 8 answers a Corrective Action already asked for (the request is sf-s24's turn 1, verbatim).
      await thread.say("Can you write me a performace ca for an employee who did not meet their numbers for the month of october Wynne Sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%");
      // As the testers saw it: the heading chosen from the manual's list was Evaluations and Raises.
      t.slotsRead({ policyHeading: "Evaluations and Raises" });
      const reply = await thread.say(MSG_8, { policySection: "Evaluations and Raises" });
      expect(thread.proposal, `no CA card for Wynne Sarrow:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      expect(reply.content, `"Evaluations and Raises" on an underperformance card:\n${reply.content}`).not.toMatch(/Evaluations and Raises/i);
    },
  },
  {
    id: "nov5-c10-card-and-draft-same-policy",
    // A guard, as nov5-msg8 above: the route hands the card's citation step the
    // heading the manager's turns name, so the live "Evaluations and Raises" line
    // does not reproduce here (checked: it holds with salesConductOnly disabled).
    // The card-path fix is proved against the production manual in
    // src/lib/ai/form-card-sales-conduct-only.test.ts.
    title: "C10: the sales CA's card and the draft made from it cite the same policy (never \"Evaluations and Raises p.34\" on the card and Standards of Conduct on the draft)",
    report: "QA, 5 Nov 2026 (this app, flags off, a manager's sales-numbers message): the card cited \"Evaluations and Raises p.34\"; the created draft's Policy Violated was Standards of Conduct, with that box ticked",
    status: { open: "with this app's production flags (CA_SALES_POLICY_ENABLED off) the request is answered as metric-only, with no Corrective Action card" },
    fixFlags: ["CA_SALES_POLICY_ENABLED", "FORM_NAME_FROM_ROSTER_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-04T23:30:00Z"));
      t.directory([...STAFF, WYNNE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("Can you write me a performace ca for an employee who did not meet their numbers for the month of october Wynne Sarrow  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%");
      // As the live card read it: the heading chosen from the manual's list was Evaluations and Raises.
      t.slotsRead({ policyHeading: "Evaluations and Raises" });
      const card = await thread.say(MSG_8, { policySection: "Evaluations and Raises" });
      expect(thread.proposal, `no CA card for Wynne Sarrow:\n${card.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wynne Sarrow" });
      // Every policy the card cites: its Policy line, and each "<heading> Policy, JBA Policy Manual p.N" line under it.
      const cited = new Set<string>();
      const line = cardPolicyHeading(card.content);
      if (line) cited.add(line.toLowerCase());
      for (const match of card.content.matchAll(/^([A-Z][^\n,]*?)(?:\s+Policy)?,\s+JBA Policy Manual p\.\d+/gm)) cited.add(match[1]!.trim().toLowerCase());
      expect(cited.size, `the card cites no policy:\n${card.content}`).toBeGreaterThan(0);
      t.draftWrites({ observation: "Observed:\nIn October 2026, Wynne completed 146 tanning transactions and was below average in PPTA, LPSVA, Average Club, CC%, and Spa%." });
      const violated = (t.values(await thread.create()).policy_violated ?? "").toLowerCase();
      for (const heading of cited) expect(violated, `the card cites ${heading}; the draft's Policy Violated is:\n${violated}`).toContain(heading);
    },
  },
];
