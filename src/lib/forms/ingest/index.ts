import "server-only";

import { parseFormDocument, type FormDocument } from "../document";
import { detectSourceFormat, type SourceFormat } from "../source-format";
import { alignToCurrent } from "./align";
import { buildOutline, type SourceOutline } from "./outline";
import type { FormProposal } from "./proposal";
import { readDocx } from "./read-docx";
import { readPdf } from "./read-pdf";
import { refineUnresolved } from "./refine";
import { outlineToDocument } from "./to-document";

/**
 * ============================================================================
 * AN UPLOADED DOCUMENT, READ INTO A PROPOSED FORM
 * ============================================================================
 *
 * The nine steps this feature was asked for, each in its own module, joined
 * here and nowhere else:
 *
 *   storage        already existed — `form_template_assets` and the bucket
 *   parsing        `read-pdf.ts`, `read-docx.ts`   -> lines
 *   interpretation `outline.ts`                    -> the outline
 *   refinement     `refine.ts`                     -> kinds for what is left
 *   generation     `to-document.ts`                -> the engine's blocks
 *   alignment      `align.ts`                      -> keys the form already has
 *   validation     `parseFormDocument`             -> the reader that stores it
 *   draft          the caller, via `openDraft`/`saveDraft`
 *   publication    a person, via the existing publish button
 *
 * NOTHING HERE PUBLISHES ANYTHING. This function returns a document and a
 * report; it does not know what a current version is. That separation is what
 * makes "extraction can never overwrite the active form" a fact about the call
 * graph rather than a promise about behaviour.
 *
 * VALIDATION IS THE ENGINE'S OWN READER. The generated document is passed
 * through `parseFormDocument` — the same function the database read runs, which
 * refuses an unknown block kind, a duplicate field key or a missing
 * responsibility. A document that cannot survive being stored and read back
 * never becomes a proposal, so a bad extraction fails HERE, with the active
 * form untouched, rather than at render time on somebody's screen.
 */

export interface IngestInput {
  bytes: Uint8Array;
  fileName: string;
  /** The published document this would replace, or null for a new form. */
  current: FormDocument | null;
  /** Whether the model may classify lines the rules could not place. */
  refine?: boolean;
}

export interface IngestSuccess {
  ok: true;
  format: SourceFormat;
  document: FormDocument;
  outline: SourceOutline;
  /** Everything but the identity — the caller stamps that on. */
  report: Omit<FormProposal, "assetId" | "fileName" | "extractedAt" | "extractedBy" | "format">;
  notes: string[];
}

export interface IngestFailure {
  ok: false;
  format: SourceFormat | null;
  reason: string;
}

export type IngestResult = IngestSuccess | IngestFailure;

/** Guards a pathological upload from becoming a pathological document. */
const MAX_LINES = 4000;
const MAX_BLOCKS = 1200;

export async function ingestSourceDocument(input: IngestInput): Promise<IngestResult> {
  const format = detectSourceFormat(input.bytes);

  if (format === null) {
    return {
      ok: false,
      format: null,
      reason:
        "That file is not a PDF or a Word document, so there was nothing to read a form out of.",
    };
  }
  if (format === "doc") {
    /*
     * THE LEGACY BINARY FORMAT IS STORED, NOT READ.
     *
     * Nothing in this project parses Word 97-2003, and the honest options were
     * a conversion dependency or a clear refusal. A converter here would mean
     * running a document renderer over an untrusted upload inside the request
     * path, which is a large attack surface bought for one obsolete format. The
     * file is still stored, still versioned, still the official copy — only the
     * automatic reading is refused, and it says how to get it.
     */
    return {
      ok: false,
      format,
      reason:
        "This is a Word 97-2003 (.doc) file. It has been kept as the official copy, but its contents cannot be read into a form — open it in Word and use Save As to produce a .docx, then upload that.",
    };
  }

  let reading;
  try {
    reading = format === "pdf" ? await readPdf(input.bytes) : await readDocx(input.bytes);
  } catch (error) {
    return {
      ok: false,
      format,
      reason: `That document could not be opened: ${(error as Error).message}`,
    };
  }

  if (reading.lines.length === 0) {
    return {
      ok: false,
      format,
      reason: "That document has no readable text in it, so there was no form to read.",
    };
  }
  if (reading.lines.length > MAX_LINES) {
    return {
      ok: false,
      format,
      reason: `That document has ${reading.lines.length} lines, which is past the ${MAX_LINES}-line limit for reading a form out of one.`,
    };
  }

  /*
   * THE BRAND IS SUPPLIED FROM THE FORM BEING REPLACED, not read off the page.
   * It settles one question the rules cannot: whether the line under the title
   * is the company name or the first section heading. See `OutlineOptions`.
   */
  const brand = houseBrand(input.current);
  let outline = buildOutline(reading.lines, { brand });
  const notes = [...reading.notes];

  if (input.refine && outline.unresolved.length > 0) {
    const refinement = await refineUnresolved(outline.unresolved);
    notes.push(...refinement.notes);
    if (Object.keys(refinement.hints).length > 0) {
      outline = buildOutline(reading.lines, { brand, hints: refinement.hints });
    }
  }

  const generated = outlineToDocument(outline);
  if (generated.document.blocks.length === 0) {
    return {
      ok: false,
      format,
      reason: "Nothing in that document read as a form — no headings, fields or options.",
    };
  }
  if (generated.document.blocks.length > MAX_BLOCKS) {
    return {
      ok: false,
      format,
      reason: `That document produced ${generated.document.blocks.length} blocks, which is past the ${MAX_BLOCKS}-block limit.`,
    };
  }

  const aligned = alignToCurrent(generated.document, input.current);

  let validated: FormDocument;
  try {
    validated = parseFormDocument(aligned.document);
  } catch (error) {
    return {
      ok: false,
      format,
      reason: `The form read out of that document could not be stored: ${(error as Error).message}`,
    };
  }

  return {
    ok: true,
    format,
    document: validated,
    outline,
    notes,
    report: {
      warnings: [...generated.warnings, ...aligned.warnings],
      unresolved: outline.unresolved,
      alignment: aligned.report,
      stats: countBlocks(validated),
    },
  };
}

function houseBrand(current: FormDocument | null): string | null {
  const letterhead = current?.blocks.find((block) => block.kind === "letterhead");
  return letterhead && letterhead.kind === "letterhead" ? letterhead.brand : null;
}

function countBlocks(document: FormDocument) {
  let fields = 0;
  let groups = 0;
  let signatures = 0;
  for (const block of document.blocks) {
    if (block.kind === "field") fields += 1;
    if (block.kind === "field_row") fields += block.fields.length;
    if (block.kind === "checkbox_group") groups += 1;
    if (block.kind === "signature_row") signatures += 1;
  }
  return { blocks: document.blocks.length, fields, groups, signatures };
}

export { buildOutline } from "./outline";
export { alignToCurrent } from "./align";
export { outlineToDocument } from "./to-document";
