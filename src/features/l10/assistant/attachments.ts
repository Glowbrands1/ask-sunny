// Copied from the Leadership Hub (src/components/assistant/attachments.ts); keep in step with it. See src/features/l10/README.md.
import type { FileUIPart } from "ai";

/** The Hub's limits (src/lib/assistant/config.ts); the Hub's partner config sends the same, and the server checks again. */
export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ATTACH_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";

const OK = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/;

export function attachmentProblem(file: { name: string; type: string; size: number }): string | undefined {
  if (!OK.test(file.type)) return `${file.name}: only images (PNG, JPG, GIF, WebP) and PDFs can be attached.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than 10 MB.`;
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
  const mediaType = /^data:([^;,]+)/.exec(url)?.[1] ?? file.type;
  return { type: "file", mediaType, url, filename: file.name };
}
