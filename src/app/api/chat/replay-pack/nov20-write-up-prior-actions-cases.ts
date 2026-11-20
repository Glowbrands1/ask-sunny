import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PRIOR ACTIONS STATE ONLY WHAT THE MANAGER SAID (Pau via QA, 17 and 20 Nov 2026; item 13)
 * ============================================================================
 *
 * Item 13 of the saved-form items, on the real Create path (createInlineForm → POST /api/forms/instances → POST …/draft;
 * the drafting model is a stand-in that writes what the live one wrote). Names invented.
 * Prior actions "None — first occurrence" with nothing said about prior actions: blank unless stated.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau via QA (17 Nov 2026): the saved write-up states only what the manager said";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

async function created(
  t: ReplayContext,
  said: string,
  card: Record<string, unknown>,
  drafted: Record<string, string>,
  draftedChecked?: Record<string, string[]>,
) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), ...card } }));
  t.draftWrites(drafted, draftedChecked);
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  return { values: t.values(id), checked: t.checked(id) };
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

const CA_LATE = "ca for Remy Calder, she was 20 minutes late to her shift on 11/14";
const CA_CARD = { template_key: "dpoa", what_happened: "Remy was 20 minutes late to her shift on 11/14.", policy: "Attendance", incident_date: "2026-11-14" };
const CA_OBSERVATION = "Observed:\nRemy was 20 minutes late to her shift on November 14, 2026.\n\nExpectation:\nRemy is expected to arrive on time for every scheduled shift.\n\nGoing Forward:\nRemy will arrive on time for every scheduled shift.";

export const NOV20_WRITE_UP_PRIOR_ACTIONS_CASES: ReplayCase[] = [
  /* -------------------------------------------------------------------------- 2. prior actions */
  fixed("nov17-write-up-prior-actions-blank-unless-stated", `"${CA_LATE}" (nothing said about prior actions), the drafter writes "None — first occurrence": Prior actions stays blank`, async (t) => {
    const saved = await created(t, CA_LATE, CA_CARD, { observation: CA_OBSERVATION, prior_actions: "None — first occurrence" });
    expect(saved.values.prior_actions ?? "", "a prior-actions answer the manager never gave").toBe("");
  }),
  fixed("nov17-write-up-prior-actions-stated-first-time-kept", `Control: "${CA_LATE}, this is the first time": "None — first occurrence" is the manager's and stays`, async (t) => {
    // The loop's card records what the manager said about earlier steps; Create keeps the drafter's line for it.
    const saved = await created(t, `${CA_LATE}, this is the first time`, { ...CA_CARD, prior_actions: "None — first occurrence" }, { observation: CA_OBSERVATION, prior_actions: "None — first occurrence" });
    expect(saved.values.prior_actions ?? "").toMatch(/first occurrence/i);
  }),
];
