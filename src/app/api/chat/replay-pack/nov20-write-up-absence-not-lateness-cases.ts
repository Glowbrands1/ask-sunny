import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

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

type Attendance = { kind: string; words: string } | { kind: string; quote: string } | null;

/** The card the scripted model proposes; `attendance` null leaves the field out, `quote` gives words not in the message. */
const cardFor = (view: LoopView, whatHappened: string, attendance: Attendance): LoopDecision => ({
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
    ...(attendance === null
      ? { attendance: undefined } // omitted on purpose: the stand-in leaves an explicit undefined as written
      : { attendance: attendance.kind, attendance_evidence: "words" in attendance ? evidenceFrom(view, attendance.words) : { ...evidenceFrom(view, "Remy Calder"), quote: attendance.quote } }),
  },
});

/** The tool's attendance refusal on this turn's last propose_form, if any. */
const attendanceRefusal = (view: LoopView): string | null => {
  const code = lastResult(view, "propose_form")?.reason_code;
  return typeof code === "string" && code.startsWith("attendance_") ? code : null;
};

/**
 * The scripted model proposes `first`; when the tool refuses for attendance, it proposes again with `retry` (the field
 * the refusal asked for). Every refusal code seen is returned with the saved values.
 */
async function created(t: ReplayContext, said: string, whatHappened: string, draft: string, first: Attendance, retry: Attendance = first) {
  const refusals: string[] = [];
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const refused = attendanceRefusal(view);
    if (refused) {
      refusals.push(refused);
      return cardFor(view, whatHappened, retry);
    }
    return lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Remy**." } : cardFor(view, whatHappened, first);
  }));
  t.draftWrites({ observation: draft });
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  // The stand-in may be asked more than once for the same step: each code counts once.
  return { values: t.values(id), refusals: [...new Set(refusals)] };
}

/** The saved write-up and Action Plan speak of a missed shift, never lateness. */
function expectAbsence(values: Record<string, string>) {
  const observation = values.observation ?? "";
  expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/did not come into/);
  expect(observation, `the write-up calls the missed shift lateness:\n${observation}`).not.toMatch(LATENESS);
  expect(observation, `the Expectation does not name the absence:\n${observation}`).toMatch(/Expectation:\s*\n?[^\n]*\b(?:shift|absen\w*|attend\w*)/i);
  const plan = values.action_plan ?? "";
  expect(plan, "no Action Plan was saved (the case proves nothing)").not.toBe("");
  expect(plan, `the Action Plan calls the missed shift lateness:\n${plan}`).not.toMatch(/Continued lateness|arrive on time/i);
}

const ABSENCE = { kind: "absence", words: "did not come into her scheduled shift" };
const ACCOUNT = "Remy did not come into the scheduled shift today at 9:30.";
/** QA's review of #1137: the signed-warning shape, the account first and the form after (the person invented). */
const SIGNED = "Remy Calder did not come into her scheduled shift today at 9:30. I need a verbal warning written up for her to sign";

export const NOV20_WRITE_UP_ABSENCE_NOT_LATENESS_CASES: ReplayCase[] = [
  fixed("nov20-write-up-missed-shift-not-lateness", `"${SAID}": the saved Observation, Expectation, Going Forward and Action Plan speak of a missed shift, never lateness`, async (t) => {
    const { values, refusals } = await created(t, SAID, ACCOUNT, LIVE_DRAFT, ABSENCE);
    expect(refusals, "the tool refused a card that carried attendance on the manager's words").toEqual([]);
    expectAbsence(values);
  }),
  fixed("nov20-write-up-signed-warning-shape", `QA's review of #1137, "${SIGNED}": the model sets attendance absence, and the saved write-up and plan speak of a missed shift`, async (t) => {
    const { values, refusals } = await created(t, SIGNED, ACCOUNT, LIVE_DRAFT, ABSENCE);
    expect(refusals).toEqual([]);
    expectAbsence(values);
  }),
  fixed("nov20-write-up-attendance-omitted-tool-asks", `QA's review of #1137: "${SIGNED}", the model omits attendance on the Attendance card: the tool refuses and asks for it, and the card proposed again with it saves an absence`, async (t) => {
    const { values, refusals } = await created(t, SIGNED, ACCOUNT, LIVE_DRAFT, null, ABSENCE);
    expect(refusals, "the tool did not ask for attendance (it was skipped silently)").toEqual(["attendance_not_given"]);
    expectAbsence(values);
  }),
  fixed("nov20-write-up-attendance-quote-not-said-refused", `QA's review of #1137: "${SIGNED}", attendance absence quoting words the manager never typed ("she was late to her shift"): refused, and asked again`, async (t) => {
    const { values, refusals } = await created(t, SIGNED, ACCOUNT, LIVE_DRAFT, { kind: "absence", quote: "she was late to her shift" }, ABSENCE);
    expect(refusals, "evidence not in the manager's words was kept").toEqual(["attendance_evidence_not_found"]);
    expectAbsence(values);
  }),
  fixed("nov20-write-up-lateness-control", `Control: "I need a verbal CA for Remy Calder, she was 20 minutes late to her shift today": lateness keeps its wording`, async (t) => {
    const { values, refusals } = await created(
      t,
      "I need a verbal CA for Remy Calder, she was 20 minutes late to her shift today",
      "Remy was 20 minutes late to the shift today.",
      "Observed:\nRemy was 20 minutes late to the scheduled shift on November 16, 2026.\n\nExpectation:\nRemy is expected to arrive on time and be ready to work at the start of the scheduled shift.\n\nGoing Forward:\nRemy will arrive on time for every scheduled shift.",
      { kind: "lateness", words: "20 minutes late to her shift" },
    );
    expect(refusals).toEqual([]);
    expect(values.observation ?? "").toMatch(/expected to arrive on time/);
  }),
];
