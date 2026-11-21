import { describe, expect, it } from "vitest";

import production from "@/test/fixtures/jba-manual-production-151.json";

import { accountPassage } from "./account-passage";

/*
 * QA2 (21 Nov 2026), a regression from #1146 live on main 3b0038f4 (the person invented): "ca for <P>, she was 40 minutes
 * late on 11/18, this is the third time in two months, I've had two verbal talks with her already, and a customer said
 * they won't come back because nobody was at the desk", the card citing Attendance p.14, saved the LATE OPENING paragraph
 * as Direct policy. "Attendance" is a plain heading: its text ends where the manual's next heading ("Late Opening") starts.
 * Only a heading printed as a list ("All Locations Dress Code:") runs on into the chunks of its sub-items.
 */
type Row = (typeof production.chunks)[number];
const rows = (from: number, to: number) =>
  production.chunks
    .filter((row: Row) => row.chunk_index >= from && row.chunk_index <= to)
    .map((row: Row) => ({ chunkIndex: row.chunk_index, chunkId: `jba-${row.chunk_index}`, locator: row.locator, page: row.page, printedPage: row.metadata.printedPage, section: row.section, sections: row.metadata.sections, content: row.content }));

const LATE = "Remy was 40 minutes late on 11/18, this is the third time in two months. A customer said they won't come back because nobody was at the desk.";

describe("accountPassage: a plain heading ends at the next heading (QA2, #1146 regression)", () => {
  it("lateness under Attendance quotes Attendance's own text, never Late Opening's", () => {
    const quoted = accountPassage(rows(40, 44), { heading: "Attendance", chunkIndex: 41 }, LATE, "Remy Calder") ?? "";
    expect(quoted).toMatch(/know his or her work schedule/);
    expect(quoted).not.toMatch(/unable to open|reimburse The\s+Company \$25/);
  });

  it("a list heading (\"All Locations Dress Code:\") still reads its sub-items in the next chunks", () => {
    const quoted = accountPassage(rows(44, 48), { heading: "All Locations Dress Code", chunkIndex: 44 }, "Remy wore open toe sandals on 9/12.", "Remy Calder") ?? "";
    expect(quoted).toMatch(/shoes/i);
  });
});
