/**
 * STORAGE PATH SAFETY.
 *
 * Users never choose a storage path. The server derives one from a scope id, a
 * server-generated document id and a sanitized file name, so:
 *   - `../` and absolute paths cannot escape the prefix,
 *   - two uploads of "policy.pdf" cannot collide,
 *   - a crafted file name cannot address another tenant's object.
 *
 * `assertPathWithinScope` is the guard every read/delete goes through, so a
 * path arriving from a request body can never point outside its own scope.
 */

const UNSAFE = /[^a-zA-Z0-9._-]+/g;

/**
 * Reduces a client-supplied file name to a safe leaf name. Never returns an
 * empty string, a dot-segment, or anything containing a separator.
 */
export function sanitizeFileName(fileName: string, fallback = "document"): string {
  // Take the leaf: everything before the last separator is discarded outright.
  const leaf = fileName.split(/[\\/]/).pop() ?? "";

  const cleaned = leaf
    .normalize("NFKD")
    .replace(UNSAFE, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");

  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;

  // Keep the extension while capping the stem, so long names stay readable.
  const dot = cleaned.lastIndexOf(".");
  if (dot <= 0) return cleaned.slice(0, 96);
  const stem = cleaned.slice(0, dot).slice(0, 80) || fallback;
  const ext = cleaned.slice(dot + 1).slice(0, 12);
  return `${stem}.${ext}`;
}

/**
 * Collision-safe object key: `<scope>/<documentId>/v<version>/<safe name>`.
 *
 * The document id is server-generated and the version is monotonic, so
 * re-uploading the same title never overwrites the bytes of an earlier version.
 */
export function buildStoragePath(input: {
  scopeId: string;
  documentId: string;
  version: number;
  fileName: string;
}): string {
  const scope = sanitizeSegment(input.scopeId, "default");
  const documentId = sanitizeSegment(input.documentId, "document");
  const version = Math.max(1, Math.floor(input.version));
  return `${scope}/${documentId}/v${version}/${sanitizeFileName(input.fileName)}`;
}

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value.replace(UNSAFE, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

/** The prefix every object for a scope must live under. */
export function scopePrefix(scopeId: string): string {
  return `${sanitizeSegment(scopeId, "default")}/`;
}

/**
 * Guard for any path that arrived from outside. Throws unless the path is a
 * plain relative key inside the given scope.
 */
export function assertPathWithinScope(path: string, scopeId: string): string {
  const prefix = scopePrefix(scopeId);

  if (!path || path.length > 512) {
    throw new Error("Invalid storage path.");
  }
  if (path.startsWith("/") || path.includes("\\") || path.includes("//")) {
    throw new Error("Invalid storage path.");
  }
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error("Invalid storage path.");
  }
  if (!path.startsWith(prefix)) {
    throw new Error("Storage path is outside the requested knowledge scope.");
  }
  return path;
}
