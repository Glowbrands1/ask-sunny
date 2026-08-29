"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import type { KnowledgeDocument } from "@/types";
import {
  DEMO_PROCESSING_MS,
  demoProcessingOutcome,
  lifecycleIsLive,
  reindexDocument,
} from "./lifecycle-service";

/**
 * The lifecycle panel: where a document is in processing, why it failed, and
 * what to do about it.
 *
 * The four states the product cares about map onto the existing
 * DocumentStatus union rather than a parallel model:
 *
 *   uploading / processing  -> "processing"  — in flight, not citable
 *   indexed                 -> "ready" + indexed  — citable
 *   failed                  -> "failed"      — recoverable, with a reason
 *
 * A failure is never a dead end. The original file is already stored, so retry
 * re-runs the pipeline over it without asking a manager to find the document
 * again — and retry and re-index are the same call, so the recovery path is the
 * one that gets exercised.
 */
export function DocumentLifecycle({
  document,
  canManage,
}: {
  document: KnowledgeDocument;
  canManage: boolean;
}) {
  const { brand } = useSession();
  const { updateDocument } = useAppStore();
  const [busy, setBusy] = useState<"retry" | "reindex" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const live = lifecycleIsLive();
  const processing = document.status === "processing";
  const failed = document.status === "failed";

  const run = async (kind: "retry" | "reindex") => {
    setBusy(kind);
    setError(null);
    setDone(null);

    // Optimistic: the document stops being citable the moment reprocessing
    // starts, in both modes. Showing it as Ready while it is being rebuilt
    // would be the one lie this panel must not tell.
    updateDocument(document.id, {
      status: "processing",
      indexed: false,
      failureReason: undefined,
    });

    if (!live) {
      window.setTimeout(() => {
        const outcome = demoProcessingOutcome(document);
        updateDocument(document.id, { ...outcome, updatedAt: new Date().toISOString() });
        setBusy(null);
        setDone(
          outcome.status === "ready"
            ? "Re-indexed. Demo mode does not extract text — live mode runs the real pipeline."
            : null,
        );
        if (outcome.status === "failed") setError(outcome.failureReason ?? null);
      }, DEMO_PROCESSING_MS);
      return;
    }

    try {
      const result = await reindexDocument({
        documentId: document.id,
        scopeId: brand.knowledgeScopeId,
        force: kind === "reindex",
      });
      if (result.document) {
        updateDocument(document.id, result.document);
      }
      setDone(
        result.reusedExistingEmbeddings
          ? `Re-indexed. The content was unchanged, so the existing ${result.chunkCount ?? 0} chunks were kept and nothing was re-embedded.`
          : `Re-indexed into ${result.chunkCount ?? 0} chunks.`,
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The document could not be re-indexed.";
      setError(message);
      // The server already recorded the failure; mirror it so the badge and the
      // reason agree without waiting for a refetch.
      updateDocument(document.id, {
        status: "failed",
        indexed: false,
        failureReason: message,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="eyebrow mb-3">Processing</p>

      {processing ? (
        <Notice tone="primary" icon={<Loader2 className="animate-spin" />}>
          <span className="font-semibold">Processing</span>
          <p className="mt-0.5">
            The document is being read, split into retrieval chunks and indexed.
            Sunny will not cite it until every chunk is stored.
          </p>
        </Notice>
      ) : null}

      {failed ? (
        <Notice tone="attention" icon={<AlertTriangle />} title="Processing failed">
          <p>
            {document.failureReason ??
              "This document could not be processed. Retry, or upload it again."}
          </p>
          <p className="mt-1.5">
            The original file is still stored, so retrying re-runs processing
            over it — you do not need to find the document again.
          </p>
        </Notice>
      ) : null}

      {!processing && !failed && document.indexed ? (
        <Notice tone="accent" icon={<CheckCircle2 />}>
          <span className="font-semibold">Indexed and searchable</span>
          <p className="mt-0.5">
            Every chunk is stored, so Sunny can cite this document.
          </p>
        </Notice>
      ) : null}

      {!processing && !failed && !document.indexed ? (
        <Notice tone="neutral">
          Not indexed. This document is in the library but Sunny cannot cite it
          yet.
        </Notice>
      ) : null}

      {error && !failed ? (
        <Notice tone="attention" icon={<AlertTriangle />} className="mt-3">
          {error}
        </Notice>
      ) : null}

      {done ? (
        <Notice tone="accent" icon={<CheckCircle2 />} className="mt-3">
          {done}
        </Notice>
      ) : null}

      {canManage ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {failed ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void run("retry")}
            >
              {busy === "retry" ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {busy === "retry" ? "Retrying…" : "Retry processing"}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null || processing}
              onClick={() => void run("reindex")}
            >
              {busy === "reindex" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {busy === "reindex" ? "Re-indexing…" : "Re-index"}
            </Button>
          )}
        </div>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
        {live
          ? "Re-indexing reads the stored original again, re-splits it and re-embeds it. Retrying a failure reuses embeddings when the content has not changed."
          : "Demo mode does not extract text, so this simulates the states. Live mode runs the real pipeline over the stored file."}
      </p>
    </div>
  );
}
