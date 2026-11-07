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
];
