import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "SHE IS AN HR ASSISTANT" IS NOT WHAT HAPPENED (QA's October triage of #207, 10 Nov 2026;
 * TITLE_NOT_IN_OBSERVATION_ENABLED)
 * ============================================================================
 *
 * #207's B16 wording, "create a coaching form for Test Employee at Kearney, she is an HR assistant, for being late on
 * 10-20-26" (the person here is from the pack's STAFF list), in sentence case and all lowercase: with production's
 * flags the Coaching card's Observation of Offense was "she is an HR assistant, being late on 10-20-26". This case
 * checks the Observation only; the title line's casing ("Hr Assistant" for a person with no directory title) and #207's
 * other items (the "verbal. payroll deduct is not applicable." level, the future date) are separate.
 */
const WORDINGS = [
  "create a coaching form for Remy Calder at Kearney, she is an HR assistant, for being late on 10-20-26",
  "create a coaching form for remy calder at kearney, she is an hr assistant, for being late on 10-20-26",
];

export const NOV10_TITLE_NOT_IN_OBSERVATION_CASES: ReplayCase[] = [
  {
    id: "nov10-title-not-in-observation-207",
    title: "\"…at Kearney, she is an HR assistant, for being late on 10-20-26\": the Observation is the lateness, not the title",
    report: "#207 B16 (QA's October triage, 10 Nov 2026): the Observation of Offense read \"she is an HR assistant, being late on 10-20-26\"",
    status: { open: "Observation of Offense: \"she is an HR assistant, being late on 10-20-26\"" },
    fixFlags: ["TITLE_NOT_IN_OBSERVATION_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      for (const said of WORDINGS) {
        const reply = await t.thread().say(said);
        expect(reply.formProposal, `no Coaching card for "${said}":\n${reply.content}`).toMatchObject({ templateKey: "coaching", employeeName: "Remy Calder" });
        const observation = /\*\*Observation of Offense:\*\*\s*(.+)/.exec(reply.content)?.[1] ?? "";
        expect(observation, `the Observation carries the job title for "${said}":\n${reply.content}`).not.toMatch(/\bassistant\b|\bshe is\b/i);
        expect(observation, `the Observation lost the account for "${said}":\n${reply.content}`).toMatch(/being late on 10-20-26/i);
      }
    },
  },
];
