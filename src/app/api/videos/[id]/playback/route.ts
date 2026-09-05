import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  errorResponse,
} from "@/lib/api/respond";
import { authorizeRequest } from "@/lib/auth/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PLAYBACK_URL_TTL_SECONDS, VIDEO_BUCKET } from "@/lib/videos/policy";
import { getTrainingVideoRow } from "@/lib/videos/repository";
import type { TrainingVideoPlaybackResponse } from "@/lib/videos/types";

/**
 * GET /api/videos/:id/playback — a short-lived link to the media.
 *
 * ============================================================================
 * SUPABASE SERVES THE BYTES, NOT VERCEL
 * ============================================================================
 *
 * This route returns a URL and never a video. Proxying the media through a
 * serverless function would put a 300 MB stream through a platform sized for
 * JSON, break HTTP range requests — so seeking would stop working — and cost a
 * function invocation for every scrub of the timeline.
 *
 * Supabase's signed object URLs are served by its storage layer, which supports
 * range requests, so `<video controls>` can seek normally and the browser
 * fetches only the part it needs. THIS IS ASSERTED FROM THE STORAGE API'S
 * DOCUMENTED BEHAVIOUR AND HAS NOT BEEN EXERCISED AGAINST A REAL OBJECT IN THIS
 * DEPLOYMENT — the bucket does not exist until the migration is applied. It is
 * the first thing to confirm in QA.
 *
 * THE BUCKET STAYS PRIVATE. Making it public would make playback trivially easy
 * and put every training video behind a guessable, permanent URL. A signed URL
 * is time-limited, minted per request, and only after `view_videos` has been
 * checked — so revoking someone's access revokes their next view rather than
 * nothing.
 *
 * THE PATH IS READ FROM THE ROW, never from the request. A caller supplies an
 * id; the server decides what object that id means.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    // VIEW, not manage. Playing a video is what the frontline role is here for.
    await authorizeRequest(request, "view_videos");

    const { id } = await params;
    const row = await getTrainingVideoRow(id);

    /*
     * ONE MESSAGE FOR "no such video" AND "not playable". A caller who may view
     * videos learns that this one cannot be played, not whether a row with that
     * id exists — and a row that is `pending_upload` or `failed` has no object
     * to sign, so signing one would produce a URL that 404s at the CDN.
     */
    if (!row || row.status !== "ready" || !row.storage_path) {
      throw new AiError(
        "bad_request",
        "That video does not have a playable file.",
        404,
      );
    }

    const { data, error } = await getSupabaseAdmin()
      .storage.from(VIDEO_BUCKET)
      .createSignedUrl(row.storage_path, PLAYBACK_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      // The storage error is not reflected: it names internal object paths.
      throw new AiError("bad_request", "A playback link could not be created.", 502);
    }

    const response: TrainingVideoPlaybackResponse = {
      url: data.signedUrl,
      expiresInSeconds: PLAYBACK_URL_TTL_SECONDS,
      mimeType: row.mime_type ?? "video/mp4",
    };
    return NextResponse.json(response, {
      // A signed URL is a credential with a clock on it. Never cached by a
      // shared cache, and never reused after the tab is closed.
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "GET /api/videos/[id]/playback");
  }
}
