import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "THE CLEANING POLICY" IS CARE AND CLEANING (QA's ruling, 14 Nov 2026; CLEANING_POLICY_IS_CARE_AND_CLEANING)
 * ============================================================================
 *
 * Gate-Bubbles-5's side note, the same in both apps, flags off and on: "for violating the cleaning policy, she did not
 * do the sanitation" ticked no box and the card said the manual had no section for "cleaning". The manual's heading is
 * "Care and Cleaning of Equipment and Facilities" (p.21). QA's ruling: "cleaning" is the heading's own word, so the
 * phrase names it; "the sanitation policy" is not, so it is asked about under Pau's Other line. The person is invented.
 */
const REPORT = "Gate-Bubbles-5's side note via QA, 14 Nov 2026: \"the cleaning policy\" cited no section";
const ODALYS: DirectoryRow = { id: "e-odalys-brackwen-clean", firstName: "Odalys", lastName: "Brackwen", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const CARE = {
  chunkIndex: 21.5,
  chunkId: "jba-21-5",
  locator: "Page 21 — Care and Cleaning of Equipment and Facilities",
  page: 22,
  content: "Care and Cleaning of Equipment and Facilities\nEmployees keep the salon, its beds and its equipment clean and sanitized as directed.",
  section: "Care and Cleaning of Equipment and Facilities",
  printedPage: 21,
  sections: [],
};
const FLAG = "CLEANING_POLICY_IS_CARE_AND_CLEANING_ENABLED";
const CITED = /\*\*Policy:\*\* Care and Cleaning of Equipment and Facilities, as you said — the policy manual's section on page 21/;
const NO_SECTION = /does not see a section of the current policy manual for "cleaning/;

async function card(t: ReplayContext, said: string): Promise<string> {
  vi.setSystemTime(new Date("2026-11-14T05:00:00Z"));
  t.directory([...STAFF, ODALYS]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([CARE]);
  return (await t.thread().say(said)).content;
}

export const NOV14_CLEANING_POLICY_CASES: ReplayCase[] = [
  ...(
    [
      ["cleaning-policy", "create a ca for Odalys Brackwen for violating the cleaning policy, she did not do the sanitation"],
      ["cleaning-duties-policy", "create a ca for Odalys Brackwen for violating the cleaning duties policy, she did not do the sanitation"],
    ] as const
  ).map(([slug, said]): ReplayCase => ({
    id: `nov14-cleaning-policy-${slug}`,
    title: `"${said}": cites Care and Cleaning of Equipment and Facilities p.21, as "care and cleaning policy" does`,
    report: REPORT,
    status: { open: 'the card says the manual has no section for "cleaning"' },
    fixFlags: [FLAG],
    async run(t) {
      const reply = await card(t, said);
      expect(reply, `"no section for cleaning":\n${reply}`).not.toMatch(NO_SECTION);
      expect(reply, `Care and Cleaning p.21 not cited:\n${reply}`).toMatch(CITED);
    },
  })),
  {
    id: "nov14-cleaning-policy-sanitation-asks",
    title: '"…violating the sanitation policy, she did not do the sanitation": Pau\'s Other line, and "Did you mean Care and Cleaning … (page 21)?"',
    report: `${REPORT}: QA's ruling (b) for a word that is not the heading's`,
    status: { open: "Other, with no question about Care and Cleaning" },
    fixFlags: [FLAG],
    async run(t) {
      const reply = await card(t, "create a ca for Odalys Brackwen for violating the sanitation policy, she did not do the sanitation");
      expect(reply, `the Other line:\n${reply}`).toMatch(/\*\*Policy:\*\* Other — cleaning duties left undone/);
      expect(reply, `no question:\n${reply}`).toMatch(/Did you mean \*\*Care and Cleaning of Equipment and Facilities\*\* \(page 21\)\?/);
      expect(reply, "cited outright").not.toMatch(CITED);
    },
  },
  {
    id: "nov14-cleaning-policy-described-stays-other",
    title: 'guard: "…she did not do the sanitation" names no policy, so it stays Pau\'s Other, with no question',
    report: `${REPORT}: guard`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const reply = await card(t, "create a ca for Odalys Brackwen, she did not do the sanitation");
      expect(reply, `the Other line:\n${reply}`).toMatch(/\*\*Policy:\*\* Other — cleaning duties left undone/);
      expect(reply).not.toMatch(/Did you mean/);
      expect(reply).not.toMatch(CITED);
    },
  },
];
