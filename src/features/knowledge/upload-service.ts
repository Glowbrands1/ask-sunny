import { isDemoMode } from "@/lib/config/runtime";
import { SUPPORTED_LABEL, validateUpload } from "@/lib/ingestion/validation";
import type { KnowledgeCategory, KnowledgeDocument } from "@/types";

/**
 * The upload dialog's one route to the outside world.
 *
 * demo -> nothing is sent anywhere. The caller stores the file in IndexedDB
 *         through the StorageProvider, exactly as the prototype always has.
 *
 * live -> the file is POSTed to /api/knowledge/upload, which validates it
 *         again, stores the original in the private bucket, extracts, chunks,
 *         embeds and indexes it, then returns the persisted document.
 *
 * The component itself imports no Supabase client and no key — it calls this.
 */

export { SUPPORTED_LABEL };

/** Client-side pre-check, for a fast message. The server re-checks everything. */
export function precheckFile(file: File): string | null {
  try {
    validateUpload({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "This file cannot be uploaded.";
  }
}

export interface UploadRequest {
  file: File;
  title: string;
  description: string;
  category: KnowledgeCategory;
  tags: string[];
  uploadedBy: string;
}

export interface UploadOutcome {
  document: KnowledgeDocument;
  chunkCount: number;
}

export function uploadsAreLive(): boolean {
  return !isDemoMode();
}

export async function uploadToKnowledgeBase(
  request: UploadRequest,
): Promise<UploadOutcome> {
  const form = new FormData();
  form.set("file", request.file);
  form.set("title", request.title);
  form.set("description", request.description);
  form.set("category", request.category);
  form.set("tags", request.tags.join(","));
  // The corpus is not sent: the server derives it from the active brand.
  form.set("uploadedBy", request.uploadedBy);

  const response = await fetch("/api/knowledge/upload", {
    method: "POST",
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as {
    document?: KnowledgeDocument;
    chunkCount?: number;
    error?: string;
    retryAfterSeconds?: number;
  };

  if (!response.ok || !payload.document) {
    /*
     * A 429 IS A WAIT, NOT A FAILURE, and it is thrown as its own type so the
     * bulk runner can tell the difference. The upload budget is ten a minute
     * and a policy folder will reach it; abandoning the rest of the batch there
     * would be the wrong answer, and so would raising the cap — it bounds real
     * spend at the embeddings vendor.
     */
    if (response.status === 429) {
      throw new UploadRateLimited(
        payload.error ?? "Too many uploads for now.",
        retryAfterSecondsFrom(response, payload.retryAfterSeconds),
      );
    }
    throw new Error(payload.error ?? "The document could not be indexed.");
  }

  return { document: payload.document, chunkCount: payload.chunkCount ?? 0 };
}

/** Thrown when the route asks the caller to wait rather than refusing outright. */
export class UploadRateLimited extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "UploadRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * How long to wait, from the header first and the body second.
 *
 * CLAMPED, because this value decides how long the UI sits still. A header a
 * proxy rewrote to something absurd would otherwise strand the batch, and a
 * zero would spin. The window is sixty seconds, so a minute and a half is
 * generous headroom and anything past it is not a number worth trusting.
 */
function retryAfterSecondsFrom(response: Response, fromBody?: number): number {
  const header = Number(response.headers.get("Retry-After"));
  const raw = Number.isFinite(header) && header > 0 ? header : fromBody;
  if (!Number.isFinite(raw) || raw === undefined || raw <= 0) return 5;
  return Math.min(90, Math.ceil(raw));
}

/* ========================================================================== */
/*                              BULK UPLOAD                                   */
/* ========================================================================== */

/**
 * One file in a batch, with the title it will be filed under.
 *
 * THE TITLE IS PER FILE AND IT MATTERS MORE THAN IT LOOKS. Uploading a document
 * whose title already exists creates a NEW VERSION and supersedes the old one —
 * so a batch that derived one title for every file, or reused the batch's name,
 * would silently overwrite documents. Each file carries its own.
 */
export interface BulkUploadFile {
  /** Stable key for the queue UI. Never sent. */
  readonly key: string;
  readonly file: File;
  readonly title: string;
}

/** What the batch shares: everything except the file and its title. */
export interface BulkUploadShared {
  readonly description: string;
  readonly category: KnowledgeCategory;
  readonly tags: string[];
  readonly uploadedBy: string;
}

export type BulkUploadEvent =
  | { readonly kind: "started"; readonly key: string }
  /** Waiting out the route's rate limit before retrying the SAME file. */
  | { readonly kind: "waiting"; readonly key: string; readonly seconds: number }
  | { readonly kind: "done"; readonly key: string; readonly outcome: UploadOutcome }
  | { readonly kind: "failed"; readonly key: string; readonly message: string };

/**
 * =============================================================================
 * UPLOADING A BATCH
 * =============================================================================
 *
 * ONE FILE PER REQUEST, IN SEQUENCE. Never parallel, and that is a cost and
 * reliability decision rather than a simplification: each file runs
 * extract -> chunk -> embed -> index, so ten at once is ten concurrent
 * embedding jobs against a budget of ten a minute. Sequential keeps the server
 * route untouched, keeps every existing validation and permission check exactly
 * where it was, and means a batch degrades into a queue instead of a pile-up.
 *
 * ONE FAILURE DOES NOT ABORT THE BATCH. A corrupt PDF in position three must not
 * cost the reader files four through twenty. Each file reports its own outcome
 * and the runner carries on — which is also why this returns nothing and
 * reports through `onEvent`: a caller that only learned the result at the end
 * could not show progress, and a batch of twenty is a minute of silence.
 *
 * A RATE LIMIT IS WAITED OUT, NOT SWALLOWED. The same file is retried once the
 * window has passed, so a legitimate large batch finishes slowly rather than
 * half-finishing. It is retried ONCE per limit: if the second attempt is also
 * limited, something other than this batch is consuming the budget and looping
 * would just hold the UI open.
 */
export async function uploadManyToKnowledgeBase(
  files: readonly BulkUploadFile[],
  shared: BulkUploadShared,
  onEvent: (event: BulkUploadEvent) => void,
  /** Injected in tests so a 60-second window does not become a 60-second test. */
  wait: (seconds: number) => Promise<void> = defaultWait,
): Promise<void> {
  for (const entry of files) {
    onEvent({ kind: "started", key: entry.key });

    const attempt = () =>
      uploadToKnowledgeBase({
        file: entry.file,
        title: entry.title,
        description: shared.description,
        category: shared.category,
        tags: shared.tags,
        uploadedBy: shared.uploadedBy,
      });

    try {
      let outcome: UploadOutcome;
      try {
        outcome = await attempt();
      } catch (error) {
        if (!(error instanceof UploadRateLimited)) throw error;
        onEvent({
          kind: "waiting",
          key: entry.key,
          seconds: error.retryAfterSeconds,
        });
        await wait(error.retryAfterSeconds);
        outcome = await attempt();
      }
      onEvent({ kind: "done", key: entry.key, outcome });
    } catch (error) {
      onEvent({
        kind: "failed",
        key: entry.key,
        message:
          error instanceof Error
            ? error.message
            : "The document could not be indexed.",
      });
    }
  }
}

function defaultWait(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}
