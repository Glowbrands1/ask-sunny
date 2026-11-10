import { expect, vi } from "vitest";

import { KEARNEY, type ReplayCase, type ReplayContext } from "./cases";
import { CA_CHAIN, LIVE_ROSTER } from "./nov4-live-regressions-scenarios";

/**
 * ============================================================================
 * THE POLICY'S EXPECTATION IS NOT AN INVENTED DETAIL (ported from Ask Bubbles: QA's audit there, 10 Nov 2026;
 * EXPECTATION_POLICY_LINE_KEPT_ENABLED)
 * ============================================================================
 *
 * In Ask Bubbles, with ACCOUNT_ONLY_POLICY_QUERY on (production in both apps), `withoutInventedDetail` dropped "An
 * employee scheduled to open is expected to arrive on time and have the store ready to open." from the saved
 * Observation, because "scheduled to" is on its list of details the manager never wrote. The same code is here. The
 * request is this app's live chain (`CA_CHAIN`, invented person); the Expectation is the general policy sentence in this
 * app's wording.
 */
const FIX = ["EXPECTATION_POLICY_LINE_KEPT_ENABLED"];
const REPORT = "Ported from Ask Bubbles (QA's audit, 10 Nov 2026): the policy's Expectation dropped by withoutInventedDetail";
const POLICY_LINE = "An employee scheduled to open is expected to arrive on time and have the salon ready to open.";

async function created(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  t.directory(LIVE_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(CA_CHAIN[0]);
  t.draftWrites({ observation: `Observed:\nJane Doe was late to open on October 20, 2026.\nExpectation:\n${POLICY_LINE}` });
  const id = await thread.create();
  return { thread, id };
}

export const NOV10_EXPECTATION_POLICY_LINE_KEPT_CASES: ReplayCase[] = [
  {
    id: "nov10-expectation-policy-line-kept",
    title: `"${CA_CHAIN[0]}": the saved Observation keeps the policy's Expectation`,
    report: REPORT,
    status: { open: "the Expectation sentence is dropped from the saved Observation" },
    fixFlags: FIX,
    async run(t) {
      const { id } = await created(t);
      const observation = t.values(id).observation ?? "";
      expect(observation, `the Expectation was dropped:\n${observation}`).toContain(POLICY_LINE);
    },
  },
];
