import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WOVEN_OCR_PAGE_BATCHES_ENABLED. Ported from the sibling app (QA, 10 Nov 2026): a scanned PDF of 45 pages was refused
 * with "This scanned PDF has 45 pages; it can be read automatically up to 40." With the flag on it is read in page
 * ranges of at most 20. The model is stubbed: each request answers with markers for the range it was asked.
 */
const asked: { max_tokens: number; text: string }[] = [];
let failRange: number | null = null;

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      stream: (params: { max_tokens: number; messages: { content: { type: string; text?: string }[] }[] }) => {
        const text = params.messages[0]!.content.find((block) => block.type === "text")!.text!;
        asked.push({ max_tokens: params.max_tokens, text });
        const range = /ONLY pages (\d+) to (\d+)/.exec(text);
        return {
          finalMessage: async () => {
            if (!range) return { content: [{ type: "text", text: "=== PAGE 1 ===\nall pages" }] };
            const [first, last] = [Number(range[1]), Number(range[2])];
            if (failRange === first) throw new Error("overloaded");
            // A model that also writes a page outside its range: that page must be ignored.
            const pages = [first - 1, ...Array.from({ length: last - first + 1 }, (_, i) => first + i)].filter((page) => page >= 1);
            return { content: [{ type: "text", text: pages.map((page) => `=== PAGE ${page} ===\nGuide page ${page}${page < first ? " (outside)" : ""}`).join("\n") }] };
          },
        };
      },
    },
  }),
}));

const { OCR_MAX_PAGES_BATCHED, OcrBudget, ocrPageRanges, ocrPdfPages } = await import("./pdf-ocr");

const FLAG = "WOVEN_OCR_PAGE_BATCHES_ENABLED";
const BYTES = new Uint8Array([37, 80, 68, 70]);

beforeEach(() => {
  asked.length = 0;
  failRange = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("a 45-page scan", () => {
  it("off (production today): refused at 40 pages, before any request (the bug)", async () => {
    await expect(ocrPdfPages(BYTES, 45, new OcrBudget())).rejects.toMatchObject({
      code: "ocr_too_many_pages",
      message: "This scanned PDF has 45 pages; it can be read automatically up to 40.",
    });
    expect(asked).toHaveLength(0);
  });

  it("on: read in three page ranges, every page once, in order", async () => {
    vi.stubEnv(FLAG, "true");
    const budget = new OcrBudget();
    const pages = await ocrPdfPages(BYTES, 45, budget);
    expect(asked.map((call) => /ONLY pages (\d+) to (\d+)/.exec(call.text)!.slice(1).join("-"))).toEqual(["1-20", "21-40", "41-45"]);
    expect(asked.map((call) => call.max_tokens)).toEqual([30_500, 30_500, 8_000]);
    expect(pages).toHaveLength(45);
    expect(pages.every((page, index) => page === `Guide page ${index + 1}`)).toBe(true);
    expect(budget.remaining).toBe(200 - 45);
  });

  it("on: one range failing fails the read (retryable ocr_failed), as a single request does", async () => {
    vi.stubEnv(FLAG, "true");
    failRange = 21;
    await expect(ocrPdfPages(BYTES, 45, new OcrBudget())).rejects.toMatchObject({ code: "ocr_failed" });
  });

  it("on: over 100 pages is still refused, naming the new cap", async () => {
    vi.stubEnv(FLAG, "true");
    await expect(ocrPdfPages(BYTES, OCR_MAX_PAGES_BATCHED + 1, new OcrBudget(500))).rejects.toMatchObject({
      code: "ocr_too_many_pages",
      message: "This scanned PDF has 101 pages; it can be read automatically up to 100.",
    });
  });

  it("on: a scan of 40 pages or fewer is one request, as before", async () => {
    vi.stubEnv(FLAG, "true");
    await ocrPdfPages(BYTES, 12, new OcrBudget());
    expect(asked).toHaveLength(1);
    expect(asked[0]!.text).not.toMatch(/ONLY pages/);
  });
});

describe("ocrPageRanges", () => {
  it("splits into ranges of at most 20", () => {
    expect(ocrPageRanges(45)).toEqual([{ first: 1, last: 20 }, { first: 21, last: 40 }, { first: 41, last: 45 }]);
    expect(ocrPageRanges(20)).toEqual([{ first: 1, last: 20 }]);
  });
});
