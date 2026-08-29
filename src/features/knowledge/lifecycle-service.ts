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
  scopeId: string;
  force?: boolean;
}): Promise<LifecycleOutcome> {
  const response = await fetch(
    `/api/knowledge/documents/${encodeURIComponent(input.documentId)}/reindex`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeId: input.scopeId, force: input.force === true }),
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
  scopeId: string;
}): Promise<void> {
  const response = await fetch(
    `/api/knowledge/documents/${encodeURIComponent(input.documentId)}?scope=${encodeURIComponent(input.scopeId)}`,
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
