import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * A SECOND REQUEST FOR A DIFFERENT PERSON DOES NOT INHERIT THE FIRST PERSON'S DATE (Gate-Sunny, via QA, 11 Nov 2026)
 * ============================================================================
 *
 * "create a follow-up coaching form for Mara <X>", "October 1st", then "create a follow-up coaching form for Maria <X>":
 * Maria's card carried Mara's date. A new request for a different person starts without a date unless the manager gives
 * one for them. OPEN: a replay case only for now (QA: low priority). Both people are invented, same surname as reported.
 */
const person = (id: string, firstName: string): DirectoryRow => ({
  id,
  firstName,
  lastName: "Pelletrow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});
const MARA = person("e-mara-pelletrow", "Mara");
const MARIA = person("e-maria-pelletrow", "Maria");

const TURNS = [
  "create a follow-up coaching form for Mara Pelletrow",
  "October 1st",
  "create a follow-up coaching form for Maria Pelletrow",
];

export const NOV11_SECOND_PERSON_OWN_DATE_CASES: ReplayCase[] = [
  {
    id: "nov11-second-person-own-date",
    title: `"${TURNS[0]}", "${TURNS[1]}", then "${TURNS[2]}": Maria's card does not carry Mara's October 1 date`,
    report: "Gate-Sunny, via QA (11 Nov 2026, low priority): the second person's card inherited the first person's date",
    status: { open: "Maria's card carries Mara's date (October 1)" },
    async run(t) {
      t.directory([...STAFF, MARA, MARIA]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      for (const said of TURNS.slice(0, 2)) await thread.say(said);
      expect(thread.proposal?.formDate ?? null, "Mara's date is taken (the precondition)").toMatch(/-10-01$/);
      const card = await thread.say(TURNS[2]!);
      expect(thread.proposal?.employeeName ?? null, card.content).toBe("Maria Pelletrow");
      expect(thread.proposal?.formDate ?? null, card.content).not.toMatch(/-10-01$/);
    },
  },
];
