import { expect, vi } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase, type ReplayContext } from "./cases";
import { REFUSAL_ROSTER, STEP_B_READER_FLAGS, patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * AN ADDED LINE WENT AFTER "GOING FORWARD", AND THE SECTIONS LOST THEIR BLANK LINES (ported from Ask Bubbles,
 * 11 Nov 2026; STEP_B_ADD_UNDER_OBSERVED_ENABLED, STEP_B_SECTION_SPACING_ENABLED)
 * ============================================================================
 *
 * QA's live draft test on Ask Bubbles production (Coaching Form v1, 8 Nov 2026; `nov8-step-b-outline-cases.ts` there):
 * on a Details of Coaching written "Observed: … / Expectation: … / Going Forward: …", "add to the details that she was
 * reminded about the meeting twice" was appended after "Going Forward". Here (11 Nov 2026, production's flags) it went
 * after the "Policy reference:" line as well, and the whole-text shape lost the blank lines between the sections. The
 * reader's two shapes are scripted. `nov8-step-b-outline-cases.ts` covers the sections; these cases add the "Policy
 * reference:" line this app writes under the plan. The person is invented (the refusal roster's).
 */
const SAID = "add to the details that she was reminded about the meeting twice";
const REQUEST = "create a coaching form for Ottoline Ormsworth, she missed the monthly meeting on 10/10/26";
const DETAILS =
  "Observed:\nOttoline Ormsworth missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline is expected to attend every scheduled meeting.\n\nGoing Forward:\nOttoline will put every scheduled meeting on her calendar.";
const ADDED = "She was reminded about the meeting twice.";
const FIX = [...STEP_B_READER_FLAGS, "STEP_B_ADD_UNDER_OBSERVED_ENABLED", "STEP_B_SECTION_SPACING_ENABLED"];
const REPORT = "Ported from Ask Bubbles (QA's live draft test, 8 Nov 2026): an added line went after \"Going Forward\"; blank lines collapsed";

async function run(t: ReplayContext, reading: (saved: string) => unknown): Promise<string> {
  vi.setSystemTime(new Date("2026-11-07T19:40:00Z"));
  t.directory(REFUSAL_ROSTER);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(REQUEST);
  t.draftWrites({ coaching_details: DETAILS });
  const id = await thread.create();
  t.patchReads!({ [SAID]: reading(t.values(id).coaching_details ?? "") });
  const before = savedForm(t, id);
  const reply = await thread.say(SAID);
  replyMatchesDiff(t, id, before, reply, SAID);
  return t.values(id).coaching_details ?? "";
}

function underObserved(details: string): void {
  const observed = details.split(/\n\s*Expectation:/)[0] ?? "";
  expect(observed, `the added line is not under Observed:\n${details}`).toContain(ADDED);
  expect(details.split(/Going Forward:/)[1] ?? "", `the added line is under Going Forward:\n${details}`).not.toContain(ADDED);
}

/** Ask Sunny's Details end with the cited policy line; the added line goes above it and it stays. */
function aboveThePolicyLine(details: string): void {
  const policy = details.search(/\n\s*Policy reference:/);
  expect(policy, `the policy reference line is gone:\n${details}`).toBeGreaterThan(0);
  expect(details.indexOf(ADDED), `the added line is after the policy reference:\n${details}`).toBeLessThan(policy);
}

function spaced(details: string): void {
  expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nExpectation:/);
  expect(details, `the sections lost their blank lines:\n${details}`).toMatch(/\n\nGoing Forward:/);
}

export const NOV11_STEP_B_ADD_UNDER_OBSERVED_CASES: ReplayCase[] = [
  {
    id: "nov11-step-b-add-above-policy-reference",
    title: "\"add to the details that she was reminded about the meeting twice\" (the reader adds the line): under Observed, above the \"Policy reference:\" line",
    report: REPORT,
    status: { open: "the added line is written after the \"Policy reference:\" line" },
    fixFlags: FIX,
    async run(t) {
      const details = await run(t, () => patch("this_form", [{ field: "coaching_details", value: ADDED, how: "add", evidence: "she was reminded about the meeting twice" }]));
      underObserved(details);
      spaced(details);
      aboveThePolicyLine(details);
      expect(details, "the account lost its words").toMatch(/missed the monthly meeting on 10\/10\/26/);
    },
  },
  {
    id: "nov11-step-b-whole-text-tail-above-policy-reference",
    title: "…the reader writes the whole text with the line on the end: under Observed, above the \"Policy reference:\" line, blank lines kept",
    report: REPORT,
    status: { open: "the saved Details have the line after the \"Policy reference:\" line" },
    fixFlags: FIX,
    async run(t) {
      const details = await run(t, (saved) =>
        patch("this_form", [{ field: "coaching_details", value: `${saved.replace(/\n\n/g, "\n")}\n${ADDED}`, how: "replace", evidence: "she was reminded about the meeting twice" }]),
      );
      underObserved(details);
      spaced(details);
      aboveThePolicyLine(details);
    },
  },
];
