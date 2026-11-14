import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { patch } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "CHANGE THE ISSUE TO <SENTENCE> ON <DATE>" CHANGES THE ACCOUNT, NOT ONLY THE DATE (ISSUE_EDIT_IS_THE_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * Port of Ask Bubbles' case (v2-Gate-Bubbles-5's probes on Ask Bubbles main, via QA, 14 Nov 2026), in the gate's own words; the same three layers are in this app. On a saved Corrective
 * Action for lateness on 11/3/26:
 *   (1) "change the issue to she was texting on her cell phone the whole shift on Nov 4th" changed ONLY the date (form
 *       date and the account's date → 11/04/2026). The new account was dropped silently; the reply named only the date.
 *   (2) "change the issue to she was texting on her cell phone the whole shift on 11/3/26" (the form's own date) replied
 *       "… already has 11/03/2026 as the incident date. Nothing needed changing." and the new account was dropped.
 * The CA's date reader (`forms/ca-chat-corrections.ts`) takes any turn with a date in it, and answers the date alone.
 * Expected: the account becomes the new sentence, the date changes only if it differs, and the reply names both. Same
 * with every new flag off, so pre-existing. The person is the pack's invented one.
 */

const LATE = "create ca form for marnie holloway for violating attendance policy, she was late on 11/3/26. verbal. no payroll deduct.";
const NEW_DATE = "change the issue to she was texting on her cell phone the whole shift on Nov 4th";
const SAME_DATE = "change the issue to she was texting on her cell phone the whole shift on 11/3/26";
const REPORT = "Ported from Ask Bubbles: v2-Gate-Bubbles-5's probes on its main, via QA (14 Nov 2026): \"change the issue to she was texting on her cell phone the whole shift on Nov 4th\" changed only the date; \"… on 11/3/26\" replied \"Nothing needed changing\"";
const FLAG = "ISSUE_EDIT_IS_THE_ACCOUNT_ENABLED";

const TEXTING = (date: string) =>
  patch("this_form", [
    {
      field: "observation",
      value: `Observed:\nMarnie Holloway was texting on her cell phone the whole shift on ${date}.`,
      how: "replace",
      evidence: "she was texting on her cell phone the whole shift",
    },
  ]);

async function lateCa(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(LATE);
  t.draftWrites({ observation: "Observed:\nMarnie Holloway was late on November 3, 2026." });
  const id = await thread.create();
  expect(t.values(id).observation ?? "", "the lateness draft").toMatch(/late on November 3, 2026/);
  return { thread, id };
}

export const NOV14_ISSUE_EDIT_IS_THE_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov14-issue-edit-is-the-account-new-date",
    title: `"${LATE}" then "${NEW_DATE}": the account becomes the texting, the date becomes 11/4, and the reply names both`,
    report: REPORT,
    status: { open: "only the date changes (form date and the account's date → 11/04/2026); the texting account is dropped and the reply names the date alone" },
    fixFlags: [FLAG],
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({ [NEW_DATE]: TEXTING("November 4, 2026") });
      const reply = await thread.say(NEW_DATE);
      const observation = t.values(id).observation ?? "";
      expect(observation, `the account was not replaced:\n${reply.content}`).toMatch(/texting on her cell phone the whole shift/i);
      expect(observation, "the lateness account stayed").not.toMatch(/\blate on\b/i);
      expect(t.values(id).form_date ?? "", "the form's date did not follow the new date").toBe("2026-11-04");
      expect(reply.content, "the reply does not name the account change").toMatch(/Observation of Offense/i);
      expect(reply.content, "the reply does not name the date").toMatch(/11\/0?4\/2026|November 4, 2026/);
    },
  },
  {
    id: "nov14-issue-edit-is-the-account-same-date",
    title: `"${LATE}" then "${SAME_DATE}": the account becomes the texting, the date stays, and the reply never says nothing changed`,
    report: REPORT,
    // Holds on this app's production flags already (unlike Ask Bubbles, where it was OPEN): kept as a guard for the fix.
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { thread, id } = await lateCa(t);
      t.patchReads!({ [SAME_DATE]: TEXTING("November 3, 2026") });
      const reply = await thread.say(SAME_DATE);
      const observation = t.values(id).observation ?? "";
      expect(reply.content, "the reply says nothing changed").not.toMatch(/Nothing needed changing/i);
      expect(observation, `the account was not replaced:\n${reply.content}`).toMatch(/texting on her cell phone the whole shift/i);
      expect(observation, "the lateness account stayed").not.toMatch(/\blate on\b/i);
      expect(t.values(id).form_date ?? "", "the form's date moved").toBe("2026-11-03");
      expect(reply.content, "the reply does not name the account change").toMatch(/Observation of Offense/i);
    },
  },
];
