import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * NO ACCOUNT, NO POLICY "READ FROM THIS REQUEST" (QA's Sunny flip-9 live tester, 8 Nov 2026)
 * ============================================================================
 *
 * Live, with flip 7 (AS_YOU_SAID_MANAGER_WORDS, AS_YOU_SAID_APP_READ) and flip 9 (BARE_NOT_AFTER_REQUEST) on:
 * "ca for <A> not late" asked "You haven't told me what happened yet" — and the same card said
 * "**Policy:** Attendance — read from this request" for the fault the manager denied. The person is invented.
 *
 * Beside it the card cited "Attendance Policy, JBA Policy Manual p.14" and an Action Plan to "review the Attendance
 * policy". QA (8 Nov 2026): no account, so no policy is cited anywhere on that card.
 *
 * production-flags.json does not list flips 7 and 9 yet, so every flag production runs from them (QA's full flip-9
 * list) is named in fixFlags.
 */
const ASKS = /haven'?t told me what happened/i;
const LIVE = [
  "AS_YOU_SAID_APP_READ_ENABLED",
  "AS_YOU_SAID_MANAGER_WORDS_ENABLED",
  "CLEANING_OTHER_EVERY_WORDING_ENABLED",
  "COACHING_OBSERVED_KEPT_ENABLED",
  "FORM_EDIT_SAID_REPLACEMENT_ENABLED",
  "FORM_EDIT_SINGLE_WRITER_ENABLED",
  "FORM_PATCH_READER_FIXES_ENABLED",
  "FORM_PATCH_REDUCER_ENABLED",
  "FORM_REPLY_FROM_DIFF_ENABLED",
  "MSB_PHRASE_SOC_ENABLED",
  "NO_NOTICE_NO_DATE_ENABLED",
  "OWN_BRAND_ONLY_ENABLED",
  "POLITE_REQUEST_OWN_TURNS_ENABLED",
  "PRIOR_STEP_PREVIOUSLY_ENABLED",
  "REMOVE_POLICY_NOT_NAMED_ENABLED",
  "TWO_FORMS_OWN_PERSON_ENABLED",
  "UNDER_PERFORMANCE_EXPLAINED_ENABLED",
  "OBSERVATION_NO_LEVEL_LEAD_ENABLED",
  "BARE_NOT_AFTER_REQUEST_ENABLED",
  "REQUEST_KEPT_IN_WINDOW_ENABLED",
  "STALE_PROMPT_LINES_OFF_ENABLED",
  "PRIOR_ACTIONS_NO_SIGNED_ENABLED",
  "PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED",
  "SAME_FORM_COPY_NEW_PERSON_ENABLED",
  "METRIC_CHOICE_ONE_QUESTION_ENABLED",
  "COMPLAINT_ACCOUNT_ENABLED",
  "CITATION_LINE_KEPT_ON_REVISION_ENABLED",
  "EDIT_MAKE_IT_ABOUT_ENABLED",
  "CA_ASKS_WHAT_HAPPENED_ENABLED",
  "BARE_NOT_DENIAL_ENABLED",
  "CA_SALES_POLICY_ENABLED",
];

async function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV8_NO_ACCOUNT_NO_APP_POLICY_CASES: ReplayCase[] = [
  {
    id: "nov8-no-account-no-app-policy-ca-for-not-late",
    title: "\"ca for <A> not late\": the card asks what happened, and reads no policy from the request",
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (1): \"Policy: Attendance — read from this request\" beside the ask",
    // Changed on purpose (8 Nov 2026): fixed in production by NO_ACCOUNT_NO_APP_POLICY_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: [...LIVE, "NO_ACCOUNT_NO_APP_POLICY_ENABLED"],
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say("ca for Rowan Kestrel not late");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      expect(reply.content, `drafted with no account:\n${reply.content}`).toMatch(ASKS);
      expect(reply.content, `a policy read from a denied fault:\n${reply.content}`).not.toMatch(/read from this request/i);
      expect(reply.content, `a manual citation with no account:\n${reply.content}`).not.toMatch(/JBA Policy Manual p\.\d/);
      expect(reply.content, `the Action Plan names a policy:\n${reply.content}`).not.toMatch(/review the attendance polic/i);
      expect((reply as { citations?: unknown[] }).citations ?? [], "the reply's citations").toEqual([]);
    },
  },
  {
    id: "nov8-no-account-no-app-policy-late-opening-keeps-reading",
    title: "\"make me a CA for <A> for being late to opening this morning\": an account keeps the app's Policy line",
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (1), its guard: nov7-as-you-said-app-read-late-opening",
    status: "fixed",
    fixFlags: [...LIVE, "NO_ACCOUNT_NO_APP_POLICY_ENABLED"],
    async run(t) {
      const thread = await start(t);
      const reply = await thread.say("make me a CA for Remy Calder for being late to opening this morning");
      expect(reply.content, `asked with an account:\n${reply.content}`).not.toMatch(ASKS);
      expect(reply.content, `the card has no Policy line:\n${reply.content}`).toMatch(/^\*\*Policy:\*\*[^\n]+$/m);
    },
  },
];
