// Copied from the Leadership Hub (src/lib/meetings/files.ts); keep in step with it. See src/features/l10/README.md.
/**
 * L10 file attachments: the rules shared by the browser, the Server Actions and the tests.
 * Lovable's bucket was 'ids-files' (any type, any member could delete). The hub's is the private 'l10-files', with the
 * same 25 MB limit and the five document types the Salon documents already accept. The same words are in
 * supabase/migrations/20261119120000_l10_files.sql (the database checks again).
 */
import { isMeetingKey } from "./config";

/* From the Hub's src/lib/salon/files.ts (the five document types the L10 files reuse), inlined: Ask Sunny has no Salon files. */
const FILE_NAME_MAX = 120;
const SALON_TYPES: Readonly<Record<string, { ext: string; mime: string; magic: readonly number[] }>> = {
  pdf: { ext: "pdf", mime: "application/pdf", magic: [0x25, 0x50, 0x44, 0x46] },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", magic: [0x50, 0x4b] },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", magic: [0x50, 0x4b] },
  png: { ext: "png", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { ext: "jpg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  jpeg: { ext: "jpg", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
};
const extensionOf = (name: string): string | null => /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase() ?? null;
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const L10_BUCKET = "l10-files";
export const L10_MAX_BYTES = 26_214_400;
export const L10_LINK_SECONDS = 3600;
/** The Salon document types plus PowerPoint (a zip, like docx and xlsx). */
export const FILE_TYPES: Readonly<Record<string, { ext: string; mime: string; magic: readonly number[] }>> = {
  ...SALON_TYPES,
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", magic: [0x50, 0x4b] },
};
export const L10_FILE_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg";
export const L10_TYPE_MESSAGE = "Only PDF, Word (docx), Excel (xlsx), PowerPoint (pptx), PNG and JPG files can be added.";
export { extensionOf, formatBytes };

/** Does the start of the file look like its extension says? (Catches a renamed file; not a virus scan.) */
export function looksLike(ext: string, head: Uint8Array): boolean {
  const t = FILE_TYPES[ext.toLowerCase()];
  return !!t && head.length >= t.magic.length && t.magic.every((b, i) => head[i] === b);
}

export type L10FileError = {
  kind: "validation" | "forbidden" | "signin" | "unavailable" | "missing";
  message: string;
};
export type L10Reply<T> = { ok: true; data: T } | { ok: false; error: L10FileError };

export const fail = (kind: L10FileError["kind"], message: string): { ok: false; error: L10FileError } => ({ ok: false, error: { kind, message } });

/** Issue ids are short random strings (Lovable and the hub both make them from letters and digits). */
export const ISSUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The checks the browser and the Server Action make before anything is uploaded (the bucket checks size and type again). */
export function validateL10Upload(name: unknown, size: unknown): L10FileError | null {
  if (typeof name !== "string" || name.trim() === "") return { kind: "validation", message: "The file needs a name." };
  const nm = name.trim();
  if (nm.length > FILE_NAME_MAX) return { kind: "validation", message: `The file name is too long (at most ${FILE_NAME_MAX} characters).` };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(nm) || /[/\\]/.test(nm)) return { kind: "validation", message: "The file name cannot contain slashes, line breaks or control characters." };
  const ext = extensionOf(nm);
  if (nm.replace(/\.[A-Za-z0-9]+$/, "").trim() === "") return { kind: "validation", message: "The file needs a name before its type (for example Plan.pdf)." };
  if (!ext || !FILE_TYPES[ext]) return { kind: "validation", message: L10_TYPE_MESSAGE };
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return { kind: "validation", message: "The file is empty." };
  if (size > L10_MAX_BYTES) return { kind: "validation", message: `The file is larger than 25 MB (it is ${formatBytes(size)}).` };
  return null;
}

/** A name safe to put in a storage path: letters, digits, '_', '.', '-' only, no '..', at most 120 characters, extension kept. */
export function sanitiseName(name: string): string {
  const raw = (extensionOf(name) ?? "").replace(/[^a-z0-9]/g, "");
  const ext = FILE_TYPES[raw]?.ext ?? raw; // lower case; .jpeg becomes .jpg
  const stem = name.trim().replace(/\.[A-Za-z0-9]+$/, "").normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\w-]+/g, "_").replace(/_+/g, "_").replace(/^[_-]+|[_-]+$/g, "").slice(0, 100) || "file";
  return `${stem}.${ext}`;
}

/** <meeting key>/<issue id>/<random>-<sanitised name>. Null when the key or issue id is not acceptable. */
export function buildPath(key: string, issueId: string, random: string, name: string): string | null {
  if (!isMeetingKey(key) || !ISSUE_ID.test(issueId) || !/^[A-Za-z0-9]{6,40}$/.test(random)) return null;
  return `${key}/${issueId}/${random}-${sanitiseName(name)}`;
}

const NEW_PATH = /^([a-z0-9-]{1,40})\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9]{6,40})-([A-Za-z0-9_.-]{1,120})\.(pdf|docx|xlsx|pptx|png|jpg)$/;
/** A path the hub itself made (what an upload may create). */
export function parseNewPath(path: unknown): { key: string; issueId: string; ext: string } | null {
  if (typeof path !== "string" || path.length > 300 || path.includes("..")) return null;
  const m = NEW_PATH.exec(path);
  return m && isMeetingKey(m[1]) ? { key: m[1], issueId: m[2], ext: m[5] } : null;
}

const ANY_PATH = /^([a-z0-9-]{1,40})\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_.-]{1,200})$/;
/** Any path an issue may point to, including the ones Lovable made (opened read-only). Never contains '..' or an extra folder. */
export function parseOpenPath(path: unknown): { key: string; issueId: string } | null {
  if (typeof path !== "string" || path.length > 300 || path.includes("..")) return null;
  const m = ANY_PATH.exec(path);
  return m && isMeetingKey(m[1]) ? { key: m[1], issueId: m[2] } : null;
}

export const MISSING_FILE_MESSAGE =
  "This file is listed on the issue, but it has not been copied into the new file storage yet, so it cannot be opened for now. Nothing is lost: it is still in the old app.";

/** A reference whose path the hub did not make (from the previous app): it cannot be opened from the new storage. */
export const isLegacyPath = (path: unknown): boolean => parseNewPath(path) === null;

/**
 * Whether an issue's file entry came from the previous app. The path shape alone cannot tell: some old paths happen to look like
 * the hub's own. So every file the hub stores is marked with its bucket, and an entry without the mark is an old one.
 */
export const isLegacyFile = (f: { path: unknown; bucket?: unknown }): boolean => f.bucket !== L10_BUCKET || isLegacyPath(f.path);

/**
 * The file name a download is saved under: the name shown on the issue (what the person attached), never the stored name with its
 * random prefix. Characters that are unsafe in a file name or a header are replaced; the extension always matches the stored file.
 */
export function downloadName(displayName: unknown, path: string): string {
  const stored = path.split("/").pop() ?? "file";
  const fallback = stored.replace(/^[A-Za-z0-9]{6,40}-/, "");
  const ext = /\.([A-Za-z0-9]+)$/.exec(stored)?.[1]?.toLowerCase() ?? "";
  let name = typeof displayName === "string" ? displayName : "";
  name = name.replace(/[\u0000-\u001f\u007f\\/:*?"<>|;]+/g, "_").replace(/\s+/g, " ").trim().replace(/^[. _]+/, "").slice(0, 120);
  if (!name) return fallback;
  if (ext && !new RegExp(`\\.${ext === "jpg" ? "(jpg|jpeg)" : ext}$`, "i").test(name)) name = `${name}.${ext}`;
  return name;
}
