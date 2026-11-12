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

/** The 27 Oct live report's turns as this app's e2e has them (`account-only-policy-query-e2e.test.ts`, invented person). */
const OPENING_TURNS = ["create a CA form for quinn marlowe at kearney. she was late on the 2nd", "yes payroll deduct", "$25"];
const OPENING_LINE = "An employee assigned to open the salon is expected to arrive on time and ready to work at the start of the scheduled shift.";

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
  {
    // Ported from Ask Bubbles (Gate-Bubbles-5, record 2f2b8517): the flag kept every general expectation, so an opening
    // nobody wrote was saved. It is exempt only from "scheduled to" now; the line says "open" and the manager never did.
    id: "nov12-expectation-policy-line-no-invented-opening",
    title: `"${OPENING_TURNS.join('" / "')}": no general expectation about opening is saved`,
    report: "Ported from Ask Bubbles (Gate-Bubbles-5, 12 Nov 2026): R737 regression, the 27 Oct live report's turns",
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
      t.directory([{ id: "e-1", firstName: "Quinn", lastName: "Marlowe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: null }]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const turn of OPENING_TURNS) await thread.say(turn);
      t.draftWrites({ observation: `Observed:\nQuinn was late on October 2, 2026.\nExpectation:\n${OPENING_LINE}` });
      const id = await thread.create();
      const observation = t.values(id).observation ?? "";
      expect(observation, `an opening nobody wrote was saved:\n${observation}`).not.toMatch(/\bopen/i);
    },
  },
];
