import type { ReplayCase } from "./cases";
import { play } from "./nov7-step-b-refusals-cases";
import { STEP_B_READER_FLAGS, STEP_B_REFUSAL_SCENARIOS, SUN_LATE, patch, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "PLEASE LIST THE POLICY" IN AN EDIT IS NEVER SILENTLY IGNORED (QA's live run, 7 Nov 2026)
 * ============================================================================
 *
 * QA's live AI check (Sonnet 5, 2×) of the sibling app's "I need you to make it about showing up late and please list
 * the policy make the date for 10/14/26." on an open Coaching Form: Details became "Showing up late", the Date stayed
 * 10/14/26, and the reply ("Changed Details of Coaching to …") said nothing about the policy, with
 * EDIT_MAKE_IT_ABOUT off and on. EDIT_POLICY_ASK_ENABLED (`forms/edit-policy-ask.ts`): the patch reader says the
 * message asks for the policy (`policy_asked`), and the app lists it from the manual as its own "Policy reference"
 * line, or says it found none and asks which applies. The wording is the manager's, exact; the employee invented.
 *
 * Not here: "please list the policy" as the whole message is answered by the route's policy answer before the
 * edit path runs (a grounded answer from the manual, so the ask is not ignored); listing it on the form from that
 * turn is a separate change.
 */

const lateDate = STEP_B_REFUSAL_SCENARIOS.find((scenario) => scenario.id === "sun-late-date")!;
const FLAGS = [...STEP_B_READER_FLAGS, "EDIT_POLICY_ASK_ENABLED"];
const POLICY_LINE = /Policy reference:\s*[^\n]*JBA Policy Manual/i;
const SAYS_POLICY = /\bpolic(?:y|ies)\b/i;

const NOT_ASKED = "I need you to make it about showing up late and make the date for 10/14/26.";

const SCENARIOS: readonly (RefusalScenario & { readonly status: ReplayCase["status"] })[] = [
  {
    ...lateDate,
    id: "sun-late-date",
    // Changed on purpose (8 Nov 2026): fixed in production by EDIT_POLICY_ASK_ENABLED, QA round 4, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    expect: {
      says: "Details is about showing up late with the manual's policy line, the Date stays 2026-10-14, and the reply says the policy was listed",
      check: (run) =>
        !/\blate\b/i.test(run.saved.coaching_details ?? "")
          ? `Details is not about showing up late: "${(run.saved.coaching_details ?? "").slice(0, 160)}"`
          : !POLICY_LINE.test(run.saved.coaching_details ?? "")
            ? `no policy line on Details: "${(run.saved.coaching_details ?? "").slice(0, 160)}"`
            : run.saved.form_date && run.saved.form_date !== "2026-10-14"
              ? `the Date is ${run.saved.form_date}`
              : !/Listed the policy/i.test(run.reply)
                ? `the reply does not say the policy was listed: "${run.reply.slice(0, 200)}"`
                : null,
    },
    script: {
      patch: {
        [SUN_LATE]: {
          ...patch("this_form", [{ field: "coaching_details", value: "Thaddeus showed up late.", how: "replace", evidence: "make it about showing up late" }]),
          policy_asked: true,
        } as never,
      },
    },
  },
  {
    ...lateDate,
    id: "not-asked",
    refused: NOT_ASKED,
    steps: [lateDate.steps[0]!, lateDate.steps[1]!, { say: NOT_ASKED }],
    status: "fixed",
    expect: {
      says: "control: no policy asked, no policy line added and no policy sentence",
      check: (run) =>
        POLICY_LINE.test(run.saved.coaching_details ?? "")
          ? `a policy line nobody asked for: "${(run.saved.coaching_details ?? "").slice(0, 160)}"`
          : SAYS_POLICY.test(run.reply)
            ? `the reply talks about a policy nobody asked for: "${run.reply.slice(0, 200)}"`
            : null,
    },
    script: {
      patch: {
        [NOT_ASKED]: {
          ...patch("this_form", [{ field: "coaching_details", value: "Thaddeus showed up late.", how: "replace", evidence: "make it about showing up late" }]),
          policy_asked: false,
        } as never,
      },
    },
  },
];

export const NOV7_EDIT_POLICY_ASK_CASES: readonly ReplayCase[] = SCENARIOS.map(
  (scenario): ReplayCase => ({
    id: `nov7-edit-policy-ask-${scenario.id}`,
    title: `"${scenario.refused}" — ${scenario.expect.says}`,
    report: "QA's live AI check, 7 Nov 2026 (Sonnet 5, 2×): sun-late-date's \"please list the policy\" ignored with and without EDIT_MAKE_IT_ABOUT",
    status: scenario.status,
    fixFlags: FLAGS,
    run: (t) => play(t, scenario),
  }),
);
