import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE FULL WRITE-UP: OBSERVED / EXPECTATION / GOING FORWARD (Pau's ruling via QA, 17 Nov 2026)
 * ============================================================================
 *
 * Pau: "observation + going forward", "I prefer the full write-up, also in Other". The forms the testers created from loop
 * cards (e136ec2e, 7545d162, 28e76a95) had no "Going Forward:", where Ask Sunny AI's (c084, c094, c243) did. On both
 * paths the drafting step's Going Forward was removed by DRAFT_NO_INVENTED_PLAN_ENABLED (QA's 26 Oct rule, reversed by
 * Pau's ruling): on every Corrective Action, and on a Coaching Form unless the manager typed a plan. The flag is now off in
 * production (`src/config/production-flags.json`), so the saved Observation keeps all three sections. Every case runs the
 * real Create path (createInlineForm → POST /api/forms/instances → POST …/draft); the drafting model is a stand-in.
 * Names invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Pau's ruling via QA (17 Nov 2026): the full write-up with Going Forward on forms made from loop cards (e136ec2e, 7545d162, 28e76a95)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const FULL = (observed: string) =>
  `Observed:\n${observed}\n\nExpectation:\nRemy is expected to follow this on every shift.\n\nGoing Forward:\nRemy will follow it on every shift from now on.`;

async function created(t: ReplayContext, said: string, card: Record<string, unknown>, field: string, observed: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), ...card } }));
  t.draftWrites({ [field]: FULL(observed) });
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  return t.values(id);
}

function hasAllThree(text: string) {
  expect(text).toContain("Observed:");
  expect(text).toContain("Expectation:");
  expect(text, "the full write-up lost Going Forward").toContain("Going Forward:");
}

export const NOV17_FULL_WRITE_UP_CASES: ReplayCase[] = ([
  ["ca-attendance", "ca for Remy Calder, she was 20 minutes late to her shift on 11/14", { template_key: "dpoa", what_happened: "Remy was 20 minutes late to her shift on 11/14.", policy: "Attendance", incident_date: "2026-11-14" }, "observation", "Remy was 20 minutes late to her shift on November 14, 2026."],
  ["ca-other-msb", "ca for Remy Calder, she did not do her must see behaviors with guests on 11/14", { template_key: "dpoa", what_happened: "Remy did not do the Must See Behaviors with guests on 11/14.", policy: "Other — Must See Behaviors", incident_date: "2026-11-14" }, "observation", "Remy did not do the Must See Behaviors with guests on November 14, 2026."],
  ["coaching", "coaching for Remy Calder, she did not greet guests at the door on 11/14", { template_key: "coaching", what_happened: "Remy did not greet guests at the door on 11/14.", incident_date: "2026-11-14" }, "coaching_details", "Remy did not greet guests at the door on November 14, 2026."],
] as const).map(([what, said, card, field, observed]): ReplayCase => ({
  id: `nov17-full-write-up-${what}`,
  title: `A loop ${what} card, Create: the saved ${field} keeps Observed / Expectation / Going Forward${field === "observation" ? ", with the Action Plan" : ""}`,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    const values = await created(t, said, card, field, observed);
    hasAllThree(values[field] ?? "");
    // The Action Plan as the app builds it (Attendance has its own wording); only that a full plan is there.
    if (field === "observation") expect((values.action_plan ?? "").length, "no Action Plan").toBeGreaterThan(40);
  },
}));
