import "server-only";

import { assertPathWithinScope } from "@/lib/ingestion/paths";
import { KNOWLEDGE_BUCKET, getSupabaseAdmin } from "@/lib/supabase/server";
import {
  RESTRICTED_DOWNLOAD_MESSAGE,
  isAdminOnlyDownload,
} from "./restricted-download";
import type { DocumentFileType } from "@/types";

/**
 * ============================================================================
 * THE ORIGINAL FILE A MANAGER UPLOADED, HANDED BACK
 * ============================================================================
 *
 * THE GAP THIS FILLS. The Knowledge Base could ingest a document and never give
 * it back. The detail panel had a "Download original" button wired to
 * `document.blobKey`, which only IndexedDB uploads ever carry — so on a real,
 * live, Supabase-stored document the button did not render and the panel said
 * "This is a seeded demo record, so there is no file to download" about a file
 * the manager had uploaded minutes earlier.
 *
 * ============================================================================
 * WHAT THIS RETURNS, AND WHAT IT REFUSES TO ACCEPT
 * ============================================================================
 *
 * A SHORT-LIVED SIGNED URL, not bytes. The same shape the video playback route
 * uses, for the same reasons: the bucket stays private, Supabase serves the
 * object with range requests intact, and a 50 MB PDF does not travel through a
 * serverless function sized for JSON.
 *
 * THE CALLER SUPPLIES A DOCUMENT ID AND A SCOPE. It does not supply a path, and
 * there is no parameter through which it could. The path is read from the row,
 * and then re-checked with `assertPathWithinScope` — the row is trusted less
 * than it looks, because a row edited outside this app must not become a way to
 * read another scope's objects. That is the same guard `reindexDocument` uses.
 *
 * THE ROW IS SELECTED ON BOTH id AND knowledge_scope_id. An id alone must never
 * reach another corpus, so changing the id in a URL cannot cross a scope
 * boundary: the query simply returns nothing.
 *
 * ONLY THE CURRENT VERSION. `storage_path` on the row IS the current version's
 * object — `buildStoragePath` puts the version in the path and every upload
 * rewrites the column. Earlier versions' objects still exist under the same
 * document prefix, and reaching them would need a deliberate, separately
 * authorized feature rather than a parameter added here.
 */

/** Long enough to start a download or open a preview, short enough to be useless later. */
export const ORIGINAL_FILE_URL_TTL_SECONDS = 120;

/** File types a browser can be trusted to render from a signed URL. */
const PREVIEWABLE: DocumentFileType[] = ["pdf"];

export function isPreviewable(fileType: string): boolean {
  return (PREVIEWABLE as string[]).includes(fileType);
}

export class OriginalFileError extends Error {
  constructor(
    readonly code: "not_found" | "no_object" | "link_failed" | "restricted",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OriginalFileError";
  }
}

export interface OriginalFileLink {
  url: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  previewable: boolean;
  expiresInSeconds: number;
}

/**
 * @param mode `download` sets the attachment filename on the signed URL so the
 *   browser saves it under the name the manager uploaded rather than a storage
 *   key. `preview` leaves it inline so a PDF renders instead of downloading.
 * @param canDownloadRestricted whether this caller may take away a framework or
 *   plain-text SOURCE file. The route passes `canAccessAdminConsole(role)` — the
 *   same admin-console mechanism the Knowledge Base screen uses, not a second
 *   hierarchy. It is required rather than optional and defaults to nothing: a
 *   caller that forgets it fails to compile instead of silently opening the
 *   frameworks to everybody.
 */
export async function originalFileLink(input: {
  documentId: string;
  scopeId: string;
  mode: "download" | "preview";
  canDownloadRestricted: boolean;
}): Promise<OriginalFileLink> {
  const { data, error } = await getSupabaseAdmin()
    .from("knowledge_documents")
    .select(
      "id, title, tags, original_filename, mime_type, file_type, storage_path, status",
    )
    // BOTH columns. An id on its own must not reach another scope's document.
    .eq("id", input.documentId)
    .eq("knowledge_scope_id", input.scopeId)
    .maybeSingle();

  if (error) {
    // The provider's message can name columns and internal state.
    throw new OriginalFileError("not_found", "That document could not be read.", 502);
  }
  if (!data) {
    throw new OriginalFileError("not_found", "That document no longer exists.", 404);
  }

  const row = data as {
    title: string | null;
    tags: string[] | null;
    original_filename: string;
    mime_type: string | null;
    file_type: string;
    storage_path: string | null;
  };

  /*
   * BEFORE ANYTHING IS SIGNED.
   *
   * A signed URL is a bearer credential for the bytes — minting one and then
   * declining to return it would still have created it, and the `preview` mode
   * serves the same object inline. So the refusal happens here, above both
   * modes, and nothing reaches storage on a refused request.
   *
   * PER DOCUMENT, NOT PER ROUTE. This endpoint serves the whole corpus and has
   * to keep handing a manager their training PDF exactly as before; only the
   * framework and plain-text sources are held back.
   */
  if (!input.canDownloadRestricted) {
    const restricted = isAdminOnlyDownload({
      title: row.title,
      fileName: row.original_filename,
      fileType: row.file_type,
      mimeType: row.mime_type,
      tags: row.tags,
    });
    if (restricted) {
      throw new OriginalFileError("restricted", RESTRICTED_DOWNLOAD_MESSAGE, 403);
    }
  }

  if (!row.storage_path) {
    throw new OriginalFileError(
      "no_object",
      "This document has no stored file. Upload it again to replace it.",
      409,
    );
  }

  let path: string;
  try {
    // Re-checked rather than trusted, even though it came from our own row.
    path = assertPathWithinScope(row.storage_path, input.scopeId);
  } catch {
    // The path itself is never echoed — it is the object layout of a private
    // bucket, and a malformed one is a fault to report, not to describe.
    throw new OriginalFileError(
      "no_object",
      "This document's stored file could not be located. Upload it again to replace it.",
      409,
    );
  }

  const fileName = row.original_filename || "document";

  const { data: signed, error: signError } = await getSupabaseAdmin()
    .storage.from(KNOWLEDGE_BUCKET)
    .createSignedUrl(
      path,
      ORIGINAL_FILE_URL_TTL_SECONDS,
      /*
       * `download: <name>` is what makes the saved file carry the manager's own
       * filename instead of a storage key. Omitted for a preview, so the PDF
       * renders in place rather than downloading.
       */
      input.mode === "download" ? { download: fileName } : {},
    );

  if (signError || !signed?.signedUrl) {
    // A storage error names internal paths. Only the category crosses.
    throw new OriginalFileError(
      "link_failed",
      "A download link could not be created. Try again in a moment.",
      502,
    );
  }

  return {
    url: signed.signedUrl,
    fileName,
    fileType: row.file_type,
    mimeType: row.mime_type ?? "application/octet-stream",
    previewable: isPreviewable(row.file_type),
    expiresInSeconds: ORIGINAL_FILE_URL_TTL_SECONDS,
  };
}
