import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/** QA's live check with PERSON_GUARD on, 3 Nov 2026. */
export const NOV3_POLICY_NAME_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-policy-name-not-observation",
    title: "\"CA for must see behaviors\": the policy's name is not read back as the Observation of Offense",
    report: '"can you create a CA for must see behaviors" → "Who is this form for?" with "Observation of Offense: must see behaviors" (QA live check)',
    status: { open: "OBSERVATION_NOT_POLICY_NAME_ENABLED is off in production" },
    fixFlags: ["OBSERVATION_NOT_POLICY_NAME_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const reply = await t.thread().say("can you create a CA for must see behaviors");
      expect(reply.content).not.toMatch(/Observation of Offense:\*\*\s*must see behaviors/i);
    },
  },
];
