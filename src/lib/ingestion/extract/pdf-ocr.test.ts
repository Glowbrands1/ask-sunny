import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WOVEN_PDF_OCR_ENABLED (ported from the sibling app; QA's plan, approved by Pau, 7 Nov 2026). Scanned Woven PDFs
 * (equipment schematics, product guides, checklists) have no text layer and stayed in ERROR as "no_text". The transcription model is stubbed here; the PDF is real (pages with no text, as a scan has).
 */

const calls: { model: string; max_tokens: number; blocks: string[] }[] = [];
let reply: string | Error = "";

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: (params: { model: string; max_tokens: number; messages: { content: { type: string }[] }[] }) => {
        calls.push({ model: params.model, max_tokens: params.max_tokens, blocks: params.messages[0]!.content.map((block) => block.type) });
        return {
          finalMessage: async () => {
            if (reply instanceof Error) throw reply;
            return { content: [{ type: "text", text: reply }] };
          },
        };
      },
    },
  }),
}));

const { extractPdf } = await import("./pdf");
const { OCR_MAX_PAGES_PER_DOCUMENT, OCR_MODEL, OcrBudget, ocrPdfPages, parseOcrPages } = await import("./pdf-ocr");

/** A valid PDF of `count` pages with no text on them: what pdf.js sees in a scan. */
function scannedPdf(count: number): Uint8Array {
  const objects: string[] = [];
  const kids = Array.from({ length: count }, (_, index) => `${3 + index} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);
  for (let index = 0; index < count; index += 1) objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

beforeEach(() => {
  calls.length = 0;
  reply = "";
});
afterEach(() => vi.unstubAllEnvs());

describe("parseOcrPages", () => {
  it("splits the transcription at its page markers, in page order", () => {
    expect(parseOcrPages("=== PAGE 1 ===\nApril 2026\n=== PAGE 2 ===\nMon 6 | Inventory count", 2)).toEqual([
      "April 2026",
      "Mon 6 | Inventory count",
    ]);
  });

  it("leaves a skipped page empty and ignores a page number past the end", () => {
    expect(parseOcrPages("=== PAGE 2 ===\nOnly two\n=== PAGE 9 ===\nnot a page", 3)).toEqual(["", "Only two", ""]);
  });
});

describe("OcrBudget", () => {
  it("takes pages while they fit, and nothing once they do not", () => {
    const budget = new OcrBudget(10);
    expect(budget.take(6)).toBe(true);
    expect(budget.take(5)).toBe(false);
    expect(budget.remaining).toBe(4);
  });
});

describe("ocrPdfPages", () => {
  it("sends the PDF as a document block to the one model, and returns its pages", async () => {
    reply = "=== PAGE 1 ===\nUV Trouble Shooting";
    const pages = await ocrPdfPages(scannedPdf(1), 1, new OcrBudget());
    expect(pages).toEqual(["UV Trouble Shooting"]);
    expect(calls).toEqual([{ model: OCR_MODEL, max_tokens: 2000, blocks: ["document", "text"] }]);
    expect(OCR_MODEL).toBe("claude-sonnet-5");
  });

  it("refuses a file over the per-document cap before any request", async () => {
    // WOVEN_OCR_PAGE_BATCHES_ENABLED reads larger scans in ranges; this pins the cap with it off.
    vi.stubEnv("WOVEN_OCR_PAGE_BATCHES_ENABLED", "");
    await expect(ocrPdfPages(new Uint8Array(), OCR_MAX_PAGES_PER_DOCUMENT + 1, new OcrBudget())).rejects.toMatchObject({ code: "ocr_too_many_pages" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a file the run's budget cannot cover, before any request", async () => {
    await expect(ocrPdfPages(new Uint8Array(), 5, new OcrBudget(4))).rejects.toMatchObject({ code: "ocr_budget_spent" });
    expect(calls).toHaveLength(0);
  });

  it("a failed request is a retryable ocr_failed, not a crash", async () => {
    reply = new Error("overloaded");
    await expect(ocrPdfPages(scannedPdf(1), 1, new OcrBudget())).rejects.toMatchObject({ code: "ocr_failed" });
  });
});

describe("extractPdf with a scanned PDF", () => {
  it("off: no_text, as before, and no request", async () => {
    reply = "=== PAGE 1 ===\nshould never be read";
    await expect(extractPdf(scannedPdf(1), { ocr: new OcrBudget() })).rejects.toMatchObject({ code: "no_text" });
    expect(calls).toHaveLength(0);
  });

  it("on, from a Woven sync (a budget): the pages are read and segmented like any PDF", async () => {
    vi.stubEnv("WOVEN_PDF_OCR_ENABLED", "true");
    reply = "=== PAGE 1 ===\nError Codes\n=== PAGE 2 ===\nE04: lamp fault. Replace the lamp.";
    const document = await extractPdf(scannedPdf(2), { ocr: new OcrBudget() });
    expect(document.ocr).toEqual({ model: OCR_MODEL });
    expect(document.pageCount).toBe(2);
    expect(document.segments.map((segment) => segment.page)).toEqual([1, 2]);
    expect(document.segments[1]!.text).toContain("lamp fault");
    expect(document.characterCount).toBeGreaterThan(0);
  });

  it("on, from an upload (no budget): no_text, as before, and no request", async () => {
    vi.stubEnv("WOVEN_PDF_OCR_ENABLED", "true");
    await expect(extractPdf(scannedPdf(1))).rejects.toMatchObject({ code: "no_text" });
    expect(calls).toHaveLength(0);
  });

  it("on, but nothing read: no_text, as before", async () => {
    vi.stubEnv("WOVEN_PDF_OCR_ENABLED", "true");
    reply = "=== PAGE 1 ===\n";
    await expect(extractPdf(scannedPdf(1), { ocr: new OcrBudget() })).rejects.toMatchObject({ code: "no_text" });
    expect(calls).toHaveLength(1);
  });
});
