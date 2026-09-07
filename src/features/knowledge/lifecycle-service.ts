import { isDemoMode } from "@/lib/config/runtime";
import type { KnowledgeDocument } from "@/types";

/**
 * The Knowledge Base screen's one route to document lifecycle actions.
 *
 * demo -> resolved locally against the app store, so retry, re-index and delete
 *         all behave correctly with no services configured.
 *
 * live -> the server routes, which run the real pipeline over the stored
 *         original and remove the real objects.
 *
 * Components call these functions; they import no Supabase client, no key and
 * no route path beyond what is here.
 */

export interface LifecycleOutcome {
  document?: KnowledgeDocument;
  chunkCount?: number;
  reusedExistingEmbeddings?: boolean;
}

export function lifecycleIsLive(): boolean {
  return !isDemoMode();
}

/**
 * Re-runs processing over the document's stored original.
 *
 * One function for both retry and re-index, because they are the same
 * operation: a failed run and a deliberate refresh both mean "process the bytes
 * we already have again". `force` re-embeds even unchanged content, which is
 * what an explicit re-index means.
 */
export async function reindexDocument(input: {
  documentId: string;
  /*
   * NO CORPUS. The server derives it from the active brand, so sending one
   * could only be ignored or trusted — and a client that keeps sending an
   * authority-looking value invites a future edit to trust it again. `force` is
   * still genuinely the caller's choice.
   */
  force?: boolean;
}): Promise<LifecycleOutcome> {
  const response = await fetch(
    `/api/knowledge/documents/${encodeURIComponent(input.documentId)}/reindex`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: input.force === true }),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as LifecycleOutcome & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "The document could not be re-indexed.");
  }
  return payload;
}

export async function deleteDocument(input: {
  documentId: string;
}): Promise<void> {
  const response = await fetch(
    `/api/knowledge/documents/${encodeURIComponent(input.documentId)}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "The document could not be deleted.");
  }
}

/**
 * How long the demo pretends processing takes.
 *
 * The demo has no pipeline to wait for, but a lifecycle that resolved instantly
 * would not show the states this screen exists to demonstrate. Exported so the
 * delay is one number rather than a literal sprinkled through components.
 */
export const DEMO_PROCESSING_MS = 1600;

/**
 * Demo-mode processing outcome.
 *
 * Deterministic rather than random: a document whose title says it should fail
 * fails, so the failed and retry states can be demonstrated on demand instead
 * of being waited for. Nothing else fails.
 */
export function demoProcessingOutcome(document: KnowledgeDocument): {
  status: KnowledgeDocument["status"];
  indexed: boolean;
  failureReason?: string;
} {
  const marker = `${document.title} ${document.fileName}`.toLowerCase();
  if (marker.includes("[fail]")) {
    return {
      status: "failed",
      indexed: false,
      failureReason:
        "Demo: no text could be extracted from this document. In live mode this is what a scanned PDF with no text layer looks like — run OCR on it, or upload a text version, then retry.",
    };
  }
  return { status: "ready", indexed: true };
}

/* ------------------------------------------------- the original file --- */

export interface OriginalFileLink {
  url: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  previewable: boolean;
  expiresInSeconds: number;
}

/**
 * A short-lived signed URL for the document's ORIGINAL stored file.
 *
 * THE BROWSER SENDS A DOCUMENT ID AND A MODE. Not a corpus and not a storage
 * path — the server derives the knowledge corpus from the active brand, and
 * reads the path off the row and re-validates it before signing.
 *
 * The scope used to be sent from here. It was removed rather than left as a
 * harmless-looking parameter, because a value a client keeps sending is a value
 * somebody eventually starts trusting again.
 *
 * `download` sets the saved filename to the one the manager uploaded;
 * `preview` leaves it inline so a PDF renders instead of downloading.
 */
export async function documentFileLink(input: {
  documentId: string;
  mode: "download" | "preview";
}): Promise<OriginalFileLink> {
  const response = await fetch(
    `/api/knowledge/documents/${encodeURIComponent(input.documentId)}/file` +
      `?mode=${input.mode}`,
  );

  const payload = (await response.json().catch(() => ({}))) as Partial<OriginalFileLink> & {
    error?: string;
  };

  if (!response.ok || !payload.url) {
    // The server's own wording. Its handlers never name a storage path or echo
    // a provider error.
    throw new Error(payload.error ?? "The file could not be opened. Try again in a moment.");
  }
  return payload as OriginalFileLink;
}
