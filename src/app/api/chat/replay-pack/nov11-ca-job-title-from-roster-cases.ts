import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * A CORRECTIVE ACTION'S JOB TITLE IS THE ROSTER PERSON'S POSITION (QA, 11 Nov 2026; audit item 15.10 follow-up)
 * ============================================================================
 *
 * Found on sf-b5 (S#844): a Corrective Action for a roster person, named exactly as the roster has her, was created
 * with Job Title blank, though her position is on the roster ("Tanning Consultant"); the sibling app fills it from
 * Woven. QA: fill it from the roster person's position, behind CA_JOB_TITLE_FROM_ROSTER_ENABLED. Invented person.
 */
const FLAG = "CA_JOB_TITLE_FROM_ROSTER_ENABLED";
const BRISA: DirectoryRow = {
  id: "e-brisa-tolland",
  firstName: "Brisa",
  lastName: "Tolland",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Assistant Salon Director",
};

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-04T15:30:00Z"));
  t.directory([...STAFF, BRISA]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

export const NOV11_CA_JOB_TITLE_FROM_ROSTER_CASES: ReplayCase[] = [
  {
    id: "nov11-ca-job-title-from-roster",
    title: "a Corrective Action for the roster's Brisa Tolland, named exactly, has her roster position as Job Title",
    report: "QA, 11 Nov 2026 (audit item 15.10 follow-up, found on sf-b5)",
    status: { open: "the Corrective Action is created with Job Title blank, though her position is on the roster" },
    fixFlags: [FLAG],
    async run(t) {
      const thread = start(t);
      await thread.say("create a ca form for Brisa Tolland");
      const reply = await thread.say(
        "verbal warning The date she complained was Oct 31st . The customer said she was giving her an attitude at the front desk. When Brisa spoke with District manager Tobias Wrenfield she said the customer had raised her voice first and she only explained the price.",
      );
      expect(thread.proposal, `no CA card for Brisa Tolland:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Brisa Tolland" });
      t.draftWrites({ observation: "Observed:\nOn October 31, 2026 a customer reported that Brisa was rude to her at the front desk." });
      const id = await thread.create();
      expect(t.values(id).job_title ?? "", "Job Title is not her roster position").toBe("Assistant Salon Director");
    },
  },
  {
    id: "nov11-ca-job-title-from-roster-coaching-guard",
    title: "negative: a Coaching Form for the same person already has her roster position as Job Title",
    report: "QA, 11 Nov 2026 (audit item 15.10 follow-up)",
    status: "fixed",
    async run(t) {
      const thread = start(t);
      for (const turn of ["Create a coaching form.", "Brisa Tolland"]) await thread.say(turn);
      const id = await thread.create();
      expect(t.values(id).job_title ?? "", "Job Title is not her roster position").toBe("Assistant Salon Director");
    },
  },
];
