import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * WOVEN_LARGER_FILES_ENABLED. Ported from the sibling app (QA, 10 Nov 2026): two Woven files there stop every sync as
 * larger than the upload limit (woven_too_large); their real sizes were recorded nowhere. File names here are invented. With the flag on a synced file may be up to 200 MB, a file over it is reported with
 * its size, an upload keeps 50 MB, and OCR refuses a scan too big for one request.
 */
const { WovenTeamClient } = await import("@/lib/knowledge-sync/woven/http");
const { validateUpload } = await import("./validation");
const { LARGER_SYNCED_FILE_MAX_BYTES, megabytes, syncedFileMaxBytes } = await import("./synced-file-limit");
const { extractPdf, OCR_MAX_BYTES } = await import("./extract/pdf");
const { OcrBudget } = await import("./extract/pdf-ocr");

const FLAG = "WOVEN_LARGER_FILES_ENABLED";
const MB = 1024 * 1024;

/** A signed download whose response declares `declared` bytes and sends a few. */
function client(declared: number) {
  const fetch = (async () =>
    new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-length": String(declared), "content-type": "application/pdf" } })) as typeof globalThis.fetch;
  return new WovenTeamClient({ baseUrl: "https://app.woven.team", fetch, sleep: async () => {}, transport: { minIntervalMs: 0, baseBackoffMs: 0 } });
}
const SIGNED = "https://jbafiles.blob.core.windows.net/library/Equipment-Guide.pdf?sig=x";

afterEach(() => vi.unstubAllEnvs());

describe("a synced file over the cap", () => {
  it("off (production today): 50 MB, and the message names no size (the bug: nobody knows how big it is)", async () => {
    expect(syncedFileMaxBytes()).toBe(50 * MB);
    await expect(client(76_960_000).downloadSigned(SIGNED, syncedFileMaxBytes())).rejects.toMatchObject({
      code: "too_large",
      message: "The file is larger than Ask Sunny' upload limit.",
    });
  });

  it("on: the cap is 200 MB, so a 73 MB file downloads", async () => {
    vi.stubEnv(FLAG, "true");
    expect(syncedFileMaxBytes()).toBe(LARGER_SYNCED_FILE_MAX_BYTES);
    await expect(client(76_960_000).downloadSigned(SIGNED, syncedFileMaxBytes())).resolves.toMatchObject({ contentType: "application/pdf" });
  });

  it("on: a file still over the cap is reported with its declared size and the limit", async () => {
    vi.stubEnv(FLAG, "true");
    await expect(client(260 * MB).downloadSigned(SIGNED, syncedFileMaxBytes())).rejects.toMatchObject({
      code: "too_large",
      message: "The file is 260 MB; Ask Sunny' limit for synced files is 200 MB.",
    });
  });

  it("megabytes: one decimal, none when whole", () => {
    expect(megabytes(76_960_000)).toBe("73.4");
    expect(megabytes(200 * MB)).toBe("200");
  });
});

describe("the pipeline's own size check", () => {
  const pdf = (sizeBytes: number, maxBytes?: number) => validateUpload({ fileName: "Equipment Guide.pdf", mimeType: "application/pdf", sizeBytes, ...(maxBytes ? { maxBytes } : {}) });

  it("an upload keeps the 50 MB limit, flag or not", () => {
    vi.stubEnv(FLAG, "true");
    expect(() => pdf(60 * MB)).toThrow('"Equipment Guide.pdf" is larger than the 50 MB limit.');
  });

  it("a synced file is checked against the cap it is given", () => {
    expect(pdf(60 * MB, LARGER_SYNCED_FILE_MAX_BYTES).fileType).toBe("pdf");
    expect(() => pdf(210 * MB, LARGER_SYNCED_FILE_MAX_BYTES)).toThrow('"Equipment Guide.pdf" is larger than the 200 MB limit.');
  });
});

/** A valid PDF of one page with no text, padded with a comment so it is `bytes` long. */
function paddedScan(bytes: number): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"];
  let body = `%PDF-1.4\n%${" ".repeat(Math.max(0, bytes - 600))}\n`;
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

describe("OCR's request size", () => {
  it("on: a scan over 23 MB is refused before any request, naming its size", async () => {
    vi.stubEnv(FLAG, "true");
    vi.stubEnv("WOVEN_PDF_OCR_ENABLED", "true");
    const scan = paddedScan(OCR_MAX_BYTES + MB);
    await expect(extractPdf(scan, { ocr: new OcrBudget() })).rejects.toMatchObject({
      code: "too_large",
      message: `This scanned PDF is ${megabytes(scan.byteLength)} MB; a scan can be read automatically up to 23 MB.`,
    });
  });
});
