import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * CITATION_PAGE_AGREES (QA's ruling (b), 10 Nov 2026; Pau left the pick to QA): the cash-drawer CA card cites the
 * Standards of Conduct on p.13 everywhere. With production's flags (ONE_CARD_ONE_PAGE off) and the slot model reading the
 * heading "Standards of Conduct", as live, the card read "**Standards of Conduct** (page 13)" on its Policy line and
 * "Standards of Conduct Policy, JBA Policy Manual p.12" under it. The managers' wording is from QA's Sunny round-9 cash-drawer
 * cases (`nov9-one-card-one-page-cases.ts`); the person is invented. Sales / MSB keeps p.12.
 */
const CORWIN: DirectoryRow = {
  id: "e-corwin-ashgrove",
  firstName: "Corwin",
  lastName: "Ashgrove",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};
const LINES = {
  chunkIndex: 39.5,
  chunkId: "jba-39-5",
  locator: "Page 13 — Standards of Conduct",
  page: 14,
  content: "o Register / Bank shortages that are not explained\no Unapproved absence from the work area during a shift",
  section: "Standards of Conduct",
  printedPage: 13,
  sections: [],
};
const REPORT = "QA, 10 Nov 2026 (ruling (b)): a cash-drawer CA card cites \"… JBA Policy Manual p.12\" under \"Standards of Conduct (page 13)\"";
const FIX = ["CITATION_PAGE_AGREES_ENABLED"];

async function cardFor(t: ReplayContext, said: string) {
  vi.setSystemTime(new Date("2026-11-09T09:00:00Z"));
  t.directory([...STAFF, CORWIN]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.([LINES]);
  t.slotsRead({ employee: "Corwin Ashgrove", formType: "Corrective Action Form", formTurn: true, policyHeading: "Standards of Conduct" });
  return (await t.thread().say(said)).content;
}

export const NOV10_CITATION_PAGE_AGREES_CASES: ReplayCase[] = [
  {
    id: "nov10-citation-page-agrees-cash-drawer",
    title: "\"create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3\": the citation line is p.13, never p.12",
    report: REPORT,
    status: { open: "the citation line reads p.12 under a page-13 Policy line" },
    fixFlags: FIX,
    async run(t) {
      const content = await cardFor(t, "create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3");
      expect(content, content).toMatch(/\*\*Standards of Conduct\*\* \(page 13\)/);
      expect(content, content).toMatch(/^Standards of Conduct Policy, JBA Policy Manual p\.13$/m);
      expect(content, content).not.toMatch(/JBA Policy Manual p\.12/);
    },
  },
  {
    id: "nov10-citation-page-agrees-msb-keeps-p12",
    title: "negative: \"… he did not meet his MSB goal this week\": a Sales / MSB CA keeps Standards of Conduct p.12",
    report: `${REPORT} (the condition)`,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const content = await cardFor(t, "create a corrective action for Corwin Ashgrove, he did not meet his MSB goal this week");
      expect(content, content).toMatch(/^Standards of Conduct Policy, JBA Policy Manual p\.12$/m);
    },
  },
];
