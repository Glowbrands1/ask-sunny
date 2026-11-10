import { expect } from "vitest";

import { STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * QA, 10 Nov 2026 (the sibling app's s14 path 2): a name typed with a slip and corrected ("rozline quellmar" → "Oops,
 * it's Rozlyn quellmar"), then "create a follow-up coaching form for rozlyn quellmar". In the sibling app the card for
 * that request lost the date given earlier (`turnsAboutThisForm` reads the misspelled turn as another person). Here the
 * stored form state carries the date, so it holds with production's flags: a guard, so a change to that state does not
 * bring the loss here. TYPO_CORRECTED_SAME_PERSON_ENABLED (default off) is the sibling's fix; its protected
 * ai/form-proposal.ts lines wait on Pau (docs/patches/typo-corrected-same-person.patch). Invented person.
 */
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
const ROZLYN: DirectoryRow = {
  id: "e-rozlyn-quellmar",
  firstName: "Rozlyn",
  lastName: "Quellmar",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0462"],
  positionName: "Tanning Consultant",
};

export const NOV10_TYPO_CORRECTED_SAME_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov10-typo-corrected-same-person-keeps-date",
    title: "after \"Oops, it's Rozlyn quellmar\", the next follow-up coaching request for her keeps the date given earlier",
    report: "QA, 10 Nov 2026: the sibling app's s14 path 2",
    status: "fixed",
    async run(t) {
      t.directory([...STAFF, ROZLYN]);
      t.as("salon_director", GLOBAL);
      const thread = t.thread();
      for (const said of [
        "help me create a coaching form",
        "October 1st",
        "ok, create a follow-up coaching form for rozline quellmar. i trained her on the new promo and we roleplayed a couple objections",
        "Oops, it's Rozlyn quellmar",
        "create a follow-up coaching form for rozlyn quellmar",
      ]) await thread.say(said);
      expect(thread.proposal?.employeeName ?? null).toBe("Rozlyn Quellmar");
      expect(thread.proposal?.formDate ?? null, "the date given on turn 2 is kept").toMatch(/-10-01$/);
    },
  },
];
