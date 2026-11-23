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
    expect(at(read, 25).section).toBe("Disability Accommodation-Americans with Disability Act");
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
    expect(withSectionsInForce(moved).map((chunk) => chunk.section)).toEqual(["Late Opening", "Dress Code"]);
  });
});

describe("search hits from the official manual carry the reader's label (f109)", () => {
  const read = withSectionsInForce(manual.map((chunk) => ({ ...chunk, chunkId: `c-${chunk.chunkIndex}` })));
  const hit = (index: number, documentId = "doc-manual") => {
    const row = manual.find((chunk) => chunk.chunkIndex === index)!;
    return { chunk_id: `c-${index}`, document_id: documentId, section: row.section, locator: row.locator };
  };

  it("a disability hit is relabelled Disability Accommodation", () => {
    const [row] = relabelManualRows([hit(26)], "doc-manual", read);
    expect(row!.section).toBe("Disability Accommodation-Americans with Disability Act");
    expect(row!.locator).toBe("Page 9 — Disability Accommodation-Americans with Disability Act");
  });

  it("control: an immigration hit keeps Immigration Law Compliance", () => {
    expect(relabelManualRows([hit(24)], "doc-manual", read)[0]!.section).toBe("Immigration Law Compliance");
  });

  it("guardrail: a row from another document is never relabelled", () => {
    const other = hit(26, "doc-other");
    expect(relabelManualRows([other], "doc-manual", read)[0]).toEqual(other);
  });
});
