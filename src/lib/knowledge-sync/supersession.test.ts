import { describe, expect, it } from "vitest";

import { contentRows } from "./inventory";
import { identitySignals, planSupersession, type LibraryDocument } from "./supersession";
import type { InventoryItem } from "./types";

const doc = (over: Partial<LibraryDocument> & Pick<LibraryDocument, "id" | "title">): LibraryDocument => ({
  originalFilename: `${over.title}.pdf`,
  fileType: "pdf",
  contentHash: null,
  ...over,
});

/* The live corpus: the uploaded manual, Woven's copy of the same PDF, and Woven policies merely named after it. */
const WOVEN_MANUAL = doc({ id: "w-handbook", title: "JBA Policy Manual Edited 5.2025", originalFilename: "JBA-Policy-Manual-Edited-5.2025.pdf", contentHash: "h1" });
const WOVEN_POLICY_TEXT = doc({ id: "w-policy", title: "JBA Policy Manual 2025", originalFilename: "policy-3d90671a-0000-4000-8000-000000000001.txt", fileType: "txt" });
const WOVEN_POLICY_PDF = doc({ id: "w-policy-pdf", title: "JBA Policy Manual 2025 — 2025 JBA Policy Manual Master", originalFilename: "2025-JBA-Policy-Manual-Master-Edited-5-2025-with-acknowledgement.pdf" });
const UPLOAD_MANUAL = doc({ id: "u-manual", title: "JBA Policy Manual Edited 5.2025", originalFilename: "JBA-Policy-Manual-Edited-5.2025.pdf", contentHash: "h1" });

describe("which uploads a current Woven copy replaces — exact identity only", () => {
  it("the live manual: the upload is superseded by Woven's copy of the same file, and by nothing merely titled after it", () => {
    const plan = planSupersession([WOVEN_MANUAL, WOVEN_POLICY_TEXT, WOVEN_POLICY_PDF], [UPLOAD_MANUAL]);
    expect(plan).toEqual({ supersede: [{ uploadId: "u-manual", uploadTitle: UPLOAD_MANUAL.title, supersededBy: "w-handbook", signals: ["content", "file", "title"] }], held: [] });
  });

  it.each([
    ["the same content", { contentHash: "h9" }, { contentHash: "h9", title: "Other", originalFilename: "other.pdf" }, ["content"]],
    ["the same file name, case aside", { originalFilename: "Dress-Code.PDF" }, { originalFilename: "dress-code.pdf", title: "Other" }, ["file"]],
    ["the same title and file type", { title: "Dress  Code" }, { title: "dress code", originalFilename: "x.pdf" }, ["title"]],
  ])("%s is identity", (_label, upload, current, signals) => {
    const base = { title: "Dress Code" } as Pick<LibraryDocument, "title">;
    expect(identitySignals(doc({ id: "u", ...base, ...upload }), doc({ id: "w", ...base, ...current }))).toEqual(signals);
  });

  it("a file name the sync made up for a text part is never identity", () => {
    const synthetic = "policy-3d90671a-0000-4000-8000-000000000001.txt";
    expect(identitySignals(doc({ id: "u", title: "A", originalFilename: synthetic, fileType: "txt" }), doc({ id: "w", title: "B", originalFilename: synthetic, fileType: "txt" }))).toEqual([]);
  });

  it("a title alone across file types is held for review, not superseded", () => {
    const plan = planSupersession([doc({ id: "w", title: "Attendance Policy", originalFilename: "policy-1.txt", fileType: "txt" })], [doc({ id: "u", title: "Attendance Policy" })]);
    expect(plan).toEqual({ supersede: [], held: [{ uploadId: "u", uploadTitle: "Attendance Policy", candidates: [{ id: "w", title: "Attendance Policy" }], reason: "title_only" }] });
  });

  it("two different Woven documents claiming one upload: held — unless both are the same content", () => {
    const upload = doc({ id: "u", title: "Dress Code", contentHash: "h1" });
    const a = doc({ id: "w1", title: "Dress Code", contentHash: "h2" });
    const b = doc({ id: "w2", title: "Other", originalFilename: "Dress Code.pdf", contentHash: "h3" });
    expect(planSupersession([a, b], [upload]).held[0]).toMatchObject({ uploadId: "u", reason: "several_candidates" });
    const same = planSupersession([{ ...a, contentHash: "h1" }, { ...b, contentHash: "h1" }], [upload]);
    expect(same.supersede).toEqual([expect.objectContaining({ uploadId: "u", supersededBy: "w1" })]);
  });

  it("unrelated uploads, and similar-but-not-equal titles, are never touched", () => {
    const plan = planSupersession([WOVEN_MANUAL], [doc({ id: "u1", title: "Holiday Schedule" }), doc({ id: "u2", title: "JBA Policy Manual Edited 5.2024", originalFilename: "JBA-Policy-Manual-Edited-5.2024.pdf" })]);
    expect(plan).toEqual({ supersede: [], held: [] });
  });
});

describe("the Content view shows the replaced upload beside its current Woven copy", () => {
  const item: InventoryItem = {
    contentType: "handbook",
    entityId: "hb-1",
    partKey: "current-version",
    title: "JBA Policy Manual",
    recordTitle: "JBA Policy Manual",
    status: "Published",
    audience: ["Public"],
    version: null,
    sourceUpdatedAt: "2025-05-13",
    fileName: "JBA-Policy-Manual-Edited-5.2025.pdf",
    state: "UNCHANGED",
    reason: null,
    pendingAction: "none",
    inAskSunny: true,
    knowledgeDocumentId: "w-handbook",
    firstSeenAt: "2026-09-29T00:00:00Z",
    lastSeenAt: "2026-09-30T00:00:00Z",
    lastSyncedAt: "2026-09-30T00:00:00Z",
  } as InventoryItem;

  it("Current Woven copy: Current; Previous uploaded copy: Stale / Superseded — the row itself stays Current", () => {
    const [row] = contentRows([item], [], new Map(), new Map([["w-handbook", [{ id: "u-manual", title: "JBA Policy Manual Edited 5.2025" }]]]));
    expect(row!.syncState).toBe("up_to_date");
    expect(row!.parts.map((p) => [p.kind, p.syncState])).toEqual([
      ["version", "up_to_date"],
      ["superseded_copy", "stale"],
    ]);
  });
});
