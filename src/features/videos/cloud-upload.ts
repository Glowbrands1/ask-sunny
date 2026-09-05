"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { checkVideoFile } from "@/lib/videos/policy";
import type {
  CreateTrainingVideoRequest,
  CreateTrainingVideoResponse,
  TrainingVideo,
} from "@/lib/videos/types";

/**
 * ============================================================================
 * THE LIVE UPLOAD, THREE CALLS AND ONE OF THEM IS NOT TO THIS APP
 * ============================================================================
 *
 *   1. POST /api/videos            metadata in, a capability out
 *   2. upload direct to Supabase   the bytes, which never touch Vercel
 *   3. POST /api/videos/:id/finalize   the server looks in the bucket
 *
 * WHAT THIS REPLACES. The dialog called `getStorageProvider().putBlob(...)`,
 * which is the IndexedDB provider in live mode as well as demo — so an uploaded
 * training video's bytes went into the uploader's own browser and no colleague
 * could ever play it. The backend to do this properly was built last milestone
 * and the dialog was never pointed at it, which is the whole of this
 * remediation.
 *
 * THE BROWSER HOLDS NO CREDENTIAL BEYOND THE ONE IT WAS JUST GIVEN. The signed
 * upload token authorises writing ONE object at ONE server-derived path. The
 * publishable key that reaches Supabase alongside it is the same one already
 * compiled into the bundle for sign-in, and it grants nothing against a private
 * bucket on its own — `storage.objects` has no policy for these roles.
 *
 * EVERY STAGE FAILS DIFFERENTLY, and the caller is told which. "Something went
 * wrong" after a five-minute upload is not a message somebody can act on, and
 * the four stages need four different actions: fix the metadata, retry, retry
 * the transfer, or retry the finalize.
 */

/** Which step failed. Each needs a different sentence and a different action. */
export type UploadStage =
  /** The file was refused before anything was created. */
  | "validation"
  /** POST /api/videos did not create the record. */
  | "metadata"
  /** The record exists; no upload capability could be minted for it. */
  | "authorization"
  /** The capability existed; the transfer to Supabase failed. */
  | "transfer"
  /** The bytes may have landed; the server could not confirm them. */
  | "finalize";

export class VideoUploadError extends Error {
  constructor(
    readonly stage: UploadStage,
    message: string,
    /** True when a `pending_upload` or `failed` row was left behind. */
    readonly recordCreated: boolean,
  ) {
    super(message);
    this.name = "VideoUploadError";
  }
}

export interface CloudUploadInput {
  file: File;
  metadata: Omit<CreateTrainingVideoRequest, "mimeType" | "sizeBytes">;
}

/** Reads an error message from a response without trusting its shape. */
async function messageFrom(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

/**
 * Closes out a pending row after a transfer that never landed.
 *
 * BEST-EFFORT, AND DELIBERATELY SILENT. It is called while a transfer failure
 * is already in hand, so a failure here must not replace it — the person needs
 * to know their upload did not work, not that a cleanup call also did not. The
 * row simply stays pending, visible to an administrator in the
 * uploads-needing-attention list.
 */
async function closePendingUpload(videoId: string): Promise<void> {
  try {
    await fetch(`/api/videos/${encodeURIComponent(videoId)}/fail-upload`, {
      method: "POST",
    });
  } catch {
    // Intentionally swallowed. See above.
  }
}

export async function uploadTrainingVideo(
  input: CloudUploadInput,
): Promise<TrainingVideo> {
  /*
   * A COURTESY CHECK, NOT THE GATE. It saves somebody starting a 300 MB
   * transfer that the server would refuse — the server checks again, and the
   * bucket's own `allowed_mime_types` and `file_size_limit` check after that.
   */
  const verdict = checkVideoFile({
    mimeType: input.file.type,
    sizeBytes: input.file.size,
  });
  if (!verdict.ok) {
    throw new VideoUploadError("validation", verdict.message, false);
  }

  /* ---------------------------------------------------------- 1. metadata -- */
  let created: CreateTrainingVideoResponse;
  try {
    const response = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input.metadata,
        mimeType: verdict.mimeType,
        sizeBytes: input.file.size,
      } satisfies CreateTrainingVideoRequest),
    });

    if (!response.ok) {
      /*
       * THE SERVER SAYS WHETHER A ROW EXISTS. This used to be inferred from the
       * status code — any 5xx was treated as "the row was created and the token
       * failed" — which is wrong for every 5xx raised BEFORE the insert: an
       * unreachable database, a rejected insert, a configuration fault. Only
       * the server knows which side of the insert it failed on, so only the
       * server may answer.
       *
       * The fallbacks are the conservative reading: an unrecognised failure is
       * reported as `metadata` with no row claimed, because claiming a row that
       * does not exist sends somebody looking for it.
       */
      const payload = (await response.json().catch(() => null)) as {
        error?: unknown;
        stage?: unknown;
        recordCreated?: unknown;
      } | null;

      const stage: UploadStage =
        payload?.stage === "authorization" ? "authorization" : "metadata";

      throw new VideoUploadError(
        stage,
        typeof payload?.error === "string"
          ? payload.error
          : "The video record could not be created.",
        payload?.recordCreated === true,
      );
    }

    created = (await response.json()) as CreateTrainingVideoResponse;
  } catch (error) {
    if (error instanceof VideoUploadError) throw error;
    throw new VideoUploadError(
      "metadata",
      "The video record could not be created. Check your connection and try again.",
      false,
    );
  }

  /* ------------------------------------------------------------ 2. bytes -- */
  try {
    const { error } = await getSupabaseBrowserClient()
      .storage.from(created.upload.bucket)
      // The path and token are the SERVER'S, passed straight back. Nothing here
      // constructs or edits a storage path.
      .uploadToSignedUrl(created.upload.path, created.upload.token, input.file, {
        contentType: verdict.mimeType,
      });

    if (error) {
      // The storage error can name internal paths and echo the request, so its
      // text is not surfaced — only the fact that the transfer failed.
      throw new VideoUploadError(
        "transfer",
        "The video file could not be uploaded. It was not published — try again.",
        true,
      );
    }
  } catch (error) {
    /*
     * THE ROW IS CLOSED OUT BEFORE THE ERROR IS RAISED. Without this the
     * sequence ended with a `pending_upload` row nobody would ever finish —
     * the server never sees the transfer, so it cannot know on its own.
     * Awaited so the cleanup is in flight before the dialog reports failure,
     * and swallowing its own errors so it cannot replace this one.
     */
    await closePendingUpload(created.video.id);

    if (error instanceof VideoUploadError) throw error;
    throw new VideoUploadError(
      "transfer",
      "The upload was interrupted. The video was not published — try again.",
      true,
    );
  }

  /* --------------------------------------------------------- 3. finalize -- */
  /*
   * ONLY REACHED IF THE TRANSFER REPORTED SUCCESS, and even then the server
   * verifies independently by listing the object. The browser's word is not
   * what makes a video playable.
   */
  try {
    const response = await fetch(
      `/api/videos/${encodeURIComponent(created.video.id)}/finalize`,
      { method: "POST" },
    );

    if (!response.ok) {
      throw new VideoUploadError(
        "finalize",
        await messageFrom(
          response,
          "The upload could not be confirmed, so the video was not published.",
        ),
        true,
      );
    }

    const payload = (await response.json()) as { video: TrainingVideo };
    return payload.video;
  } catch (error) {
    if (error instanceof VideoUploadError) throw error;
    throw new VideoUploadError(
      "finalize",
      "The upload could not be confirmed. Check the library before uploading again.",
      true,
    );
  }
}
