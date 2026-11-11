import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * QA (10 Nov 2026): RELATIVE_DATE_READER_ENABLED is live in both apps, and in the sibling app it makes "need a CA for
 * <name>. she mishandled cash at close yesterday. written warning" lose the Written level (its trailing-level rule read
 * "yesterday" as a past date). This app's level reader has no such rule and keeps Written; this case guards it with
 * production's flags. The person is invented and on the roster.
 */
const JORDAN: DirectoryRow = {
  id: "e-jordan-testperson",
  firstName: "Jordan",
  lastName: "Testperson",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** A function, not an array: the registry reads exported arrays as cases. */
export function relativeDayLevelPeople(): readonly DirectoryRow[] {
  return [JORDAN];
}

export const NOV10_RELATIVE_DAY_LEVEL_CASES: ReplayCase[] = [
  {
    id: "nov10-relative-day-keeps-written",
    title: "\"need a CA for jordan testperson. she mishandled cash at close yesterday. written warning\": the card's level is Written",
    report: "Owner retest wording (the sibling app); QA, 10 Nov 2026: RELATIVE_DATE_READER (live) loses the level there",
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
      t.directory([...STAFF, JORDAN]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("need a CA for jordan testperson. she mishandled cash at close yesterday. written warning");
      expect(thread.proposal, `no Corrective Action card:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Jordan Testperson" });
      expect((thread.proposal as { warningLevel?: string | null } | null | undefined)?.warningLevel ?? null, `the card lost the Written level:\n${reply.content}`).toBe("written");
    },
  },
];
