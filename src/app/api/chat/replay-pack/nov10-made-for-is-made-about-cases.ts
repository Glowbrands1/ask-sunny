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

function scenario(key: string, reading: unknown, said: string = SUN_MEETING): RefusalScenario {
  const base = STEP_B_REFUSAL_SCENARIOS.find((entry) => entry.id === "sun-monthly-meeting")!;
  return {
    ...base,
    id: `made-for-${key}`,
    refused: said,
    steps: [...base.steps.slice(0, -1), { say: said }],
    expect: {
      says: "the edit is saved: Details are about missing the monthly meeting, not the October sales numbers, and the old account's policy line is gone",
      check: (run) => {
        const details = run.saved.coaching_details ?? "";
        if (/haven't changed|didn't change/i.test(run.reply)) return `the edit was refused: "${run.reply.slice(0, 200)}"`;
        if (!/monthly meeting/i.test(details)) return `Details are not about the monthly meeting:\n${details}`;
        if (/sales numbers/i.test(details)) return `Details still hold the old account:\n${details}`;
        if (/Standards of Conduct/i.test(details)) return `the old account's policy line is kept:\n${details}`;
        // QA (10 Nov 2026): Pau's exact words, "missing out monthly meeting", are the account and the topic.
        if (!/monthly meeting/i.test(run.saved.other_topic ?? "")) return `Other is not the monthly meeting: "${run.saved.other_topic ?? ""}"`;
        return null;
      },
    },
    script: {
      draft: { coaching_details: SAVED },
      patch: { [said]: reading as never },
      revisionFrom: { [said]: { coaching_details: MEETING } },
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

/** QA's live probe (Sunny r20, same saved shape): "make it about missing the monthly meeting" worked. "missing out" with "about": the same. */
const ABOUT_MISSING_OUT = "can you make it about missing out monthly meeting";

export const NOV10_MADE_FOR_ABOUT_MISSING_OUT_CASES: ReplayCase[] = [
  {
    id: "nov10-made-for-is-made-about-about-missing-out",
    title: `QA's live Sunny r20 probe: "${ABOUT_MISSING_OUT}" on the same saved draft (the reader replaces Details): saved, about the monthly meeting, Other the meeting`,
    report: "QA's live Sunny r20 probe (10 Nov 2026): \"make it about missing the monthly meeting\" worked; Pau's \"missing out monthly meeting\" must read as the account too",
    status: "fixed",
    fixFlags: [...STEP_B_READER_FLAGS, "MADE_FOR_IS_MADE_ABOUT_ENABLED"],
    run: (t) =>
      play(
        t,
        scenario(
          "about-missing-out",
          patch("this_form", [{ field: "coaching_details", value: MEETING, how: "replace", evidence: "missing out monthly meeting" }]),
          ABOUT_MISSING_OUT,
        ),
      ),
  },
];

export const NOV10_MADE_FOR_IS_MADE_ABOUT_CASES: ReplayCase[] = READINGS.map(([key, how, reading]) => ({
  id: `nov10-made-for-is-made-about-${key}`,
  title: `QA's live Sunny r20: "${SUN_MEETING}" on a saved Coaching draft in sections with a policy line (${how}): the edit is saved, about the monthly meeting`,
  report: `QA's live Sunny r20 (10 Nov 2026, 10:40:28Z): "${SUN_MEETING}" → "I haven't changed the Coaching Form …"`,
  status: { open: "\"make it for <topic>\" is not read as a made-about, so the account is not replaced and the edit is refused" },
  fixFlags: [...STEP_B_READER_FLAGS, "MADE_FOR_IS_MADE_ABOUT_ENABLED"],
  run: (t) => play(t, scenario(key, reading)),
}));
