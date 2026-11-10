import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * WOVEN_FAILED_RETRY_ENABLED. QA, 10 Nov 2026: six scanned Woven PDFs ("First Aid Kit Checklist-3", "MT- Ovation SST28
 * Spec Sheet", two Norvell product guides, an SDS and a lamp document) have said "No text could be extracted from this
 * PDF. If it is a scan, run OCR on it first or upload a text version." since 4 Nov 2026, although WOVEN_PDF_OCR has been
 * on since 8 Nov. The 14:13Z Sync Now deferred them (time budget) and the 14:40Z continue run skipped them (retries used
 * up): no run since 4 Nov reached them. The pipeline is a fake here.
 */
let failWith: Error | null = null;
vi.mock("@/lib/ingestion/pipeline", () => ({
  ingestDocument: async () => {
    if (failWith) throw failWith;
    return { reusedExistingEmbeddings: false };
  },
}));
vi.mock("@/lib/knowledge/corpus", () => ({ activeKnowledgeCorpus: () => "scope-1" }));

const { createSupabaseKnowledgeSink } = await import("./sink");
const { IngestionError } = await import("@/lib/ingestion/errors");
const { orderDue } = await import("./engine");

const FLAG = "WOVEN_FAILED_RETRY_ENABLED";
const NO_TEXT = "No text could be extracted from this PDF. If it is a scan, run OCR on it first or upload a text version.";
const doc = { bytes: new ArrayBuffer(4), fileName: "First Aid Kit Checklist-3.pdf", mimeType: "application/pdf", title: "First Aid Kit Checklist-3", description: "", category: "operations", tags: [], documentId: "d-1" };

async function ingestError(): Promise<import("./ports").SinkError> {
  failWith = new IngestionError("no_text", NO_TEXT, 422);
  try {
    await createSupabaseKnowledgeSink("woven").ingest(doc as never);
  } catch (error) {
    return error as import("./ports").SinkError;
  } finally {
    failWith = null;
  }
  throw new Error("ingest did not fail");
}

afterEach(() => vi.unstubAllEnvs());

describe("a scanned PDF that found no text is retried once OCR can read it", () => {
  it("off (production today): \"no_text\" is permanent, so its retries are used up at once (the bug)", async () => {
    vi.stubEnv("WOVEN_PDF_OCR_ENABLED", "true");
    const error = await ingestError();
    expect(error).toMatchObject({ category: "ingest_no_text", retryable: false });
  });

  it("on, with WOVEN_PDF_OCR on: \"no_text\" is retryable", async () => {
    vi.stubEnv("WOVEN_PDF_OCR_ENABLED", "true");
    vi.stubEnv(FLAG, "true");
    expect(await ingestError()).toMatchObject({ category: "ingest_no_text", retryable: true });
  });

  it("on, with WOVEN_PDF_OCR off: still permanent (nothing could read it)", async () => {
    vi.stubEnv(FLAG, "true");
    expect(await ingestError()).toMatchObject({ retryable: false });
  });
});

describe("orderDue: a full sync reaches the items that failed before ahead of its time budget", () => {
  const item = (title: string, extra: Record<string, unknown> = {}) => ({ title, pendingAction: "ingest", lastError: null, retryCount: 0, ...extra }) as never;

  it("retirements first, then earlier failures (retries used up or not), then the rest, each in its own order", () => {
    const due = [
      item("new manual A"),
      item("First Aid Kit Checklist-3", { lastError: NO_TEXT, retryCount: 5 }),
      item("old policy", { pendingAction: "retire" }),
      item("new manual B"),
      item("MT - Affinity 500, 600, & 800", { lastError: "Chunks could not be saved: unsupported Unicode escape sequence", retryCount: 9 }),
      item("link expired", { retryCount: 1 }),
    ];
    expect(orderDue(due).map((entry: { title: string }) => entry.title)).toEqual([
      "old policy",
      "First Aid Kit Checklist-3",
      "MT - Affinity 500, 600, & 800",
      "link expired",
      "new manual A",
      "new manual B",
    ]);
  });
});
