import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildAssetPath,
  inspectPdf,
  looksLikePdf,
  sha256Hex,
  validateFieldMap,
} from "./pdf-inspect";

/**
 * "REPLACE WITH NEW PDF" IS NOT A PROMISE THAT ASK SUNNY CAN FILL IT.
 *
 * Every reference PDF supplied for this feature was checked in Phase 0 and
 * carries no AcroForm fields at all — they are print captures. So the inspector
 * has to answer honestly, and the honest answer decides behaviour: a PDF with
 * no fields is stored as the official reference copy while generated downloads
 * keep coming from the structured renderer.
 *
 * The reference files themselves are NOT committed — they are customer
 * documents. These tests build their own PDFs instead, which also covers the
 * cases a supplied file would not: something that is not a PDF, and something
 * truncated.
 */

/** A one-page PDF with no form fields, written by hand. */
function minimalPdf(): Uint8Array {
  const body = [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");
  return new TextEncoder().encode(body);
}

describe("what an uploaded file is allowed to be", () => {
  it("rejects a file that is not a PDF", async () => {
    const result = await inspectPdf(new TextEncoder().encode("PK not a pdf"));
    expect(result.ok).toBe(false);
    expect(result.rejection).toMatch(/not a PDF/);
  });

  it("rejects a PDF it cannot read, and says so rather than throwing", async () => {
    // An administrator uploading something odd is a normal event that has to be
    // recorded, not an exception that loses the audit trail.
    const truncated = new TextEncoder().encode("%PDF-1.7\n<<broken");
    const result = await inspectPdf(truncated);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBeTruthy();
  });

  it("accepts a field-less PDF as a reference copy, and keeps the structured renderer", async () => {
    const result = await inspectPdf(minimalPdf());
    expect(result.ok).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(result.acroform.hasFields).toBe(false);
    // THE LOAD-BEARING ASSERTION: no fields means no filling, whatever the
    // upload is called.
    expect(result.renderer).toBe("structured");
    expect(result.notes.join(" ")).toMatch(/reference copy/i);
  });

  it("never promotes an upload to fillable on the strength of the upload alone", async () => {
    // Even when fields exist, a mapping has to be made and validated first — so
    // `renderer` is never "acroform" straight out of an inspection.
    const result = await inspectPdf(minimalPdf());
    expect(result.renderer).not.toBe("acroform");
  });

  it("leaves the caller's bytes intact, so the digest and the upload still work", async () => {
    /*
     * THE REGRESSION. pdf.js takes ownership of the array it is handed and
     * detaches its buffer. Passing the caller's bytes straight through meant a
     * SUCCESSFUL inspection was followed by
     * "Cannot perform Construct on a detached ArrayBuffer" from the SHA-256
     * that names the version — the upload failed AFTER being accepted, and the
     * screen still said "reference copy" because that sentence is static.
     *
     * So the order the route uses is the order asserted here: inspect, then
     * hash the same bytes, then store them.
     */
    const bytes = minimalPdf();
    const before = bytes.byteLength;

    const result = await inspectPdf(bytes);
    expect(result.ok).toBe(true);

    expect(bytes.byteLength).toBe(before);
    expect(bytes.buffer.byteLength).toBeGreaterThan(0);
    await expect(sha256Hex(bytes)).resolves.toMatch(/^[0-9a-f]{64}$/);
    // Storing is `new Uint8Array(bytes)` on the route's side; a detached buffer
    // throws here rather than producing an empty file.
    expect(new Uint8Array(bytes).byteLength).toBe(before);
  });

  it("recognises the PDF magic bytes and nothing else", () => {
    expect(looksLikePdf(minimalPdf())).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("%PDF"))).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode("not even close"))).toBe(false);
  });
});

describe("a proposed field mapping", () => {
  it("refuses a PDF field the file does not have", () => {
    const result = validateFieldMap({ ghost: "observation" }, ["real"], ["observation"]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/no field called "ghost"/);
  });

  it("refuses a template key the version does not have", () => {
    const result = validateFieldMap({ real: "invented" }, ["real"], ["observation"]);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatch(/template has no field/);
  });

  it("refuses two PDF fields writing to one template field", () => {
    const result = validateFieldMap(
      { a: "observation", b: "observation" },
      ["a", "b"],
      ["observation"],
    );
    expect(result.ok).toBe(false);
    expect(result.problems.some((problem) => /both map to/.test(problem))).toBe(true);
  });

  it("accepts a mapping both sides agree on", () => {
    expect(validateFieldMap({ a: "observation" }, ["a"], ["observation"]).ok).toBe(true);
  });
});

describe("where the bytes go", () => {
  it("derives the path server-side, from the template and the digest", async () => {
    const digest = await sha256Hex(minimalPdf());
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const path = buildAssetPath("dpoa", 2, digest, "DPOA final (v2).pdf");
    expect(path).toBe(`dpoa/v2/${digest.slice(0, 16)}/DPOA-final-v2-.pdf`);
    // The digest is in the path, so re-uploading identical bytes lands in the
    // same place rather than accumulating near-duplicates.
    expect(path).toContain(digest.slice(0, 16));
  });

  it("cannot be talked into a path outside its template", () => {
    // The file name is the only part of the path a caller influences, and it is
    // scrubbed. `../` in a name must not climb out of the template's folder.
    const path = buildAssetPath("coaching", 1, "a".repeat(64), "../../etc/passwd");
    expect(path.startsWith("coaching/v1/")).toBe(true);
    expect(path).not.toContain("..");
  });

  it("gives identical bytes an identical digest", async () => {
    const first = await sha256Hex(minimalPdf());
    const second = await sha256Hex(minimalPdf());
    expect(first).toBe(second);
  });
});

describe("the reference PDFs, if they are present locally", () => {
  it("confirms the supplied captures carry no fillable fields", async () => {
    /*
     * Skipped in CI and anywhere the customer's files are absent — they are not
     * in the repository and never will be. Where they ARE present, this
     * re-confirms the Phase 0 finding that drove the whole design: those PDFs
     * cannot be filled by field name.
     */
    const path =
      "/root/.claude/uploads/2d7c7431-28c1-5aeb-8bc7-b585e73f9854/c84c5441-Coaching_form_template.pdf";
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path));
    } catch {
      return;
    }
    const result = await inspectPdf(bytes);
    expect(result.ok).toBe(true);
    expect(result.acroform.hasFields).toBe(false);
    expect(result.renderer).toBe("structured");
  });
});
