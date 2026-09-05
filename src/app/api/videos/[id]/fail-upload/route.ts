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
import { failPendingTrainingVideo, getTrainingVideoRow } from "@/lib/videos/repository";

/**
 * POST /api/videos/:id/fail-upload — close out an upload that never landed.
 *
 * ============================================================================
 * A PENDING ROW THAT NOBODY WILL EVER FINISH
 * ============================================================================
 *
 * The browser uploads straight to Supabase, so when that transfer fails the
 * server hears nothing at all. Before this route the sequence ended there: a
 * `pending_upload` row stayed pending forever, invisible to the ordinary
 * library and indistinguishable from an upload still in progress.
 *
 * THE CLIENT ASKS FOR THIS, IT DOES NOT ASSERT IT. The request carries an id
 * and nothing else — no status, no storage path, no claim about what happened.
 * The server reads its own row, and the transition is expressed as a WHERE
 * clause on `status = 'pending_upload'`, so this can never un-publish a ready
 * video however it is called.
 *
 * IT IS A CLEANUP, NOT THE ERROR. The browser calls it best-effort while
 * already holding a transfer failure to report; if this call fails too, the
 * transfer failure is still what the person is told. A cleanup that masked the
 * original error would be worse than no cleanup.
 *
 * THE PARTIAL OBJECT IS REMOVED WHERE ONE EXISTS. An interrupted upload can
 * leave bytes at the path, and leaving them would let a later retry's `upsert`
 * write over a half-file — harmless, but it also means the bucket accumulates
 * orphans nothing references. Best-effort, and never allowed to fail the
 * transition: the row's status is what decides whether the video is playable.
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

    /*
     * ALREADY SETTLED IS NOT AN ERROR. A retry of this cleanup, or a row a
     * finalize already closed, should answer calmly rather than 409 — the
     * caller's goal is "this upload is not pending any more", and it is not.
     */
    if (row.status !== "pending_upload") {
      return NextResponse.json({ status: row.status, changed: false });
    }

    const changed = await failPendingTrainingVideo(id);

    if (row.storage_path) {
      // Best-effort. A leftover object is untidy; a wrong status is a lie.
      await getSupabaseAdmin()
        .storage.from(VIDEO_BUCKET)
        .remove([row.storage_path])
        .catch(() => {});
    }

    return NextResponse.json({ status: "failed", changed });
  } catch (error) {
    return errorResponse(error, "POST /api/videos/[id]/fail-upload");
  }
}
