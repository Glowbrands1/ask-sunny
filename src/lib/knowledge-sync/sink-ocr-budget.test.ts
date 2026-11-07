import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * WOVEN_PDF_OCR_ENABLED: the Woven sink hands every ingest of one sync run the SAME page budget for scanned PDFs, so
 * the run's cap holds across files (`ingestion/extract/pdf-ocr.ts`). The pipeline is a fake here.
 */
const inputs: { ocrBudget?: unknown; source?: string }[] = [];
vi.mock("@/lib/ingestion/pipeline", () => ({
  ingestDocument: async (input: { ocrBudget?: unknown; source?: string }) => {
    inputs.push(input);
    return { reusedExistingEmbeddings: false };
  },
}));
vi.mock("@/lib/knowledge/corpus", () => ({ activeKnowledgeCorpus: () => "scope-1" }));

const { createSupabaseKnowledgeSink } = await import("./sink");
const { OcrBudget, OCR_MAX_PAGES_PER_RUN } = await import("@/lib/ingestion/extract/pdf-ocr");

const doc = (documentId: string) => ({
  bytes: new ArrayBuffer(4),
  fileName: `${documentId}.pdf`,
  mimeType: "application/pdf",
  title: documentId,
  description: "",
  category: "operations",
  tags: [],
  documentId,
});

describe("the Woven sink's OCR budget", () => {
  it("is one budget per sink (one sync run), shared by every file it ingests", async () => {
    const sink = createSupabaseKnowledgeSink("woven");
    await sink.ingest(doc("a") as never);
    await sink.ingest(doc("b") as never);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.ocrBudget).toBeInstanceOf(OcrBudget);
    expect(inputs[1]!.ocrBudget).toBe(inputs[0]!.ocrBudget);
    expect((inputs[0]!.ocrBudget as InstanceType<typeof OcrBudget>).limit).toBe(OCR_MAX_PAGES_PER_RUN);
  });

  it("a new sink (the next run) starts a new budget", async () => {
    inputs.length = 0;
    await createSupabaseKnowledgeSink("woven").ingest(doc("c") as never);
    await createSupabaseKnowledgeSink("woven").ingest(doc("d") as never);
    expect(inputs[0]!.ocrBudget).not.toBe(inputs[1]!.ocrBudget);
  });
});
