import { describe, expect, it } from "vitest";

import type { MatchedChunkRow } from "./mappers";
import {
  MANUAL_SCOPE_FETCH,
  manualEditionYear,
  manualScopeFetchLimit,
  scopeToCurrentManual,
  UNCHANGED_SIMILARITY_FLOOR,
} from "./current-manual-scope";

function row(over: Partial<MatchedChunkRow> & Pick<MatchedChunkRow, "chunk_id" | "document_title" | "content">): MatchedChunkRow {
  return {
    document_id: over.document_id ?? "doc",
    category: over.category ?? "policy",
    locator: over.locator ?? "p. 15",
    page: over.page ?? 15,
    section: over.section ?? "Late Opening",
    similarity: over.similarity ?? 0.9,
    ...over,
  };
}

const CURRENT = "JBA Policy Manual 2025 — 2025 JBA Policy Manual Master - Edited 5-2025 with acknowledgement";
const OLDER = "JBA Policy Manual 2025 — 2024 JBA Policy Manual Master - Edited 10-2024";
const SAME_TEXT = "When an employee assigned to open a location is unable to open.";

describe("edition year from the title", () => {
  it("reads the revision date, then the year before JBA, then a single year", () => {
    expect(manualEditionYear("JBA Policy Manual Edited 5.2025")).toBe(2025);
    expect(manualEditionYear(CURRENT)).toBe(2025);
    expect(manualEditionYear(OLDER)).toBe(2024);
    expect(manualEditionYear("JBA Policy Manual 2025")).toBe(2025);
    expect(manualEditionYear("JBA Policy Manual 2024")).toBe(2024);
    expect(manualEditionYear("JBA Policy Manual")).toBeNull();
  });
});

describe("scope to the current JBA manual", () => {
  it("leaves the similarity floor at 0.78 and widens the fetch only when asked", () => {
    expect(UNCHANGED_SIMILARITY_FLOOR).toBe(0.78);
    expect(manualScopeFetchLimit(14, false)).toBe(14);
    expect(manualScopeFetchLimit(14, true)).toBe(MANUAL_SCOPE_FETCH);
    expect(manualScopeFetchLimit(50, true)).toBe(50);
  });

  it("drops the older edition, keeps a non-manual row, and collapses identical sections", () => {
    const rows = [
      row({
        chunk_id: "old-1",
        document_id: "edition-2024",
        document_title: OLDER,
        content: SAME_TEXT,
        similarity: 0.97,
      }),
      row({
        chunk_id: "new-low",
        document_id: "edition-2025-a",
        document_title: CURRENT,
        content: SAME_TEXT,
        similarity: 0.91,
      }),
      row({
        chunk_id: "new-high",
        document_id: "edition-2025-b",
        document_title: "JBA Policy Manual 2025",
        content: SAME_TEXT,
        similarity: 0.95,
      }),
      row({
        chunk_id: "new-other-text",
        document_id: "edition-2025-b",
        document_title: "JBA Policy Manual 2025",
        section: "Late Opening",
        content: "The employee reimburses The Company.",
        similarity: 0.8,
      }),
      row({
        chunk_id: "handbook",
        document_id: "handbook",
        document_title: "Opening checklist",
        category: "operations",
        section: "Open",
        content: SAME_TEXT,
        similarity: 0.99,
      }),
    ];

    const scoped = scopeToCurrentManual(rows, { limit: 14 });
    expect(scoped.map((item) => item.chunk_id)).toEqual(["handbook", "new-high", "new-other-text"]);
  });

  it("keeps two current copies when the section text differs, then slices to the limit", () => {
    const rows = [
      row({ chunk_id: "a", document_id: "a", document_title: CURRENT, content: "First wording.", similarity: 0.9 }),
      row({ chunk_id: "b", document_id: "b", document_title: "JBA Policy Manual Edited 5.2025", content: "Second wording.", similarity: 0.88 }),
      row({ chunk_id: "c", document_id: "c", document_title: OLDER, content: "Old wording.", similarity: 0.99 }),
    ];
    expect(scopeToCurrentManual(rows, { limit: 1 }).map((item) => item.chunk_id)).toEqual(["a"]);
  });

  it("uses the pinned document when that id was retrieved", () => {
    const rows = [
      row({ chunk_id: "other-2025", document_id: "copy", document_title: CURRENT, content: "Copy.", similarity: 0.99 }),
      row({ chunk_id: "pinned", document_id: "pinned-id", document_title: "JBA Policy Manual Edited 5.2025", content: "Pinned.", similarity: 0.8 }),
    ];
    expect(scopeToCurrentManual(rows, { limit: 14, currentDocumentId: "pinned-id" }).map((item) => item.chunk_id)).toEqual([
      "pinned",
    ]);
  });
});
