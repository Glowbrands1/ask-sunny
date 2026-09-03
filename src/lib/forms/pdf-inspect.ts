import { getDocumentProxy } from "unpdf";

/**
 * WHAT AN UPLOADED PDF ACTUALLY IS.
 *
 * "Replace with new PDF" cannot mean "and now Ask Sunny fills it in". A PDF is
 * fillable only if it carries AcroForm fields; most business PDFs — including
 * every reference capture supplied for this feature, checked and confirmed —
 * carry none at all. They are pictures of forms.
 *
 * So an upload is INSPECTED, and the answer decides what the file is allowed to
 * be:
 *
 *   NO ACROFORM FIELDS -> it is accepted as the official REFERENCE copy. The
 *   downloaded form keeps coming from the structured renderer, which fills the
 *   published template version and prints in the corporate style. The upload is
 *   stored, versioned and downloadable, and nothing pretends it can be filled.
 *
 *   ACROFORM FIELDS PRESENT -> the field names are enumerated and offered for
 *   mapping to template keys. It becomes fillable only once a mapping exists
 *   and validates. Until then it behaves like the case above.
 *
 *   NOT A PDF, OR UNREADABLE -> rejected outright. The row is kept with the
 *   reason, the previous version stays active, and nothing downstream changes.
 *
 * That is what "fail closed" means here: the failure mode of an unexpected
 * upload is the previous, working document — never a blank page where a
 * disciplinary record should be.
 */

export interface AcroFormSummary {
  /** True only when the file carries real, named form fields. */
  hasFields: boolean;
  fieldNames: string[];
  fieldCount: number;
}

export interface PdfInspection {
  ok: boolean;
  pageCount: number | null;
  acroform: AcroFormSummary;
  /** How a generated download will be produced if this becomes active. */
  renderer: "structured" | "acroform";
  /** Set when the file cannot be accepted at all. */
  rejection: string | null;
  notes: string[];
}

const PDF_MAGIC = "%PDF-";

/** Cheap structural check before anything is parsed. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 8));
  return head.startsWith(PDF_MAGIC);
}

/**
 * Reads an uploaded PDF and reports what can honestly be done with it.
 *
 * Never throws for a bad file: an unreadable upload is a REJECTION with a
 * reason, because "the administrator uploaded something odd" is a normal event
 * that must be recorded, not an exception that loses the audit trail.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  const empty: AcroFormSummary = { hasFields: false, fieldNames: [], fieldCount: 0 };

  if (!looksLikePdf(bytes)) {
    return {
      ok: false,
      pageCount: null,
      acroform: empty,
      renderer: "structured",
      rejection: "That file is not a PDF — it does not begin with %PDF-.",
      notes: [],
    };
  }

  let pageCount: number | null = null;
  let fieldNames: string[] = [];

  try {
    const pdf = await getDocumentProxy(bytes);
    pageCount = pdf.numPages;

    try {
      const fields = await pdf.getFieldObjects();
      fieldNames = fields ? Object.keys(fields) : [];
    } catch {
      // A document with no AcroForm dictionary throws rather than returning
      // nothing. That is the common case, and it is not an error.
      fieldNames = [];
    }
  } catch (error) {
    return {
      ok: false,
      pageCount: null,
      acroform: empty,
      renderer: "structured",
      rejection: `The PDF could not be read: ${(error as Error).message}`,
      notes: [],
    };
  }

  if (pageCount === null || pageCount < 1) {
    return {
      ok: false,
      pageCount,
      acroform: empty,
      renderer: "structured",
      rejection: "The PDF contains no pages.",
      notes: [],
    };
  }

  const acroform: AcroFormSummary = {
    hasFields: fieldNames.length > 0,
    fieldNames: fieldNames.slice(0, 200),
    fieldCount: fieldNames.length,
  };

  const notes = acroform.hasFields
    ? [
        `${acroform.fieldCount} fillable field${acroform.fieldCount === 1 ? "" : "s"} found. Map them to template fields before Ask Sunny can fill this PDF; until then generated downloads use the structured renderer.`,
      ]
    : [
        "No fillable fields in this PDF, so it is stored as the official reference copy. Generated downloads are produced by the structured renderer from the published template version.",
      ];

  return {
    ok: true,
    pageCount,
    acroform,
    // Never `acroform` on upload alone: a mapping has to exist and validate
    // first, and that is a separate, explicit step.
    renderer: "structured",
    rejection: null,
    notes,
  };
}

/**
 * Validates a proposed AcroForm mapping against both sides.
 *
 * Both directions matter. A mapping that names a PDF field the file does not
 * have would silently drop a value; one that names a template key the version
 * does not have would write a value nobody can see. Either is a refusal.
 */
export function validateFieldMap(
  mapping: Record<string, string>,
  pdfFieldNames: readonly string[],
  templateKeys: readonly string[],
): { ok: boolean; problems: string[] } {
  const pdfFields = new Set(pdfFieldNames);
  const keys = new Set(templateKeys);
  const problems: string[] = [];

  for (const [pdfField, templateKey] of Object.entries(mapping)) {
    if (!pdfFields.has(pdfField)) {
      problems.push(`The PDF has no field called "${pdfField}".`);
    }
    if (!keys.has(templateKey)) {
      problems.push(`The template has no field called "${templateKey}".`);
    }
  }

  const targets = Object.values(mapping);
  const duplicated = targets.filter((key, index) => targets.indexOf(key) !== index);
  for (const key of new Set(duplicated)) {
    problems.push(`Two PDF fields both map to "${key}".`);
  }

  return { ok: problems.length === 0, problems };
}

/** SHA-256 of the uploaded bytes, for the version chain and for de-duplication. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes);
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Where an uploaded PDF lives.
 *
 * Derived server-side from the template and the digest, never taken from the
 * request: an attacker-chosen path is how one tenant's upload lands on top of
 * another's. The digest in the path also makes the same bytes idempotent.
 */
export function buildAssetPath(
  templateKey: string,
  version: number,
  digest: string,
  fileName: string,
): string {
  const safeName =
    fileName
      .replace(/[^a-zA-Z0-9.\-_]+/g, "-")
      // Runs of dots collapse to one, and a leading dot or dash is dropped.
      // Slashes are already gone, so this cannot traverse — but a stored name
      // beginning ".." reads like an attempt to, and tools downstream treat a
      // leading dot as hidden.
      .replace(/\.{2,}/g, ".")
      .replace(/-+/g, "-")
      .replace(/^[.\-]+/, "")
      .slice(-80) || "upload.pdf";
  return `${templateKey}/v${version}/${digest.slice(0, 16)}/${safeName}`;
}
