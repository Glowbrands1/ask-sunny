import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  errorResponse,
} from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { VIDEO_BUCKET } from "@/lib/videos/policy";
import {
  getTrainingVideo,
  getTrainingVideoRow,
  markTrainingVideoFailed,
  markTrainingVideoReady,
} from "@/lib/videos/repository";

/**
 * POST /api/videos/:id/finalize — confirm the bytes actually arrived.
 *
 * ============================================================================
 * "UPLOAD SUCCEEDED" IS A CLAIM, NOT EVIDENCE
 * ============================================================================
 *
 * The browser uploads straight to Supabase Storage, so the server never sees
 * the transfer. Trusting the browser's report would mean a video could be
 * marked playable when the upload was cancelled, truncated, or never attempted
 * — and the failure would then surface as a broken player for whoever opened it
 * next, with nothing to say why.
 *
 * So this route LOOKS IN THE BUCKET. It lists the object at the path the server
 * derived, and only a real object with a non-zero size moves the row to `ready`.
 * The recorded size is the object's, taken from the listing, not a number the
 * client supplied.
 *
 * A MISSING OBJECT IS RECORDED AS A FAILURE rather than left pending. A row
 * stuck in `pending_upload` forever is indistinguishable from one still
 * uploading; `failed` is a state somebody can see and act on.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_videos");

    const { id } = await params;
    const row = await getTrainingVideoRow(id);
    if (!row) throw new AiError("bad_request", "That video does not exist.", 404);
    if (!row.storage_path) {
      throw new AiError("bad_request", "That video has no upload in progress.", 409);
    }

    /*
     * The path is split rather than searched for: `list` takes a prefix and a
     * name filter, and the object lives at `<id>/source.<ext>`. Both halves
     * come from the stored row, never from the request.
     */
    const slash = row.storage_path.lastIndexOf("/");
    const prefix = slash === -1 ? "" : row.storage_path.slice(0, slash);
    const fileName = row.storage_path.slice(slash + 1);

    const { data, error } = await getSupabaseAdmin()
      .storage.from(VIDEO_BUCKET)
      .list(prefix, { search: fileName, limit: 1 });

    if (error) {
      throw new AiError("bad_request", "The upload could not be verified.", 502);
    }

    const object = (data ?? []).find((entry) => entry.name === fileName);
    const sizeBytes = Number(
      (object?.metadata as { size?: unknown } | undefined)?.size ?? 0,
    );

    if (!object || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      await markTrainingVideoFailed(id);
      throw new AiError(
        "bad_request",
        "The video file did not arrive in storage, so it was not published. Try uploading it again.",
        409,
      );
    }

    await markTrainingVideoReady({ id, sizeBytes });
    return NextResponse.json({ video: await getTrainingVideo(id) });
  } catch (error) {
    return errorResponse(error, "POST /api/videos/[id]/finalize");
  }
}
