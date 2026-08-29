import { describe, expect, it } from "vitest";

import {
  isIndexed,
  rowToCitation,
  rowToDocument,
  rowToSearchResult,
  toDocumentStatus,
  type KnowledgeDocumentRow,
  type MatchedChunkRow,
} from "./mappers";

function matchRow(over: Partial<MatchedChunkRow> = {}): MatchedChunkRow {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    document_title: "Attendance & Dress Code Policy",
    category: "policies_compliance",
    locator: "Page 14",
    page: 14,
    section: null,
    content: "Team members are expected to be ready at the start of their shift.",
    similarity: 0.82,
    ...over,
  };
}

function documentRow(over: Partial<KnowledgeDocumentRow> = {}): KnowledgeDocumentRow {
  return {
    id: "doc-1",
    knowledge_scope_id: "stc-core",
    title: "Attendance Policy",
    description: "How attendance is handled.",
    category: "policies_compliance",
    tags: ["attendance"],
    original_filename: "attendance.pdf",
    mime_type: "application/pdf",
    file_type: "pdf",
    storage_path: "stc-core/doc-1/v1/attendance.pdf",
    size_bytes: 12345,
    character_count: 4000,
    source: "upload",
    status: "indexed",
    indexed: true,
    failure_reason: null,
    version: 2,
    previous_versions: [
      { version: 1, uploadedAt: "2026-01-01T00:00:00Z", uploadedBy: "Dana", sizeBytes: 100 },
    ],
    content_hash: "abc",
    uploaded_by: null,
    uploaded_by_name: "Dana Reyes",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-03-01T00:00:00Z",
    indexed_at: "2026-03-01T00:00:00Z",
    ...over,
  };
}

describe("processing status mapping", () => {
  it("maps the four processing states onto the existing DocumentStatus union", () => {
    expect(toDocumentStatus("uploading")).toBe("processing");
    expect(toDocumentStatus("processing")).toBe("processing");
    expect(toDocumentStatus("indexed")).toBe("ready");
    expect(toDocumentStatus("failed")).toBe("failed");
  });

  it("only reports indexed when the run actually completed", () => {
    expect(isIndexed("indexed", true)).toBe(true);
    // The row's flag alone is not enough, and neither is the stage alone.
    expect(isIndexed("processing", true)).toBe(false);
    expect(isIndexed("indexed", false)).toBe(false);
    expect(isIndexed("failed", true)).toBe(false);
  });
});

describe("rowToDocument", () => {
  it("maps a row onto the KnowledgeDocument the library already renders", () => {
    const document = rowToDocument(documentRow());

    expect(document).toMatchObject({
      id: "doc-1",
      title: "Attendance Policy",
      fileName: "attendance.pdf",
      fileType: "pdf",
      status: "ready",
      indexed: true,
      version: 2,
      uploadedBy: "Dana Reyes",
      uploadedAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    });
    expect(document.previousVersions).toHaveLength(1);
  });

  it("never exposes the storage path to the client shape", () => {
    expect(Object.keys(rowToDocument(documentRow()))).not.toContain("storagePath");
    expect(JSON.stringify(rowToDocument(documentRow()))).not.toContain("stc-core/doc-1");
  });

  it("shows a still-processing document as processing and not indexed", () => {
    const document = rowToDocument(documentRow({ status: "processing", indexed: false }));
    expect(document.status).toBe("processing");
    expect(document.indexed).toBe(false);
  });

  it("carries a failure reason through so the UI can show why", () => {
    const document = rowToDocument(
      documentRow({
        status: "failed",
        indexed: false,
        failure_reason: "No text could be extracted from this PDF.",
      }),
    );

    expect(document.status).toBe("failed");
    expect(document.indexed).toBe(false);
    expect(document.failureReason).toBe("No text could be extracted from this PDF.");
  });

  it("drops a stale failure reason once the document is indexed", () => {
    // A leftover reason on a healthy document would show an alarming message
    // beside a green badge.
    const document = rowToDocument(
      documentRow({ status: "indexed", indexed: true, failure_reason: "old failure" }),
    );
    expect(document.failureReason).toBeUndefined();
  });

  it("never reports a document mid-processing as citable", () => {
    for (const stage of ["uploading", "processing"] as const) {
      const document = rowToDocument(documentRow({ status: stage, indexed: true }));
      // Even if the row's flag says otherwise: the stage is the authority.
      expect(document.indexed, stage).toBe(false);
      expect(document.status, stage).toBe("processing");
    }
  });

  it("tolerates null tags and previous versions", () => {
    const document = rowToDocument(documentRow({ tags: null, previous_versions: null }));
    expect(document.tags).toEqual([]);
    expect(document.previousVersions).toEqual([]);
  });
});

describe("citation mapping", () => {
  it("builds every citation field from the retrieved row", () => {
    const citation = rowToCitation(matchRow());

    expect(citation).toEqual({
      documentId: "doc-1",
      documentTitle: "Attendance & Dress Code Policy",
      locator: "Page 14",
      category: "policies_compliance",
      excerpt: "Team members are expected to be ready at the start of their shift.",
      relevance: 0.82,
    });
  });

  it("falls back to a valid category rather than emitting an invalid one", () => {
    expect(rowToCitation(matchRow({ category: null as unknown as string })).category).toBe(
      "other",
    );
  });

  it("clamps relevance into the 0..1 range the source card renders", () => {
    expect(rowToCitation(matchRow({ similarity: 1.4 })).relevance).toBe(1);
    expect(rowToCitation(matchRow({ similarity: -0.2 })).relevance).toBe(0);
    expect(rowToCitation(matchRow({ similarity: Number.NaN })).relevance).toBe(0);
  });
});

describe("rowToSearchResult", () => {
  it("carries the chunk id so citations can be bound back to their row", () => {
    expect(rowToSearchResult(matchRow())).toEqual({
      chunkId: "chunk-1",
      documentId: "doc-1",
      documentTitle: "Attendance & Dress Code Policy",
      locator: "Page 14",
      content: "Team members are expected to be ready at the start of their shift.",
      score: 0.82,
    });
  });
});
