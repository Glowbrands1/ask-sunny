import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * A MISSED SHIFT IS WRITTEN UP AS AN ABSENCE, NOT LATENESS (QA's production audit, 20 Nov 2026; item 21)
 * ============================================================================
 *
 * A real finalized form (#6cad15df), on the real Create path (createInlineForm → POST /api/forms/instances → POST
 * …/draft; the drafting model is a stand-in that writes what the live one wrote). The manager typed "did not come into
 * her scheduled shift today at 9:30". The saved write-up said "Expectation: <P> is expected to arrive on time and be
 * ready to work at the start of the scheduled shift", and the Action Plan "Continued lateness will result in further
 * disciplinary review". Rule: the write-up names the offense the manager described; a missed shift is an absence, not
 * lateness, in Observed, Expectation, Going Forward and any offense-specific Action Plan sentence. The person is invented.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's production audit (20 Nov 2026, #6cad15df): a no-show was written up as lateness";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const SAID = "I need a verbal CA for Remy Calder, she did not come into her scheduled shift today at 9:30";
/** What the live drafter wrote on #6cad15df (the person invented). */
const LIVE_DRAFT =
  "Observed:\nRemy did not come into the scheduled shift on November 16, 2026 at 9:30.\n\nExpectation:\nRemy is expected to arrive on time and be ready to work at the start of the scheduled shift.\n\nGoing Forward:\nRemy will arrive on time for every scheduled shift.";
const LATENESS = /\b(?:late|lateness|tardy|tardiness|on time|arriv\w*)\b/i;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
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

async function created(t: ReplayContext, said: string, whatHappened: string, draft: string, attendance: { kind: string; words: string }) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the Corrective Action Form for **Remy**." }
    : {
        tool: "propose_form",
        input: {
          template_key: "dpoa",
          employee_name: "Remy Calder",
          person_evidence: evidenceFrom(view, "Remy Calder"),
          what_happened: whatHappened,
          policy: "Attendance",
          incident_date: "2026-11-16",
          warning_level: "verbal",
          level_evidence: evidenceFrom(view, "verbal CA"),
          attendance: attendance.kind,
          attendance_evidence: evidenceFrom(view, attendance.words),
        },
      }));
  t.draftWrites({ observation: draft });
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  return t.values(id);
}

export const NOV20_WRITE_UP_ABSENCE_NOT_LATENESS_CASES: ReplayCase[] = [
  fixed("nov20-write-up-missed-shift-not-lateness", `"${SAID}": the saved Observation, Expectation, Going Forward and Action Plan speak of a missed shift, never lateness`, async (t) => {
    const values = await created(t, SAID, "Remy did not come into the scheduled shift today at 9:30.", LIVE_DRAFT, { kind: "absence", words: "did not come into her scheduled shift" });
    const observation = values.observation ?? "";
    expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/did not come into/);
    expect(observation, `the write-up calls the missed shift lateness:\n${observation}`).not.toMatch(LATENESS);
    expect(observation, `the Expectation does not name the absence:\n${observation}`).toMatch(/Expectation:\s*\n?[^\n]*\b(?:shift|absen\w*|attend\w*)/i);
    const plan = values.action_plan ?? "";
    expect(plan, "no Action Plan was saved (the case proves nothing)").not.toBe("");
    expect(plan, `the Action Plan calls the missed shift lateness:\n${plan}`).not.toMatch(/Continued lateness|arrive on time/i);
  }),
  fixed("nov20-write-up-lateness-control", `Control: "I need a verbal CA for Remy Calder, she was 20 minutes late to her shift today": lateness keeps its wording`, async (t) => {
    const values = await created(
      t,
      "I need a verbal CA for Remy Calder, she was 20 minutes late to her shift today",
      "Remy was 20 minutes late to the shift today.",
      "Observed:\nRemy was 20 minutes late to the scheduled shift on November 16, 2026.\n\nExpectation:\nRemy is expected to arrive on time and be ready to work at the start of the scheduled shift.\n\nGoing Forward:\nRemy will arrive on time for every scheduled shift.",
      { kind: "lateness", words: "20 minutes late to her shift" },
    );
    expect(values.observation ?? "").toMatch(/expected to arrive on time/);
  }),
];
