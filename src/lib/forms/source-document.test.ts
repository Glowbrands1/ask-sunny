import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";

import { coachingDocument } from "./library";
import { renderFormPdf } from "./pdf-render";
import { inspectSourceDocument } from "./source-document";
import {
  ACCEPTED_UPLOAD_TYPES,
  DOCX_CONTENT_TYPE,
  DOC_CONTENT_TYPE,
  PDF_CONTENT_TYPE,
  detectSourceFormat,
} from "./source-format";

/**
 * WHAT MAY BE UPLOADED AS A TEMPLATE'S OFFICIAL COPY.
 *
 * The forms this app is built from are issued as Word documents; the uploader
 * took PDFs only, so an administrator holding the authoritative copy could not
 * attach it. These tests are written against REAL FILES rather than mocks: the
 * PDF is one this app renders, and the .docx is a genuine zip archive built
 * below and handed to the same reader the route uses. A mock would have proved
 * that a mock returns what it was told to.
 *
 * The rejections matter as much as the acceptances. "Fail closed" here means an
 * odd upload leaves the previous version active, so a file that is not a PDF
 * and not a Word document has to be REFUSED rather than stored and hoped about.
 */

/* ------------------------------------------------- a real .docx, in memory --- */

/**
 * The smallest thing that is genuinely a Word document.
 *
 * Written with STORED (uncompressed) entries so the archive is built from the
 * zip format alone, with nothing to go wrong in a compressor. A reader that can
 * open a .docx can open this; one that only pattern-matches bytes cannot.
 */
function buildDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
    .join("");

  return buildZip([
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>",
    },
    {
      name: "word/document.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}</w:body></w:document>`,
    },
  ]);
}

function buildZip(entries: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const sum = crc32(Buffer.from(data));

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint32(14, sum, true);
    local.setUint32(18, data.byteLength, true); // stored: sizes match
    local.setUint32(22, data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    locals.push(new Uint8Array(local.buffer), name, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint32(16, sum, true);
    central.setUint32(20, data.byteLength, true);
    central.setUint32(24, data.byteLength, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);

    offset += 30 + name.byteLength + data.byteLength;
  }

  const directorySize = centrals.reduce((total, part) => total + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const zip = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    zip.set(part, cursor);
    cursor += part.byteLength;
  }
  return zip;
}

/** The OLE2 compound-file header a Word 97-2003 .doc opens with. */
function buildLegacyDoc({ word = true }: { word?: boolean } = {}): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  // The directory records a stream name in UTF-16LE. Word's is `WordDocument`;
  // a workbook's is `Workbook`, which is how the two are told apart.
  const name = word ? "WordDocument" : "Workbook";
  let cursor = 512;
  for (const character of name) {
    bytes[cursor] = character.charCodeAt(0);
    bytes[cursor + 1] = 0;
    cursor += 2;
  }
  return bytes;
}

const REAL_PDF = renderFormPdf(coachingDocument(), null, { values: {}, checked: {} }, {
  templateName: "Coaching Form",
  templateVersion: 1,
  employeeName: "Jordan Vance",
  formDate: "2026-09-01",
  status: "draft",
});

/* ------------------------------------------------------------- detection --- */

describe("what an uploaded file is", () => {
  it("recognises a PDF this app itself produced", () => {
    expect(detectSourceFormat(REAL_PDF)).toBe("pdf");
  });

  it("recognises a Word document", () => {
    expect(detectSourceFormat(buildDocx(["Coaching Form"]))).toBe("docx");
  });

  it("recognises a Word 97-2003 document", () => {
    expect(detectSourceFormat(buildLegacyDoc())).toBe("doc");
  });

  it("does not mistake another zip for a Word document", () => {
    // A .xlsx is a zip too. `word/document.xml` is what separates them, and the
    // entry name is stored uncompressed, so it is there to be found.
    const spreadsheet = buildZip([{ name: "xl/workbook.xml", content: "<workbook/>" }]);
    expect(detectSourceFormat(spreadsheet)).toBeNull();
  });

  it("does not mistake another OLE2 container for a Word document", () => {
    expect(detectSourceFormat(buildLegacyDoc({ word: false }))).toBeNull();
  });

  it("goes by the bytes, never by the name", () => {
    /*
     * The file name is something a browser sends. A Word document called
     * `.pdf` must still be read as Word — otherwise it reaches the PDF parser,
     * fails there, and is reported to an administrator as a corrupt PDF when
     * the file is perfectly good.
     */
    expect(detectSourceFormat(buildDocx(["Named badly"]))).toBe("docx");
    expect(detectSourceFormat(new TextEncoder().encode("%PDF-1.7 not really"))).toBe("pdf");
  });

  it("recognises nothing in a file that is neither", () => {
    expect(detectSourceFormat(new TextEncoder().encode("just some text"))).toBeNull();
    expect(detectSourceFormat(new Uint8Array(0))).toBeNull();
  });
});

/* ------------------------------------------------------------ inspection --- */

describe("inspecting an uploaded file", () => {
  it("accepts a PDF and reports its pages", async () => {
    const inspection = await inspectSourceDocument(REAL_PDF);
    expect(inspection.ok).toBe(true);
    expect(inspection.format).toBe("pdf");
    expect(inspection.contentType).toBe(PDF_CONTENT_TYPE);
    expect(inspection.pageCount).toBeGreaterThanOrEqual(1);
    expect(inspection.rejection).toBeNull();
  });

  it("accepts a Word document, reads it, and stores it as Word", async () => {
    const inspection = await inspectSourceDocument(
      buildDocx(["Coaching Form", "Employee Information", "Type of Coaching"]),
    );
    expect(inspection.ok).toBe(true);
    expect(inspection.format).toBe("docx");
    expect(inspection.contentType).toBe(DOCX_CONTENT_TYPE);
    expect(inspection.extension).toBe(".docx");
    expect(inspection.word?.readable).toBe(true);
    expect(inspection.word?.paragraphs).toBe(3);
    expect(inspection.rejection).toBeNull();
  });

  it("accepts a Word 97-2003 document without claiming to have read it", async () => {
    const inspection = await inspectSourceDocument(buildLegacyDoc());
    expect(inspection.ok).toBe(true);
    expect(inspection.format).toBe("doc");
    expect(inspection.contentType).toBe(DOC_CONTENT_TYPE);
    expect(inspection.word?.readable).toBe(false);
    expect(inspection.notes[0]).toContain("not read");
  });

  it("never reports a Word document as fillable", async () => {
    /*
     * `hasFields` is what decides whether the app offers to map fields and
     * write values into a stored file. Nothing here can write into a .docx, so
     * it must stay false — for the readable format and the unreadable one
     * alike. Saying otherwise would offer a mapping that silently does nothing.
     */
    for (const bytes of [buildDocx(["anything"]), buildLegacyDoc()]) {
      const inspection = await inspectSourceDocument(bytes);
      expect(inspection.acroform.hasFields).toBe(false);
      expect(inspection.acroform.fieldNames).toEqual([]);
      expect(inspection.renderer).toBe("structured");
    }
  });

  it("refuses a file that is neither, and says so", async () => {
    const inspection = await inspectSourceDocument(
      new TextEncoder().encode("this is a text file"),
    );
    expect(inspection.ok).toBe(false);
    expect(inspection.format).toBeNull();
    expect(inspection.rejection).toContain("not a PDF or a Word document");
    expect(inspection.rejection).toContain("previous version is still active");
  });

  it("refuses a Word document it cannot open, without throwing", async () => {
    // A .docx whose zip directory says one thing and whose bytes say another.
    const damaged = buildDocx(["intact"]);
    damaged.set([0x00, 0x00, 0x00, 0x00], damaged.byteLength - 10);
    const inspection = await inspectSourceDocument(damaged);
    expect(inspection.ok).toBe(false);
    expect(inspection.format).toBe("docx");
    expect(inspection.rejection).toBeTruthy();
  });

  it("leaves the caller's bytes intact for the digest and the upload", async () => {
    /*
     * The route hashes the bytes and uploads them AFTER inspecting them. A
     * reader that takes ownership of the array — pdf.js detaches its buffer —
     * would leave the route hashing nothing. Asserted for both formats, because
     * the PDF side already had to be fixed for it once.
     */
    for (const bytes of [REAL_PDF, buildDocx(["keep me"])]) {
      const before = bytes.slice();
      await inspectSourceDocument(bytes);
      expect(bytes.byteLength).toBe(before.byteLength);
      expect(Array.from(bytes.subarray(0, 32))).toEqual(Array.from(before.subarray(0, 32)));
    }
  });
});

describe("what the file picker offers", () => {
  it("names both Word formats and PDF, by extension and by type", () => {
    // A browser matches `accept` on either, and Windows sends neither reliably
    // for a .doc — so both spellings are listed for all three.
    for (const token of [
      ".pdf",
      ".docx",
      ".doc",
      PDF_CONTENT_TYPE,
      DOCX_CONTENT_TYPE,
      DOC_CONTENT_TYPE,
    ]) {
      expect(ACCEPTED_UPLOAD_TYPES.split(",")).toContain(token);
    }
  });
});
