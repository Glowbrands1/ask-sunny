import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * sf-s35: A CA REQUEST OPENED A COACHING FORM (Pau's scan, 7 Nov 2026)
 * ============================================================================
 *
 * A manager, live on 6 Nov 2026, word for word (the employee invented): "Can you draw me up a CA for <name> for
 * being late on 10/23/26. <first> has signed a coaching document for being late on 10/14/26. I need you to make
 * sure the policy is on this CA." The card was a Coaching Form: the earlier coaching the manager mentioned as
 * history was read as the form asked for. CA_REQUEST_NOT_PRIOR_COACHING_ENABLED.
 */

const WRENNA: DirectoryRow = {
  id: "e-wrenna-calloway",
  firstName: "Wrenna",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function s35People(): readonly DirectoryRow[] {
  return [WRENNA];
}

const SAID =
  "Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26. Wrenna has signed a coaching document for being late on 10/14/26. I need you to make sure the policy is on this CA.";

/** QA's live tester's message (7 Nov 2026): sf-s35's first two sentences, word for word (the employee invented). */
const TESTER_SAID = "Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26. Wrenna has signed a coaching document for being late on 10/14/26.";

export const NOV7_S35_CA_NOT_PRIOR_COACHING_CASES: ReplayCase[] = [
  {
    id: "nov7-s35-ca-not-prior-coaching",
    title: "sf-s35: \"Can you draw me up a CA for <name> … has signed a coaching document …\" opens a Corrective Action card, not a Coaching Form",
    report: "Pau's morning scan, 7 Nov 2026 (sf-s35; live chat 6 Nov 2026)",
    status: { open: "the card is a Coaching Form: the earlier coaching is read as the form asked for" },
    fixFlags: ["CA_REQUEST_NOT_PRIOR_COACHING_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T14:18:00Z"));
      t.directory([...STAFF, WRENNA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal, `the card is not a Corrective Action Form:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wrenna Calloway" });
    },
  },
  {
    id: "nov7-s35-live-draw-me-up-ca",
    title: "s35 live tester: \"Can you draw me up a CA for <name> … has signed a coaching document …\" (two sentences) opens a Corrective Action card",
    report: "QA's live tester, 7 Nov 2026 (s35 rolled back at 00:22): no card, \"I can't write out the Corrective Action text here…\"",
    // In production (s35 off) no card opens either: "Can you …" reads as a question (`ai/question-not-form.ts`).
    status: { open: "\"Can you draw me up …\" reads as a question, and \"draw me up\" asks for no form, so no card opens" },
    fixFlags: ["CA_REQUEST_NOT_PRIOR_COACHING_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T14:18:00Z"));
      t.directory([...STAFF, WRENNA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(TESTER_SAID);
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Wrenna Calloway" });
      expect(reply.content, "a refusal").not.toMatch(/can['’]t (?:write out|draft)/i);
    },
  },
];
