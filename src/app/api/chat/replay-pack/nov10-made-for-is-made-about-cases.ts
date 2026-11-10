import { play } from "./nov7-step-b-refusals-cases";
import { STEP_B_READER_FLAGS, STEP_B_REFUSAL_SCENARIOS, SUN_MEETING, patch, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";
import type { ReplayCase } from "./cases";

/**
 * ============================================================================
 * QA'S LIVE SUNNY r20 (10 Nov 2026, 10:40:28Z): "make it FOR <topic>" IS A MADE-ABOUT
 * ============================================================================
 *
 * A Coaching draft saved from P12's sentence: Details in sections (Observed / Expectation / Going Forward) and the app's
 * policy line. Then "can you make it for missing out monthly meeting" answered "I haven't changed the Coaching Form …",
 * nothing saved. The made-about path reads "make it about <topic>"; "make it for <topic>" (no "about") was not read as
 * one. The person is invented.
 */
const SAVED =
  "Observed:\nPerrin Fennimore did not meet sales numbers for the month of October.\n\nExpectation:\nPerrin is expected to meet the monthly sales goals.\n\nGoing Forward:\nPerrin will review the sales numbers with the salon director each week.\n\nPolicy reference: Standards of Conduct Policy, JBA Policy Manual p.12";
const MEETING =
  "Observed:\nPerrin Fennimore missed the monthly meeting.\n\nExpectation:\nPerrin is expected to attend every monthly meeting.\n\nGoing Forward:\nPerrin will attend every scheduled meeting.";

function scenario(key: string, reading: unknown): RefusalScenario {
  return {
    ...STEP_B_REFUSAL_SCENARIOS.find((entry) => entry.id === "sun-monthly-meeting")!,
    id: `made-for-${key}`,
    expect: {
      says: "the edit is saved: Details are about missing the monthly meeting, not the October sales numbers, and the old account's policy line is gone",
      check: (run) => {
        const details = run.saved.coaching_details ?? "";
        if (/haven't changed|didn't change/i.test(run.reply)) return `the edit was refused: "${run.reply.slice(0, 200)}"`;
        if (!/monthly meeting/i.test(details)) return `Details are not about the monthly meeting:\n${details}`;
        if (/sales numbers/i.test(details)) return `Details still hold the old account:\n${details}`;
        if (/Standards of Conduct/i.test(details)) return `the old account's policy line is kept:\n${details}`;
        return null;
      },
    },
    script: {
      draft: { coaching_details: SAVED },
      patch: { [SUN_MEETING]: reading as never },
      revisionFrom: { [SUN_MEETING]: { coaching_details: MEETING } },
    },
  };
}

const READINGS: readonly [string, string, unknown][] = [
  ["reader-nothing", "the reader finds nothing to write", patch("this_form")],
  [
    "reader-replaces",
    "the reader replaces Details with the meeting account",
    patch("this_form", [{ field: "coaching_details", value: MEETING, how: "replace", evidence: "missing out monthly meeting" }]),
  ],
];

export const NOV10_MADE_FOR_IS_MADE_ABOUT_CASES: ReplayCase[] = READINGS.map(([key, how, reading]) => ({
  id: `nov10-made-for-is-made-about-${key}`,
  title: `QA's live Sunny r20: "${SUN_MEETING}" on a saved Coaching draft in sections with a policy line (${how}): the edit is saved, about the monthly meeting`,
  report: `QA's live Sunny r20 (10 Nov 2026, 10:40:28Z): "${SUN_MEETING}" → "I haven't changed the Coaching Form …"`,
  status: { open: "\"make it for <topic>\" is not read as a made-about, so the account is not replaced and the edit is refused" },
  fixFlags: [...STEP_B_READER_FLAGS, "MADE_FOR_IS_MADE_ABOUT_ENABLED"],
  run: (t) => play(t, scenario(key, reading)),
}));
