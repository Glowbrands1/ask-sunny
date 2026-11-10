import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "<NAME> WAS LATE ON 10-20-26, VERBAL CA" IS A REQUEST FOR A VERBAL CA (QA, live tester, 7 Nov 2026)
 * ============================================================================
 *
 * The manager's words (the employee invented): "my team member <name> was late on 10-20-26, verbal ca" in the sibling
 * app gave no card there (LEVEL_ENDS_REQUEST_ENABLED). Here, with this app's wording ("my tanning consultant …"),
 * the warning reader already reads the closing level as this form's: a guard, so it stays that way.
 */

const WRENNA: DirectoryRow = {
  id: "e-wrenna-calloway-level",
  firstName: "Wrenna",
  lastName: "Calloway",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

export const NOV7_LEVEL_ENDS_REQUEST_CASES: ReplayCase[] = [
  {
    id: "nov7-level-ends-request",
    title: "\"my team member <name> was late on 10-20-26, verbal ca\" opens a Corrective Action card, Verbal Warning",
    report: "QA, live tester in the sibling app, 7 Nov 2026 (checked here)",
    // A guard here: this app's warning reader already reads the closing level (the sibling app's did not).
    status: "fixed",
    async run(t) {
      vi.setSystemTime(new Date("2026-11-06T14:00:00Z"));
      t.directory([...STAFF, WRENNA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("my tanning consultant Wrenna Calloway was late on 10-20-26, verbal ca");
      expect(thread.proposal, "no CA card for Wrenna Calloway").toMatchObject({ templateKey: "dpoa", employeeName: "Wrenna Calloway" });
      expect(reply.content, "the card does not say Verbal Warning").toMatch(/Verbal Warning/);
      t.draftWrites({ observation: "Observed:\nWrenna Calloway was late on 10/20/2026." });
      const id = await thread.create();
      expect(t.checked(id).warning_type ?? [], "Verbal Warning is not ticked").toContain("verbal");
    },
  },
];
