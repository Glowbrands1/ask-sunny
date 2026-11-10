import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * QA, 10 Nov 2026 (coding 6's B1 triage, sf-b5): "Delphine Marlwoe Ostrander" — two letters swapped in the MIDDLE
 * word — was not matched to the roster's "Delphine Marlowe Ostrander" (a two-word first name) even with every
 * ROSTER_* flag on. The fix: ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED, with the roster name set. Invented person.
 */
const FLAGS = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_COMPOUND_FIRST_NEAR_MISS_ENABLED",
];

const DELPHINE: DirectoryRow = {
  id: "e-delphine-marlowe-ostrander",
  firstName: "Delphine Marlowe",
  lastName: "Ostrander",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const NAME = "Delphine Marlowe Ostrander";

export const NOV10_SF_B5_MIDDLE_NAME_SWAP_CASES: ReplayCase[] = [
  {
    id: "nov10-sf-b5-middle-name-swap",
    title: "\"Delphine Marlwoe Ostrander\" (swapped letters in the middle word): the card is Delphine Marlowe Ostrander's, or the reply offers her",
    report: "QA, 10 Nov 2026 (coding 6's B1 triage, sf-b5)",
    status: { open: "with production's flags the card keeps the typed \"Delphine Marlwoe Ostrander\"" },
    fixFlags: FLAGS,
    async run(t) {
      t.directory([...STAFF, DELPHINE]);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say("create a ca form for Delphine Marlwoe Ostrander, they were late opening the salon on 11/2");
      const card = thread.proposal?.employeeName ?? null;
      expect(card === NAME || reply.content.includes(`**${NAME}**`), `${NAME} is neither on the card (${JSON.stringify(card)}) nor offered:\n${reply.content}`).toBe(true);
      expect(card, "the misspelling is never filled as typed").not.toBe("Delphine Marlwoe Ostrander");
    },
  },
];
