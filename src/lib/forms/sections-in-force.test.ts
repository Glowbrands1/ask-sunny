import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { relabelManualRows, withSectionsInForce } from "./official-policy-manual";

/*
 * Board f109 (QA, 23 Nov 2026): production's manual stores chunks 24–26 under "Immigration Law Compliance" while chunk
 * 25's text starts "Disability Accommodation-Americans with Disability Act" partway through and chunk 26 is all
 * disability text. The reader labels each chunk with the heading, from the manual's own headings, that covers most of it.
 */
type Row = { chunk_index: number; locator: string; section: string; content: string; metadata?: { sections?: { heading: string }[] } | null };
const production = JSON.parse(readFileSync(new URL("../../test/fixtures/jba-manual-production-151.json", import.meta.url), "utf8")) as { chunks: Row[] };
const rows = production.chunks;
const chunkOf = (row: Row) => ({
  chunkIndex: Number(row.chunk_index),
  content: row.content,
  section: row.section,
  locator: row.locator,
  sections: (row.metadata?.sections ?? []).map((entry) => ({ heading: entry.heading })),
});
const manual = rows.map(chunkOf).sort((a, b) => a.chunkIndex - b.chunkIndex);
const at = (chunks: ReturnType<typeof withSectionsInForce<ReturnType<typeof chunkOf>>>, index: number) => chunks.find((chunk) => chunk.chunkIndex === index)!;

describe("the section in force, from the manual's own headings (f109)", () => {
  const read = withSectionsInForce(manual);

  it("the disability text is labelled Disability Accommodation, never Immigration Law Compliance", () => {
    /*
     * CHANGED ON PURPOSE (QA's controls, 23 Nov 2026): chunk 25's first lines are immigration text, so the chunk keeps
     * Immigration Law Compliance for them, and its disability text, from the heading line on, is that section.
     */
    expect(at(read, 25).section).toBe("Immigration Law Compliance");
    expect(at(read, 25).sectionAfter).toEqual({ line: "Disability Accommodation-Americans with Disability Act", section: "Disability Accommodation-Americans with Disability Act", locator: "Page 9 — Disability Accommodation-Americans with Disability Act" });
    expect(at(read, 26).section).toBe("Disability Accommodation-Americans with Disability Act");
    expect(at(read, 26).locator).toBe("Page 9 — Disability Accommodation-Americans with Disability Act");
  });

  it("control: the immigration text keeps Immigration Law Compliance", () => {
    expect(at(read, 23).section).toBe("Immigration Law Compliance");
    expect(at(read, 24).section).toBe("Immigration Law Compliance");
    expect(at(read, 24).locator).toBe("Page 9 — Immigration Law Compliance");
  });

  it("control: the next section starts where its own heading line is", () => {
    expect(at(read, 27).section).toBe("Sexual and Other Forms of Harassment");
  });

  it("guardrail: with no heading set, every chunk keeps its stored section", () => {
    const bare = [{ chunkIndex: 1, content: "Some text.\nMore text.", section: null }, { chunkIndex: 2, content: "Other text.", section: null }];
    expect(withSectionsInForce(bare)).toEqual(bare);
  });

  it("guardrail: with no heading line in the text, every chunk keeps its stored section", () => {
    const plain = [
      { chunkIndex: 1, content: "Rules about clocking in.", section: "Attendance", sections: [{ heading: "Attendance" }] },
      { chunkIndex: 2, content: "More about clocking in.", section: "Attendance", sections: [{ heading: "Late Opening" }] },
    ];
    expect(withSectionsInForce(plain).map((chunk) => chunk.section)).toEqual(["Attendance", "Attendance"]);
  });

  it("a stored section that moved on is trusted over a heading carried from a line", () => {
    const moved = [
      { chunkIndex: 1, content: "Intro text.\nLate Opening\nLate opening rules, a long paragraph of them.", section: "Attendance", sections: [{ heading: "Late Opening" }] },
      { chunkIndex: 2, content: "Dress rules text.", section: "Dress Code", sections: [{ heading: "Dress Code" }] },
    ];
    /* CHANGED ON PURPOSE (QA's controls): "Intro text." keeps the stored Attendance; Late Opening starts at its line. */
    const read = withSectionsInForce(moved);
    expect(read.map((chunk) => chunk.section)).toEqual(["Attendance", "Dress Code"]);
    expect(read[0]!.sectionAfter?.section).toBe("Late Opening");
    expect(read[1]!.sectionAfter).toBeUndefined();
  });

  /* QA's controls (23 Nov 2026): the text before the new heading keeps the stored label. */
  it("chunk 121: its last Time Records lines stay Time Records; Schedule Requests starts at its own line", () => {
    expect(at(read, 121).section).toBe("Time Records");
    expect(at(read, 121).locator).toBe("Page 37 — Time Records");
    expect(at(read, 121).sectionAfter?.section).toBe("Schedule Requests/General availability Changes");
  });

  it("chunk 67: its last Solicitation lines stay Solicitation; Care and Cleaning starts at its own line", () => {
    expect(at(read, 67).section).toBe("Solicitation");
    expect(at(read, 67).sectionAfter?.section).toBe("Care and Cleaning of Equipment and Facilities");
    expect(at(read, 67).sectionAfter?.locator).toBe("Page 21 — Care and Cleaning of Equipment and Facilities");
  });

  it("a chunk whose new heading is in force from its first line is relabelled whole (carried, or printed on line 1)", () => {
    expect(at(read, 26).sectionAfter).toBeUndefined();
    expect(at(read, 34).section).toBe("Smoking/Vaping");
    expect(at(read, 35).section).toBe("Smoking/Vaping");
  });
});

describe("search hits from the official manual carry the reader's label (f109)", () => {
  const read = withSectionsInForce(manual.map((chunk) => ({ ...chunk, chunkId: `c-${chunk.chunkIndex}` })));
  const hit = (index: number, documentId = "doc-manual") => {
    const row = manual.find((chunk) => chunk.chunkIndex === index)!;
    return { chunk_id: `c-${index}`, document_id: documentId, section: row.section, locator: row.locator, content: row.content };
  };

  it("a disability hit is relabelled Disability Accommodation", () => {
    const [row] = relabelManualRows([hit(26)], "doc-manual", read);
    expect(row!.section).toBe("Disability Accommodation-Americans with Disability Act");
    expect(row!.locator).toBe("Page 9 — Disability Accommodation-Americans with Disability Act");
  });

  it("control: an immigration hit keeps Immigration Law Compliance", () => {
    expect(relabelManualRows([hit(24)], "doc-manual", read)[0]!.section).toBe("Immigration Law Compliance");
  });

  it("a hit on chunk 25 is split at the disability heading: the immigration lines keep their label", () => {
    const split = relabelManualRows([hit(25)], "doc-manual", read);
    expect(split.map((row) => row.section)).toEqual(["Immigration Law Compliance", "Disability Accommodation-Americans with Disability Act"]);
    expect(split[1]!.content.startsWith("Disability Accommodation-Americans with Disability Act")).toBe(true);
    expect(split.map((row) => row.content).join("\n")).toContain(split[0]!.content);
  });

  /* QA's controls (23 Nov 2026), on the search path. */
  it("a \"didn't clock out\" hit on chunk 121: its Time Records lines are cited Time Records, never Schedule Requests", () => {
    const [before, after] = relabelManualRows([hit(121)], "doc-manual", read);
    expect(before!.section).toBe("Time Records");
    expect(before!.locator).toBe("Page 37 — Time Records");
    expect(before!.content).toMatch(/sign off to confirm their accuracy/);
    expect(before!.content).not.toMatch(/Schedule Requests/);
    expect(after!.section).toBe("Schedule Requests/General availability Changes");
  });

  it("a hit on chunk 67: its Solicitation lines stay Solicitation, and Care and Cleaning is p.21", () => {
    const [before, after] = relabelManualRows([hit(67)], "doc-manual", read);
    expect(before!.section).toBe("Solicitation");
    expect(before!.content).toMatch(/submit it to Management for approval/);
    expect(after!.section).toBe("Care and Cleaning of Equipment and Facilities");
    expect(after!.locator).toBe("Page 21 — Care and Cleaning of Equipment and Facilities");
    expect(after!.content).toMatch(/keep the equipment and the workplace clean/);
  });

  it("guardrail: a row from another document is never relabelled", () => {
    const other = hit(26, "doc-other");
    expect(relabelManualRows([other], "doc-manual", read)[0]).toEqual(other);
  });
});
