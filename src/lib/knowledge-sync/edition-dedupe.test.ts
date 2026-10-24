import { describe, expect, it } from "vitest";

import { reconcile } from "./reconcile";
import { planHashDedupe, type HashEdition } from "./edition-dedupe";
import type { ManifestItem, SourceRecord } from "./types";

/** The kept JBA Policy Manual, and the byte-identical copy that must stay superseded. */
const KEPT = "ce6b00f1-ff30-565f-b446-53fd268a1695";
const DUPLICATE = "5c626f3c";
const HASH = "same-jba-manual-bytes";

const edition = (over: Partial<HashEdition> & Pick<HashEdition, "id">): HashEdition => ({
  contentHash: HASH,
  sourceUpdatedAt: null,
  superseded: false,
  ...over,
});

describe("hash dedupe keeps the newest Woven edition", () => {
  it("keeps ce6b00f1 and leaves 5c626f3c superseded", () => {
    const plan = planHashDedupe([
      edition({ id: DUPLICATE, sourceUpdatedAt: "2025-05-01T00:00:00Z", superseded: true }),
      edition({ id: KEPT, sourceUpdatedAt: "2026-05-13T14:02:11Z" }),
    ]);
    expect(plan).toEqual([{ hash: HASH, keepId: KEPT, supersede: [DUPLICATE] }]);
  });

  it("supersedes the older indexed copy of the same file", () => {
    const plan = planHashDedupe([
      edition({ id: DUPLICATE, sourceUpdatedAt: "2025-05-01" }),
      edition({ id: KEPT, sourceUpdatedAt: "2026-05-13T14:02:11" }),
    ]);
    expect(plan).toEqual([{ hash: HASH, keepId: KEPT, supersede: [DUPLICATE] }]);
  });

  it("does not bring a superseded copy back when its Woven date is newer", () => {
    const plan = planHashDedupe([
      edition({ id: DUPLICATE, sourceUpdatedAt: "2026-09-01", superseded: true }),
      edition({ id: KEPT, sourceUpdatedAt: "2026-05-13T14:02:11" }),
    ]);
    expect(plan).toEqual([{ hash: HASH, keepId: KEPT, supersede: [DUPLICATE] }]);
  });

  it("leaves a single edition, a different file, and an empty hash alone", () => {
    expect(
      planHashDedupe([
        edition({ id: KEPT }),
        edition({ id: "other", contentHash: "different-file", sourceUpdatedAt: "2020-01-01" }),
        edition({ id: "unhashed", contentHash: null }),
        edition({ id: "blank", contentHash: "  " }),
      ]),
    ).toEqual([]);
  });

  it("breaks a date tie by the lower document id and does not re-activate when every copy is superseded", () => {
    const tied = planHashDedupe([
      edition({ id: DUPLICATE, sourceUpdatedAt: "2026-05-13T14:02:11Z" }),
      edition({ id: KEPT, sourceUpdatedAt: "2026-05-13T14:02:11Z" }),
    ]);
    expect(tied).toEqual([{ hash: HASH, keepId: DUPLICATE, supersede: [KEPT] }]);
    expect(
      planHashDedupe([
        edition({ id: DUPLICATE, superseded: true }),
        edition({ id: KEPT, superseded: true }),
      ]),
    ).toEqual([]);
  });
});

describe("a superseded duplicate is not planned for ingest", () => {
  it("stays out of search on the next scan", () => {
    const previous = {
      source: "woven",
      contentType: "handbook",
      entityId: DUPLICATE,
      partKey: "current-version",
      title: "JBA Policy Manual Edited 5.2025",
      recordTitle: "JBA Policy Manual Edited 5.2025",
      status: "Published",
      audience: ["Public"],
      version: "1",
      versionId: "v1",
      sourceUpdatedAt: "2025-05-01",
      documentId: null,
      attachmentIds: [],
      locator: { handbookId: DUPLICATE },
      mimeType: "application/pdf",
      fileName: "JBA-Policy-Manual.pdf",
      observedFingerprint: "fp",
      syncedFingerprint: "fp",
      contentHash: HASH,
      knowledgeDocumentId: DUPLICATE,
      inAskSunny: false,
      state: "EXCLUDED",
      previousState: "NEW",
      pendingAction: "none",
      reason: "superseded_duplicate",
      lastError: null,
      errorCategory: null,
      retryCount: 0,
      nextRetryAt: null,
      firstSeenAt: "2026-09-29T00:00:00Z",
      lastSeenAt: "2026-09-29T00:00:00Z",
      lastSyncedAt: "2026-09-29T00:00:00Z",
    } satisfies ManifestItem;

    const record: SourceRecord = {
      source: "woven",
      contentType: "handbook",
      entityId: DUPLICATE,
      title: "JBA Policy Manual Edited 5.2025",
      status: "Published",
      publication: "published",
      audience: ["Public"],
      version: "1",
      versionId: "v1",
      updatedAt: "2026-10-01T00:00:00Z",
      documentIds: [],
      attachmentIds: [],
      contentFingerprint: null,
      sourceMetadata: {},
      parts: [
        {
          partKey: "current-version",
          title: "JBA Policy Manual Edited 5.2025",
          fileName: "JBA-Policy-Manual.pdf",
          documentId: null,
          versionId: "v1",
          mimeType: "application/pdf",
          sizeBytes: 10,
          retrieval: { kind: "available", locator: { handbookId: DUPLICATE } },
        },
      ],
    };

    const output = reconcile({
      source: "woven",
      listings: [{ ok: true, contentType: "handbook", records: [record], diagnostics: {} }],
      manifest: [previous],
      decisions: new Map(),
      companyWideLabels: ["Public"],
      now: "2026-10-24T00:00:00Z",
    });
    expect(output.items[0]).toMatchObject({
      pendingAction: "none",
      reason: "superseded_duplicate",
      inAskSunny: false,
      knowledgeDocumentId: DUPLICATE,
    });
  });
});
