import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * Coding 4's production-flag reading (via QA, 10 Nov 2026): with RELATIVE_DATE_READER on (live), "<name> missed our
 * team meeting yesterday 10/21/26 without telling anyone. …" read two dates — "yesterday" and 10/21/26 — whenever they
 * disagree (the message sent a day or more after), and the card had no date. The typed date is the date. The manager's
 * words (corrective-action-dm-feedback-e2e); the person invented.
 */
const TESS: DirectoryRow = {
  id: "e-tess-varga",
  firstName: "Tess",
  lastName: "Varga",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** A function, not an array: the registry reads exported arrays as cases. */
export function relativeBesideTypedPeople(): readonly DirectoryRow[] {
  return [TESS];
}

export const NOV10_RELATIVE_BESIDE_TYPED_DATE_CASES: ReplayCase[] = [
  {
    id: "nov10-relative-beside-typed-date",
    title: "\"missed our team meeting yesterday 10/21/26\", sent on 10/23: the card's date is 10/21/2026, the date typed",
    report: "coding 4's production-flag reading via QA, 10 Nov 2026: no form date",
    status: { open: "\"yesterday\" (10/22) and the typed 10/21/26 disagree, and the card has no date" },
    fixFlags: ["RELATIVE_BESIDE_TYPED_DATE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-10-23T15:00:00Z"));
      t.directory([...STAFF, TESS]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(
        "Tess Varga missed our team meeting yesterday 10/21/26 without telling anyone. I want to give her a written. No payroll deduction. She was coached on attendance 8/15/26.",
      );
      expect(thread.proposal, `no Corrective Action card for Tess Varga:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Tess Varga" });
      expect(thread.proposal?.formDate ?? null, `the card's date is not the typed 10/21/26:\n${reply.content}`).toBe("2026-10-21");
    },
  },
];
