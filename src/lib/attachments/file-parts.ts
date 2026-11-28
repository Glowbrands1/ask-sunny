// Copied from the Leadership Hub (src/components/assistant/attachments.ts); keep in step with it. See src/features/l10/README.md.
// Shared by the DM L10 panel (features/l10/assistant/attachments.ts re-exports it) and the main chat composer.
/** The AI SDK's file part (`FileUIPart` in "ai"), spelled out so this shared module never names the AI SDK (`form-patch-flags-off.test.ts`). */
export interface FileUIPart {
  type: "file";
  mediaType: string;
  url: string;
  filename?: string;
}

/** The Hub's limits (src/lib/assistant/config.ts); the Hub's partner config sends the same, and the server checks again. */
export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ATTACH_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";

const OK = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/;

/*
 * THE MAIN CHAT TAKES THE SAME FILES, PLUS WORD AND PLAIN TEXT (Pau, 26 Nov 2026: managers attach files in the main
 * chat, "just like the Leadership Hub assistant"). Same limits and the same encoding as the panel's; the server reads a
 * .docx and a text file as text (`lib/chat/attachments.server.ts`), because Claude reads only images and PDFs natively.
 * The DM L10 panel takes the same list since 27 Nov 2026, as the Hub's assistant now does (Leadership Hub PR #128):
 * its route reads the files with this app's reader (`readAttachments`). ATTACH_ACCEPT is the images-and-PDFs base.
 */
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/* Excel (the owner, 26 Nov 2026: "PDFs, images, Word (.docx) and Excel"), read on the server as text, sheet by sheet. */
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CHAT_ATTACH_ACCEPT = `${ATTACH_ACCEPT},${DOCX_TYPE},.docx,${XLSX_TYPE},.xlsx,text/plain,.txt,text/csv,.csv,text/markdown,.md`;
const CHAT_OK = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|text\/(plain|csv|markdown))$/;
const BY_EXTENSION: Record<string, string> = { docx: DOCX_TYPE, xlsx: XLSX_TYPE, md: "text/markdown", csv: "text/csv", txt: "text/plain", doc: "application/msword", xls: "application/vnd.ms-excel" };

/** What a picked file is, by its type or (a browser that gives a .md or .csv no type) its extension. */
export function attachmentType(file: { name: string; type: string }): string {
  if (file.type && file.type !== "application/octet-stream") return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? file.type;
}

/** An older Office file (.doc, .xls) cannot be read: the manager is told to save it in the newer format, by name. */
export function olderOfficeFileProblem(name: string, mediaType: string): string | undefined {
  if (mediaType === "application/msword") return `${name} is an older Word file (.doc), which can't be read. Re-save it as .docx or PDF and attach it again.`;
  if (mediaType === "application/vnd.ms-excel") return `${name} is an older Excel file (.xls), which can't be read. Re-save it as .xlsx or PDF and attach it again.`;
}

export function attachmentProblem(file: { name: string; type: string; size: number }, accepts: "panel" | "chat" = "panel"): string | undefined {
  if (accepts === "chat" && olderOfficeFileProblem(file.name, attachmentType(file))) return olderOfficeFileProblem(file.name, attachmentType(file));
  if (accepts === "chat" ? !CHAT_OK.test(attachmentType(file)) : !OK.test(file.type)) {
    return accepts === "chat"
      ? `${file.name}: only images (PNG, JPG, GIF, WebP), PDFs, Word (.docx), Excel (.xlsx) and text files can be attached.`
      : `${file.name}: only images (PNG, JPG, GIF, WebP) and PDFs can be attached.`;
  }
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
  if (accepts === "chat" && !file.type.startsWith("image/") && sentBytes(file) > MAX_MESSAGE_SEND_BYTES) {
    return `${file.name} is too large to send in the chat (about 2.4 MB at most for a PDF, Word, Excel or text file). Attach a smaller copy, or only the pages you need.`;
  }
}

/*
 * WHAT A MESSAGE CAN CARRY (audit, 28 Nov 2026). Files go to /api/chat inside the request, as base64 (4/3 of the
 * file), and Vercel refuses a request over about 4.5 MB with a bare 413. Images are re-encoded in the browser to about
 * 1.5 MB, but a PDF, Word, Excel or text file went as it was: the composer accepted a 4 MB PDF ("under 10 MB") that the
 * server could never receive. A message's files are now kept under MAX_MESSAGE_SEND_BYTES, leaving room for the words
 * and the conversation, and the manager is told which file does not fit, before anything is sent.
 */
export const MAX_MESSAGE_SEND_BYTES = 3_300_000;

/** What one file adds to the request: an image is re-encoded to about its budget; anything else is base64 of itself. */
export function sentBytes(file: { type: string; size: number }): number {
  const base64 = Math.ceil(file.size / 3) * 4;
  return file.type.startsWith("image/") ? Math.min(base64, IMAGE_BUDGET) : base64;
}

/** Which of `picked` still fit beside `already`, in order, and a sentence for each that does not. */
export function filesThatFit(
  already: readonly { type: string; size: number }[],
  picked: readonly File[],
): { fit: File[]; problems: string[] } {
  let total = already.reduce((sum, file) => sum + sentBytes(file), 0);
  const fit: File[] = [];
  const problems: string[] = [];
  for (const file of picked) {
    const size = sentBytes(file);
    if (total + size > MAX_MESSAGE_SEND_BYTES) {
      problems.push(`${file.name} would make this message too large to send. Send it in a message of its own.`);
      continue;
    }
    total += size;
    fit.push(file);
  }
  return { fit, problems };
}

export function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Longest edge sent to the model. Claude downsizes anything past ~1568 px anyway; 2000 keeps small text in screenshots sharp. */
export const MAX_IMAGE_EDGE = 2000;

/** Target size for one image as base64 (Claude's per-image limit is 5 MB; the whole request must also stay under Vercel's ~4.5 MB). */
const IMAGE_BUDGET = 1_500_000;

/**
 * Re-encodes an image in the browser as a JPEG on white, at most MAX_IMAGE_EDGE px: a damaged, mislabelled (a ".png" that is
 * really HEIC or WebP), animated or very large image is the usual reason the model answers "Could not process image". If the
 * browser can't decode it either, it throws a plain message so the person knows which file is the problem.
 */
export async function normalizedImage(file: File): Promise<string> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return toDataUrl(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name} couldn't be opened as an image. Try saving it as a PNG or JPG (or take a screenshot of it) and attach that.`);
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return toDataUrl(file);
  }
  ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black as JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let url = canvas.toDataURL("image/jpeg", 0.9);
  if (url.length > IMAGE_BUDGET) url = canvas.toDataURL("image/jpeg", 0.75);
  return url;
}

/**
 * The Hub's adapter's `send`, without assistant-ui: one picked file as the AI SDK file part useChat sends. Images are
 * re-encoded in the browser (JPEG on white, ≤ 2000 px, ~1.5 MB) and labelled with what is actually sent; a PDF goes as
 * it is (Claude reads PDFs natively, so there is no server-side parsing).
 */
export async function toFilePart(file: File): Promise<FileUIPart> {
  const isImage = file.type.startsWith("image/");
  const url = isImage ? await normalizedImage(file) : await toDataUrl(file);
  // A file the browser gave no type (a .md, a .csv on some systems) is labelled by its extension, here and in its data URL.
  const typed = attachmentType(file);
  const read = /^data:([^;,]*)/.exec(url)?.[1] ?? "";
  const mediaType = read && read !== "application/octet-stream" ? read : typed;
  return { type: "file", mediaType, url: read === mediaType ? url : url.replace(/^data:[^;,]*/, `data:${mediaType}`), filename: file.name };
}
