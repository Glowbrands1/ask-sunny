import { UPLOAD_LIMITS } from "@/lib/config/models";
import type { DocumentFileType } from "@/types";
import { IngestionError } from "./errors";

/**
 * SERVER-SIDE FILE VALIDATION.
 *
 * The upload dialog validates too, for a fast message — but the browser is not
 * a trust boundary. Every upload is re-validated here, on the server, before a
 * single byte is written to storage.
 *
 * Validation is by extension AND declared MIME type: a file must match one of
 * the supported kinds on both, so `payload.exe` renamed to `payload.pdf` with a
 * bogus content type does not get through.
 */

export type SupportedFileType = Extract<DocumentFileType, "pdf" | "docx" | "txt">;

interface SupportedKind {
  type: SupportedFileType;
  extensions: string[];
  /** Accepted `Content-Type` values. Browsers are inconsistent, so several. */
  mimeTypes: string[];
  label: string;
}

export const SUPPORTED_KINDS: SupportedKind[] = [
  {
    type: "pdf",
    extensions: ["pdf"],
    mimeTypes: ["application/pdf", "application/x-pdf"],
    label: "PDF",
  },
  {
    type: "docx",
    extensions: ["docx"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    label: "Word (.docx)",
  },
  {
    type: "txt",
    extensions: ["txt", "md", "markdown"],
    mimeTypes: ["text/plain", "text/markdown", "text/x-markdown"],
    label: "Plain text",
  },
];

export const SUPPORTED_LABEL = SUPPORTED_KINDS.map((k) => k.label).join(", ");

/** Lowercase extension with no dot. Empty string when the name has none. */
export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Strips parameters such as `; charset=utf-8` and lowercases. */
export function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]!.trim().toLowerCase();
}

export interface ValidatedUpload {
  fileType: SupportedFileType;
  extension: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadCandidate {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Throws IngestionError with a useful message for anything unsupported. An
 * unsupported type never succeeds silently.
 */
export function validateUpload(candidate: UploadCandidate): ValidatedUpload {
  const extension = extensionOf(candidate.fileName);
  const mimeType = normalizeMimeType(candidate.mimeType || "");

  if (!extension) {
    throw new IngestionError(
      "unsupported_type",
      `"${candidate.fileName}" has no file extension. Supported types: ${SUPPORTED_LABEL}.`,
    );
  }

  const byExtension = SUPPORTED_KINDS.find((kind) =>
    kind.extensions.includes(extension),
  );

  if (!byExtension) {
    throw new IngestionError(
      "unsupported_type",
      `.${extension} files are not supported yet. Supported types: ${SUPPORTED_LABEL}.`,
    );
  }

  // An empty or generic content type is accepted (some browsers send
  // "application/octet-stream" for .md); a content type that names a DIFFERENT
  // supported kind is not — that is a mismatch worth rejecting.
  const declaredKind = SUPPORTED_KINDS.find((kind) =>
    kind.mimeTypes.includes(mimeType),
  );
  if (declaredKind && declaredKind.type !== byExtension.type) {
    throw new IngestionError(
      "unsupported_type",
      `"${candidate.fileName}" claims to be ${declaredKind.label} but has a .${extension} extension. Re-save the file and try again.`,
    );
  }
  if (!declaredKind && mimeType && !isGenericMimeType(mimeType)) {
    throw new IngestionError(
      "unsupported_type",
      `"${candidate.fileName}" was sent as "${mimeType}", which is not a supported document type. Supported types: ${SUPPORTED_LABEL}.`,
    );
  }

  if (candidate.sizeBytes < UPLOAD_LIMITS.minBytes) {
    throw new IngestionError(
      "empty_file",
      `"${candidate.fileName}" is empty. There is nothing to index.`,
    );
  }

  if (candidate.sizeBytes > UPLOAD_LIMITS.maxBytes) {
    const limitMb = Math.round(UPLOAD_LIMITS.maxBytes / (1024 * 1024));
    throw new IngestionError(
      "too_large",
      `"${candidate.fileName}" is larger than the ${limitMb} MB limit.`,
    );
  }

  return {
    fileType: byExtension.type,
    extension,
    mimeType: mimeType || byExtension.mimeTypes[0]!,
    sizeBytes: candidate.sizeBytes,
  };
}

function isGenericMimeType(mimeType: string): boolean {
  return (
    mimeType === "application/octet-stream" ||
    mimeType === "binary/octet-stream" ||
    mimeType === "application/download"
  );
}
