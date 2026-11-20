import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE COACHING WRITE-UP: WHAT WAS SEEN, ABOUT THE EMPLOYEE (Pau via QA, 17 and 20 Nov 2026; item 14)
 * ============================================================================
 *
 * Item 14 of the saved-form items, on the real Create path (createInlineForm → POST /api/forms/instances → POST …/draft;
 * the drafting model is a stand-in that writes what the live one wrote). Names invented. The live Test Testy coaching
 * draft: Observed "Coaching was provided to <name>", Expectation "Guests are expected to be greeted", and a coaching
 * type box ticked although the manager named none.
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

export const NOV20_WRITE_UP_COACHING_WORDING_CASES: ReplayCase[] = [
  fixed("nov17-write-up-coaching-observed-expectation-type", "The live Test Testy coaching shape: Observed \"Coaching was provided to …\", Expectation \"Guests are expected to be greeted …\" and a Training Plan of Action tick the manager never named: Observed is what was seen, Expectation is about Remy, no type is ticked", async (t) => {
    const saved = await created(
      t,
      "coaching for remy calder on greeting guests at the door, she is not greeting guests when they walk in",
      { template_key: "coaching", what_happened: "Remy is not greeting guests when they walk in." },
      { coaching_details: "Observed:\nCoaching was provided to Remy Calder on greeting guests at the door.\n\nExpectation:\nGuests are expected to be greeted at the door when they walk in.\n\nGoing Forward:\nRemy will greet every guest at the door." },
      { coaching_type: ["training_plan_of_action"] },
    );
    const details = saved.values.coaching_details ?? "";
    const observed = /Observed:\s*\n([\s\S]*?)(?:\n\n[A-Z][a-z ]+:|$)/.exec(details)?.[1] ?? "";
    const expectation = /Expectation:\s*\n([\s\S]*?)(?:\n\n[A-Z][a-z ]+:|$)/.exec(details)?.[1] ?? "";
    expect(observed, `Observed describes the coaching, not what was seen:\n${details}`).not.toMatch(/coaching (?:was|has been) (?:provided|given)/i);
    expect(observed).toMatch(/greet/i);
    expect(expectation, `Expectation is not about Remy:\n${details}`).toMatch(/^Remy\b/);
    expect(saved.checked.coaching_type ?? [], "a coaching type the manager never named").toEqual([]);
  }),
  fixed("nov17-write-up-coaching-type-stated-kept", "Control: \"training plan of action for remy calder on greeting guests at the door\": the Training Plan of Action box the manager named stays ticked", async (t) => {
    const saved = await created(
      t,
      "coaching, training plan of action for remy calder on greeting guests at the door",
      { template_key: "coaching", what_happened: "Training plan of action on greeting guests at the door." },
      { coaching_details: "Observed:\nRemy is not greeting guests at the door.\n\nExpectation:\nRemy is expected to greet every guest at the door." },
      { coaching_type: ["training_plan_of_action"] },
    );
    expect(saved.checked.coaching_type ?? []).toEqual(["training_plan_of_action"]);
  }),
];
