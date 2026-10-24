import { describe, expect, it } from "vitest";

import { dedupeIdenticalSections, documentFamily, planEditionSupersession, type EditionCandidate } from "./edition";

const doc = (over: Partial<EditionCandidate> & Pick<EditionCandidate, "documentId" | "title" | "publicationId">): EditionCandidate => ({
  fileName: null,
  sourceUpdatedAt: null,
  ...over,
});

const OLDER = "2024 JBA Policy Manual Master - Edited 10-2024";
const CURRENT = "JBA Policy Manual Edited 5.2025";
const ACK = "2025 JBA Policy Manual Master - Edited 5-2025 with acknowledgement";
const YEAR = "JBA Policy Manual 2025";

describe("document family", () => {
  it("treats the dated JBA manuals as one document", () => {
    const family = documentFamily(CURRENT);
    expect(family).toBeTruthy();
    expect(documentFamily(OLDER)).toBe(family);
    expect(documentFamily(ACK)).toBe(family);
    expect(documentFamily(YEAR)).toBe(family);
  });

  it("does not invent a family from a single word", () => {
    expect(documentFamily("Handbook")).toBeNull();
  });
});

describe("newest edition", () => {
  it("supersedes the 2024 manual and keeps both May 2025 copies and the year-only 2025 copy", () => {
    const plan = planEditionSupersession([
      doc({ documentId: "d4aeefbb", title: OLDER, publicationId: "file_library:2024", fileName: "2024-JBA.pdf" }),
      doc({ documentId: "ce6b00f1", title: CURRENT, publicationId: "file_library:edited", fileName: "JBA-Policy-Manual-Edited-5.2025.pdf" }),
      doc({ documentId: "5c626f3c", title: ACK, publicationId: "file_library:ack", fileName: "2025-ack.pdf" }),
      doc({ documentId: "pointer", title: YEAR, publicationId: "policy:pointer", fileName: "policy-pointer.txt" }),
    ]);
    expect(plan).toEqual([expect.objectContaining({ documentId: "d4aeefbb", family: documentFamily(CURRENT) })]);
    expect(["ce6b00f1", "5c626f3c"].includes(plan[0]!.supersededBy)).toBe(true);
    expect(plan.map((row) => row.documentId)).not.toContain("ce6b00f1");
    expect(plan.map((row) => row.documentId)).not.toContain("5c626f3c");
    expect(plan.map((row) => row.documentId)).not.toContain("pointer");
  });

  it("does not supersede a policy body with its own attachment", () => {
    const plan = planEditionSupersession([
      doc({ documentId: "body", title: "Attendance Policy", publicationId: "policy:101", sourceUpdatedAt: "2024-01-01" }),
      doc({ documentId: "pdf", title: "Attendance Policy", publicationId: "policy:101", fileName: "Attendance Policy.pdf", sourceUpdatedAt: "2025-05-01" }),
    ]);
    expect(plan).toEqual([]);
  });

  it("uses Woven's updated time when the name has no edition date", () => {
    const plan = planEditionSupersession([
      doc({ documentId: "old", title: "Lotion Guide", publicationId: "file:1", sourceUpdatedAt: "2024-09-01" }),
      doc({ documentId: "new", title: "Lotion Guide", publicationId: "file:2", sourceUpdatedAt: "2026-09-01" }),
    ]);
    expect(plan).toEqual([expect.objectContaining({ documentId: "old", supersededBy: "new" })]);
  });
});

describe("identical sections", () => {
  const section = "Team members must arrive on time and call the salon if they will be late.";

  it("keeps the newer edition of the same section and drops the older copy", () => {
    const rows = dedupeIdenticalSections([
      { document_id: "d4aeefbb", document_title: OLDER, section: "Attendance", content: section, similarity: 0.9 },
      { document_id: "ce6b00f1", document_title: CURRENT, section: "Attendance", content: section, similarity: 0.4 },
    ]);
    expect(rows.map((row) => row.document_id)).toEqual(["ce6b00f1"]);
  });

  it("keeps one of two May 2025 copies, stably, and keeps a section whose text differs", () => {
    const same = dedupeIdenticalSections([
      { document_id: "5c626f3c", document_title: ACK, section: "Attendance", content: section, similarity: 0.5 },
      { document_id: "ce6b00f1", document_title: CURRENT, section: "Attendance", content: section, similarity: 0.5 },
    ]);
    expect(same.map((row) => row.document_id)).toEqual(["5c626f3c"]);
    const different = dedupeIdenticalSections([
      { document_id: "5c626f3c", document_title: ACK, section: "Attendance", content: section, similarity: 0.5 },
      { document_id: "ce6b00f1", document_title: CURRENT, section: "Dress Code", content: "Skirts and dresses must reach the knee.", similarity: 0.5 },
    ]);
    expect(different).toHaveLength(2);
  });
});
