import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * WHAT HAPPENED IS THE INCIDENT, NOT A FRAGMENT OF THE TURN (QA's October triage of #260, 10 Nov 2026;
 * INCIDENT_CLAUSE_SPLIT_ENABLED)
 * ============================================================================
 *
 * #260's wording, "please create a corrective action form for <A>, she works at our kearney, ne salon as a tan
 * consultant and was late today." (the person here is the pack's STAFF): with production's flags the card's Observation
 * of Offense is "ne salon as a tan consultant and was late today", cut at the comma of "kearney, ne".
 */
export const NOV11_INCIDENT_CLAUSE_SPLIT_CASES: readonly ReplayCase[] = [
  {
    id: "nov11-incident-clause-split-kearney-ne",
    title: '"…she works at our kearney, ne salon as a tan consultant and was late today.": the Observation is the lateness, not "ne salon as a tan consultant …"',
    report: "#260 (QA's October triage, 10 Nov 2026): the Observation of Offense was \"ne salon as a tan consultant and was late today\"",
    status: { open: "Observation of Offense: \"ne salon as a tan consultant and was late today\"" },
    fixFlags: ["INCIDENT_CLAUSE_SPLIT_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("please create a corrective action form for Remy Calder, she works at our kearney, ne salon as a tan consultant and was late today.");
      expect(reply.formProposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Remy Calder" });
      const observation = /\*\*Observation of Offense:\*\*\s*(.+)/.exec(reply.content)?.[1] ?? "";
      expect(observation, `the Observation is a fragment of the turn:\n${reply.content}`).not.toMatch(/^ne salon|tan consultant/i);
      expect(observation, `the Observation lost the lateness:\n${reply.content}`).toMatch(/late today/i);
    },
  },
];
