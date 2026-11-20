import { expect, vi } from "vitest";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * LEAVING EARLY IS NOT LATENESS, AND NOBODY "WAS TOLD" WHAT THE MANAGER NEVER SAID (f082)
 * ============================================================================
 *
 * QA's live test on main 8852c0c2 (20 Nov 2026, conv_mwpgp5pq29vc3jk, draft ef50a751), on the real Create path
 * (createInlineForm → POST /api/forms/instances → POST …/draft; the drafting model is a stand-in that writes what the
 * live one wrote). The manager typed "ca for Test Testy, we do not do extra cleaning after hours, she left early 11/18":
 *   1. the card's attendance was "lateness", and the saved write-up and Action Plan said "arrive on time … Continued
 *      lateness will result in further disciplinary review";
 *   2. the saved Observation said "Test was told that extra cleaning is not performed after hours", a telling the
 *      manager never described (theirs was a statement of the rule).
 * Test Testy is QA's invented test person.
 */
const REPORT = "QA's live test (20 Nov 2026, conv_mwpgp5pq29vc3jk): leaving early written up as lateness, and an invented telling";
const FLAG = "AGENT_LOOP_ENABLED";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const SAID = "ca for Test Testy, we do not do extra cleaning after hours, she left early 11/18";
const TESTY: DirectoryRow = { id: "e-test-testy", firstName: "Test", lastName: "Testy", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** What the live drafter wrote on ef50a751, as QA read it back. */
const LIVE_DRAFT =
  "Observed:\nTest left her shift early on 11/18. Test was told that extra cleaning is not performed after hours.\n\nExpectation:\nTest is expected to arrive on time for all scheduled shifts.\n\nGoing Forward:\nTest will arrive on time for every scheduled shift.";
const LATENESS = /\b(?:late|lateness|tardy|tardiness|on time|arriv\w*)\b/i;

const card = (view: LoopView): LoopDecision => ({
  tool: "propose_form",
  input: {
    template_key: "dpoa",
    employee_id: TESTY.id,
    what_happened: "Test left early on 11/18. We do not do extra cleaning after hours.",
    policy: "Attendance",
    incident_date: "2026-11-18",
    attendance: "left_early",
    attendance_evidence: evidenceFrom(view, "she left early 11/18"),
  },
});

async function created(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
  t.directory([TESTY]);
  t.as("salon_director", KEARNEY);
  const model = loopStandIn((view) => (lastResult(view, "propose_form")?.card ? { text: "Here's the Corrective Action Form for **Test**." } : card(view)));
  t.loopModel!(model);
  t.draftWrites({ observation: LIVE_DRAFT });
  const thread = t.thread();
  await thread.say(SAID);
  const proposed = model.views.flatMap((view) => view.results).filter((result) => result.tool === "propose_form").at(-1)?.output as { card?: Record<string, unknown>; reason_code?: string } | undefined;
  expect(proposed?.reason_code, "the tool refused a left-early card").toBeUndefined();
  const id = await thread.create();
  return t.values(id);
}

export const NOV20_LEFT_EARLY_NOT_LATENESS_CASES: ReplayCase[] = [
  {
    id: "nov20-f082-left-early-not-lateness",
    title: `f082: "${SAID}": the card records left_early, and the saved Observation, Expectation, Going Forward and Action Plan speak of staying for the full shift, never lateness`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const values = await created(t);
      const observation = values.observation ?? "";
      expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/left (?:her |the )?shift early|left early/);
      expect(observation, `the write-up calls leaving early lateness:\n${observation}`).not.toMatch(LATENESS);
      expect(observation, `the Expectation does not speak of staying:\n${observation}`).toMatch(/Expectation:\s*\n?Test is expected to stay for the full scheduled shift\./);
      const plan = values.action_plan ?? "";
      expect(plan, "no Action Plan was saved (the case proves nothing)").not.toBe("");
      expect(plan, `the Action Plan calls leaving early lateness:\n${plan}`).not.toMatch(/Continued lateness|arrive on time/i);
    },
  },
  {
    id: "nov20-f082-no-invented-telling",
    title: `f082: "${SAID}": the saved Observation never says Test "was told" anything; the manager stated a rule`,
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      const values = await created(t);
      const observation = values.observation ?? "";
      expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/left (?:her |the )?shift early|left early/);
      expect(observation, `the Observation invents a telling:\n${observation}`).not.toMatch(/\bwas told\b|\binformed\b|\breminded\b/i);
    },
  },
];
