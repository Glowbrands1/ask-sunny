import "server-only";

import { AiError } from "@/lib/ai/errors";
import type { ChatFileAttachment } from "@/lib/ai/types";
import { DOCX_TYPE, MAX_FILE_BYTES, MAX_FILES_PER_MESSAGE, XLSX_TYPE, olderOfficeFileProblem } from "@/lib/attachments/file-parts";

/**
 * ============================================================================
 * FILES ATTACHED IN THE MAIN CHAT (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * The composer's attach button sends this turn's files as data URLs, the DM L10 panel's mechanism
 * (`features/l10/assistant/attachments.ts`: the same limits and the same browser-side encoding). Here they are checked
 * again, as the panel's route checks them (`assistant.server.ts` attachmentProblem): the types the composer offers, at
 * most five, at most 10 MB each, inline data only (a remote URL would make the server or the model provider fetch an
 * address the browser chose).
 *
 * Then read for the model, on both paths: images and PDFs go as they are (Claude reads them natively, as in the panel);
 * a Word document and a text file are read here as text, with the same reader the knowledge library uses for .docx.
 * Nothing is stored or logged: not the bytes, not the text.
 */

const IMAGE = /^image\/(png|jpeg|gif|webp)$/;
const TEXT = /^text\/(plain|csv|markdown)$/;
const PDF = "application/pdf";
/**
 * Characters of one Word, Excel or text file the model is given; the rest is left out, and the model is told so.
 * 120,000 to match the Leadership Hub's assistant (the owner, 27 Nov 2026: "make it match 120,000 chars"); it was 60,000.
 * The monthly spend guard still counts every token.
 */
export const ATTACHMENT_TEXT_LIMIT = 120_000;
const NAME_LIMIT = 200;

export function isAcceptedAttachmentType(mediaType: string): boolean {
  return IMAGE.test(mediaType) || TEXT.test(mediaType) || mediaType === PDF || mediaType === DOCX_TYPE || mediaType === XLSX_TYPE;
}

/** The request's `attachments`, checked; absent or empty is no files. Anything else is a 400 with a plain sentence. */
export function parseChatAttachments(raw: unknown): ChatFileAttachment[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new AiError("bad_request", "Attachments must be uploaded from your device.", 400);
  if (raw.length === 0) return undefined;
  if (raw.length > MAX_FILES_PER_MESSAGE) throw new AiError("bad_request", `Attach at most ${MAX_FILES_PER_MESSAGE} files per message.`, 400);
  return raw.map((entry) => {
    const file = (entry ?? {}) as Partial<Record<keyof ChatFileAttachment, unknown>>;
    const mediaType = typeof file.mediaType === "string" ? file.mediaType : "";
    const older = olderOfficeFileProblem(typeof file.filename === "string" && file.filename ? file.filename : "This file", mediaType);
    if (older) throw new AiError("bad_request", older, 400);
    if (!isAcceptedAttachmentType(mediaType)) {
      throw new AiError("bad_request", "Only images (PNG, JPG, GIF, WebP), PDFs, Word (.docx), Excel (.xlsx) and text files can be attached.", 400);
    }
    const url = typeof file.url === "string" ? file.url : "";
    if (!url.startsWith(`data:${mediaType};base64,`)) throw new AiError("bad_request", "Attachments must be uploaded from your device.", 400);
    if (((url.length - url.indexOf(",") - 1) * 3) / 4 > MAX_FILE_BYTES * 1.02) throw new AiError("bad_request", "Each file must be 10 MB or smaller.", 400);
    const filename = (typeof file.filename === "string" ? file.filename : "").replace(/[\r\n\t]+/g, " ").trim().slice(0, NAME_LIMIT) || "attachment";
    return { filename, mediaType, url };
  });
}

/** One attached file, read: as it is (an image, a PDF) or as text (Word, plain text). */
export type ReadAttachment =
  | { readonly kind: "native"; readonly filename: string; readonly mediaType: string; readonly base64: string }
  | { readonly kind: "text"; readonly filename: string; readonly text: string };

const base64Of = (file: ChatFileAttachment) => file.url.slice(file.url.indexOf(",") + 1);

function bounded(filename: string, kind: string, text: string): string {
  const body = text.trim();
  if (body === "") return `ATTACHED FILE: ${filename} (${kind})\n\n[No text could be read from this file.]`;
  const cut = body.length > ATTACHMENT_TEXT_LIMIT;
  return `ATTACHED FILE: ${filename} (${kind})\n\n${cut ? body.slice(0, ATTACHMENT_TEXT_LIMIT) : body}${cut ? `\n\n[The rest of ${filename} was left out: it is longer than ${ATTACHMENT_TEXT_LIMIT.toLocaleString("en-US")} characters.]` : ""}`;
}

export async function readAttachments(files: readonly ChatFileAttachment[] | undefined): Promise<ReadAttachment[]> {
  if (!files || files.length === 0) return [];
  return Promise.all(
    files.map(async (file): Promise<ReadAttachment> => {
      if (IMAGE.test(file.mediaType) || file.mediaType === PDF) return { kind: "native", filename: file.filename, mediaType: file.mediaType, base64: base64Of(file) };
      const bytes = Buffer.from(base64Of(file), "base64");
      if (TEXT.test(file.mediaType)) return { kind: "text", filename: file.filename, text: bounded(file.filename, "text file", bytes.toString("utf8")) };
      if (file.mediaType === XLSX_TYPE) {
        try {
          return { kind: "text", filename: file.filename, text: bounded(file.filename, "Excel workbook", await workbookText(bytes)) };
        } catch {
          return { kind: "text", filename: file.filename, text: `ATTACHED FILE: ${file.filename} (Excel workbook)\n\n[This file could not be read. It may be damaged or password-protected; ask the manager to save it again as .xlsx or PDF and attach it again.]` };
        }
      }
      try {
        const { extractDocx } = await import("@/lib/ingestion/extract/docx");
        const read = await extractDocx(new Uint8Array(bytes));
        const text = read.segments.map((segment) => (segment.section && segment.sectionBeginsHere !== false ? `${segment.section}\n${segment.text}` : segment.text)).join("\n\n");
        return { kind: "text", filename: file.filename, text: bounded(file.filename, "Word document", text) };
      } catch {
        return { kind: "text", filename: file.filename, text: `ATTACHED FILE: ${file.filename} (Word document)\n\n[This file could not be read. It may be an older .doc file or damaged; ask the manager to save it as .docx or PDF and attach it again.]` };
      }
    }),
  );
}

/** An Excel workbook as text: each sheet by name, each row one line, its cells' shown values separated by " | ". */
async function workbookText(bytes: Buffer): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheets: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => cells.push((cell.text ?? "").replace(/\s+/g, " ").trim()));
      while (cells.length > 0 && cells.at(-1) === "") cells.pop();
      if (cells.length > 0) rows.push(cells.join(" | "));
    });
    sheets.push(`Sheet: ${sheet.name}\n${rows.length > 0 ? rows.join("\n") : "[empty]"}`);
  });
  return sheets.join("\n\n");
}

/** The line ahead of the files, so the model knows they are the manager's and by which names. */
export function attachmentsLead(read: readonly ReadAttachment[]): string {
  const names = read.map((file) => file.filename).join(", ");
  return `The manager attached ${read.length === 1 ? "a file" : `${read.length} files`} to this message: ${names}. ${read.length === 1 ? "It is" : "They are"} included above; read ${read.length === 1 ? "it" : "them"} to answer.`;
}

/** For the agent loop (AI SDK user content): the files first, as Claude reads documents best ahead of the question. */
export function attachmentModelParts(read: readonly ReadAttachment[]): ({ type: "file"; data: string; mediaType: string; filename: string } | { type: "text"; text: string })[] {
  return read.map((file) => (file.kind === "native" ? { type: "file" as const, data: file.base64, mediaType: file.mediaType, filename: file.filename } : { type: "text" as const, text: file.text }));
}

export type AnthropicAttachmentBlock =
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title: string }
  | { type: "text"; text: string };

/** For the older path (the Messages API, `call-claude.ts`): the same files as content blocks. */
export function attachmentAnthropicBlocks(read: readonly ReadAttachment[]): AnthropicAttachmentBlock[] {
  return read.map((file): AnthropicAttachmentBlock => {
    if (file.kind === "text") return { type: "text", text: file.text };
    if (file.mediaType === PDF) return { type: "document", source: { type: "base64", media_type: PDF, data: file.base64 }, title: file.filename };
    return { type: "image", source: { type: "base64", media_type: file.mediaType as "image/png", data: file.base64 } };
  });
}
