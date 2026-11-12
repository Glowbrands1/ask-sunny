import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE CA OBSERVATION CARRIES NO AI-WRITTEN "GOING FORWARD" (QA's October triage of #256, 10 Nov 2026)
 * ============================================================================
 *
 * On main f337302d with production's flags, the drafting model's "Going Forward: … plans travel and preparation …" was
 * saved in the Corrective Action Observation, including after "no action plan". Fixed with
 * DRAFT_NO_INVENTED_PLAN_ENABLED (`forms/narrative-draft.ts`, the draft route). The person is invented.
 */
const OBSERVED = "Observed:\nOn October 20, 2026, Remy Calder arrived 20 minutes late for her scheduled shift.";
const EXPECTATION = "Expectation:\nEmployees are expected to arrive on time and be ready to work at the start of their scheduled shift.";
const GOING_FORWARD =
  "Going Forward:\nRemy plans travel and preparation so that she arrives on time, and notifies the salon in advance if arriving late is unavoidable.";

export const NOV10_DRAFT_NO_INVENTED_PLAN_CASES: ReplayCase[] = [
  {
    id: "nov10-draft-no-invented-plan-ca-observation",
    title: '"create a written CA for <employee>, she was 20 minutes late … no action plan": the saved Observation has no Going Forward',
    report: "QA's October triage (10 Nov 2026) of #256, on main f337302d with production's flags",
    status: { open: "the model's Going Forward is saved in the Observation; fixed with DRAFT_NO_INVENTED_PLAN_ENABLED" },
    fixFlags: ["DRAFT_NO_INVENTED_PLAN_ENABLED"],
    async run(t) {
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a written CA for Remy Calder, she was 20 minutes late for her shift on 10-20-26. no action plan");
      t.draftWrites({ observation: `${OBSERVED}\n\n${EXPECTATION}\n\n${GOING_FORWARD}` });
      const id = await thread.create();
      const observation = t.values(id).observation ?? "";
      expect(observation, observation).toContain("20 minutes late");
      expect(observation, `an invented plan saved:\n${observation}`).not.toMatch(/Going Forward|plans travel/);
    },
  },
];
