import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeDocument } from "@/types";

/**
 * DOCUMENT LIFECYCLE ACTIONS.
 *
 * The behaviour worth pinning is that retry and re-index are the same call with
 * one flag, that demo mode resolves them locally, and that a failed action
 * never silently reports success — a document removed from the library while it
 * is still indexed and citable would be the worst outcome here.
 */

const ORIGINAL_ENV = { ...process.env };

function document(over: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "kb_abc123",
    title: "Attendance Policy",
    description: "",
    category: "policies_compliance",
    fileName: "attendance.pdf",
    fileType: "pdf",
    sizeBytes: 1024,
    characterCount: 400,
    status: "ready",
    source: "upload",
    version: 1,
    previousVersions: [],
    uploadedBy: "Dana Reyes",
    uploadedAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    indexed: true,
    tags: [],
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("lifecycleIsLive", () => {
  it("follows the runtime mode", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    const demo = await import("./lifecycle-service");
    expect(demo.lifecycleIsLive()).toBe(false);

    vi.resetModules();
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const live = await import("./lifecycle-service");
    expect(live.lifecycleIsLive()).toBe(true);
  });
});

describe("demoProcessingOutcome", () => {
  it("indexes an ordinary document", async () => {
    const { demoProcessingOutcome } = await import("./lifecycle-service");
    expect(demoProcessingOutcome(document())).toEqual({
      status: "ready",
      indexed: true,
    });
  });

  it("fails deterministically for a titled marker, so the state is demonstrable", async () => {
    const { demoProcessingOutcome } = await import("./lifecycle-service");
    const outcome = demoProcessingOutcome(document({ title: "Broken scan [FAIL]" }));

    expect(outcome.status).toBe("failed");
    expect(outcome.indexed).toBe(false);
    expect(outcome.failureReason).toContain("Demo");
    // The reason has to teach the real-world cause, not just say "failed".
    expect(outcome.failureReason).toContain("OCR");
  });

  it("is deterministic — the same document always gives the same outcome", async () => {
    const { demoProcessingOutcome } = await import("./lifecycle-service");
    const doc = document({ title: "Policy [fail]" });
    expect(demoProcessingOutcome(doc)).toEqual(demoProcessingOutcome(doc));
  });

  it("never reports a failed document as indexed", async () => {
    const { demoProcessingOutcome } = await import("./lifecycle-service");
    const outcome = demoProcessingOutcome(document({ fileName: "scan [fail].pdf" }));
    expect(outcome.indexed).toBe(false);
  });
});

describe("reindexDocument", () => {
  it("sends force=false for a retry and force=true for a re-index", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ chunkCount: 4 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { reindexDocument } = await import("./lifecycle-service");

    await reindexDocument({ documentId: "kb_abc123", scopeId: "stc-core" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).force).toBe(false);

    await reindexDocument({ documentId: "kb_abc123", scopeId: "stc-core", force: true });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).force).toBe(true);
  });

  it("targets the document's own reindex route with an encoded id", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { reindexDocument } = await import("./lifecycle-service");
    await reindexDocument({ documentId: "kb/abc 123", scopeId: "stc-core" });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "/api/knowledge/documents/kb%2Fabc%20123/reindex",
    );
  });

  it("surfaces the server's reason rather than a generic failure", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "No text could be extracted from this PDF." }),
          { status: 422 },
        ),
      ),
    );

    const { reindexDocument } = await import("./lifecycle-service");
    await expect(
      reindexDocument({ documentId: "kb_abc123", scopeId: "stc-core" }),
    ).rejects.toThrow("No text could be extracted from this PDF.");
  });

  it("throws rather than resolving when the server returns an error with no body", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));

    const { reindexDocument } = await import("./lifecycle-service");
    await expect(
      reindexDocument({ documentId: "kb_abc123", scopeId: "stc-core" }),
    ).rejects.toThrow(/could not be re-indexed/);
  });
});

describe("deleteDocument", () => {
  it("scopes the delete and encodes both parameters", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { deleteDocument } = await import("./lifecycle-service");
    await deleteDocument({ documentId: "kb_abc123", scopeId: "stc-core" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("DELETE");
    expect(String(url)).toBe("/api/knowledge/documents/kb_abc123?scope=stc-core");
  });

  it("throws on failure, so the caller cannot remove it locally by mistake", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "The stored files could not be removed." }), {
          status: 502,
        }),
      ),
    );

    const { deleteDocument } = await import("./lifecycle-service");
    // A document that vanished from the library while still indexed and citable
    // is the worst outcome this path can produce.
    await expect(
      deleteDocument({ documentId: "kb_abc123", scopeId: "stc-core" }),
    ).rejects.toThrow("The stored files could not be removed.");
  });
});
