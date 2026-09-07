import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { LIMITS, parseJsonBody, requireString } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isVideoCategory, VIDEO_CATEGORY_IDS } from "@/lib/videos/categories";
import { VIDEO_BUCKET } from "@/lib/videos/policy";
import {
  deleteTrainingVideoRow,
  getTrainingVideo,
  getTrainingVideoRow,
  updateTrainingVideoMetadata,
} from "@/lib/videos/repository";
import type { UpdateTrainingVideoRequest } from "@/lib/videos/types";

/**
 * GET    /api/videos/:id — one video.        Requires `view_videos`, and
 *                                            `manage_videos` for a row that is
 *                                            not `ready`.
 * PATCH  /api/videos/:id — edit metadata.    Requires `manage_videos`.
 * DELETE /api/videos/:id — remove it.        Requires `manage_videos`.
 *
 * ============================================================================
 * WHAT AN EDIT MAY TOUCH, AND WHY THE LIST IS SHORT
 * ============================================================================
 *
 * Six fields: title, description, category, equipment, keywords, tags. Those
 * are things a person knows about a video. Everything else on the row is
 * something the SERVER established and a browser has no standing to revise —
 * `storage_path` (derived from the id), `status` (set only after the object was
 * seen in the bucket), `size_bytes` and `mime_type` (read from storage),
 * `uploaded_by_user_id`, `view_count`, and every transcript column.
 *
 * The protection is structural rather than a deny-list. `parseUpdate` below
 * builds a fresh object from six named fields, and
 * `updateTrainingVideoMetadata` writes six named columns — so a request
 * carrying `status: "ready"` or `storage_path: "../elsewhere"` is not stripped,
 * it is simply never read. There is no spread and no `Partial<>` on the path
 * from request to SQL, which is the shape that would let a seventh column
 * through by accident.
 *
 * A CATEGORY IS CHECKED AGAINST THE CANONICAL LIST, not merely for being a
 * non-empty string: `@/lib/videos/categories` is the one runtime vocabulary the
 * upload route, this route and the UI all read.
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
    const context = await authorizeRequest(request, "view_videos");

    const { id } = await params;
    const video = await getTrainingVideo(id);

    /*
     * ==========================================================================
     * THE SAME STATUS BOUNDARY THE LIST ENDPOINT ENFORCES
     * ==========================================================================
     *
     * `GET /api/videos` returns ready rows to everybody and the pending and
     * failed ones only to a caller holding `manage_videos`. Reading ONE row by
     * id skipped that check entirely, so a viewer who knew a UUID could ask for
     * exactly the row the list had deliberately withheld. The partition
     * belonged to the resource, not to one handler.
     *
     * ONE ANSWER FOR "no such video" AND "not yours to see", word for word:
     * same status, same code, same message. A distinct 403 would confirm that
     * the id names a real row — which is the fact being withheld — and turn the
     * endpoint into an oracle for guessing them. The playback route collapses
     * its two cases the same way, for the same reason.
     *
     * THE PERMISSION IS READ FROM THE SERVER'S MATRIX against the identity
     * `authorizeRequest` returned, never from anything the request carried.
     */
    const canManage = hasPermission(
      DEFAULT_PERMISSION_MATRIX,
      context.identity.role,
      "manage_videos",
    );
    if (!video || (video.status !== "ready" && !canManage)) {
      throw new AiError("bad_request", "That video does not exist.", 404);
    }

    return NextResponse.json({ video });
  } catch (error) {
    return errorResponse(error, "GET /api/videos/[id]");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    // MANAGE, not view. Editing the library is not something a viewer may do.
    await authorizeRequest(request, "manage_videos");
    assertWithinRateLimit(request, "mutate");

    const { id } = await params;
    const body = await parseJsonBody<UpdateTrainingVideoRequest>(request);
    const update = parseUpdate(body);

    const video = await updateTrainingVideoMetadata({ id, ...update });
    if (!video) throw new AiError("bad_request", "That video does not exist.", 404);

    return NextResponse.json({ video });
  } catch (error) {
    return errorResponse(error, "PATCH /api/videos/[id]");
  }
}

/**
 * ============================================================================
 * DELETE: THE ROW FIRST, THEN THE OBJECT
 * ============================================================================
 *
 * THE ORDERING IS A DELIBERATE CHOICE BETWEEN TWO IMPERFECT FAILURES.
 *
 * Delete the object first and the row second, and a failure between them leaves
 * a `ready` row whose media is gone: the video is still in the library, still
 * looks playable, and every attempt to watch it fails with nothing to explain
 * why. That is a broken product.
 *
 * Delete the row first and the object second, and the same failure leaves an
 * orphaned object in a PRIVATE bucket that nothing references and no signed URL
 * can be minted for. That is untidy — it consumes storage until somebody sweeps
 * it — and it is invisible to every user.
 *
 * A private orphan beats a visible corpse, so the row goes first.
 *
 * THE PATH IS READ FROM THE ROW, NEVER FROM THE REQUEST. The caller supplies an
 * id; the server decides which object that id means. A path from a request
 * would let a crafted call delete an object belonging to another video — or in
 * another bucket entirely.
 *
 * AND STORAGE CLEANUP CANNOT UN-DELETE. Once the row is gone the video is gone
 * from the product, so a failed `remove` is reported as a bounded warning
 * rather than turned into a failure that implies the video survived. The
 * warning never names the path.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "manage_videos");
    assertWithinRateLimit(request, "mutate");

    const { id } = await params;

    /*
     * READ BEFORE DELETE, so the object path is known while the row still
     * exists. Reading it afterwards is not possible, which is why this is not
     * merely tidier — it is the only order that works.
     *
     * Every status is handled: a `pending_upload` or `failed` row may have a
     * path recorded with no object behind it, and `remove` on a missing object
     * is not an error worth surfacing.
     */
    const row = await getTrainingVideoRow(id);
    if (!row) throw new AiError("bad_request", "That video does not exist.", 404);

    const deleted = await deleteTrainingVideoRow(id);
    if (!deleted) {
      // The row vanished between the read and the delete — a concurrent
      // delete. Reported as not-found rather than as a success.
      throw new AiError("bad_request", "That video does not exist.", 404);
    }

    let storageCleaned = true;
    if (row.storage_path) {
      const { error } = await getSupabaseAdmin()
        .storage.from(VIDEO_BUCKET)
        .remove([row.storage_path]);
      // The storage error's text is not surfaced: it names internal paths.
      storageCleaned = !error;
    }

    return NextResponse.json({
      deleted: true,
      /*
       * Reported so an administrator can see that a sweep is owed, and phrased
       * without the path. `deleted: true` stays true either way — the video IS
       * gone from the library.
       */
      storageCleaned,
      ...(storageCleaned
        ? {}
        : {
            warning:
              "The video was removed from the library, but its stored file could not be deleted. It is in a private bucket and unreachable; an administrator can clear it later.",
          }),
    });
  } catch (error) {
    return errorResponse(error, "DELETE /api/videos/[id]");
  }
}

/**
 * The six editable fields, rebuilt from scratch.
 *
 * NOT a filtered copy of the request. Every value is read by name and written
 * into a fresh object, so nothing the caller sent can ride along — including
 * fields nobody has thought of yet.
 */
function parseUpdate(body: Partial<UpdateTrainingVideoRequest>) {
  const list = (value: unknown, limit: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0 && entry.length <= LIMITS.tag)
          .slice(0, limit)
      : [];

  const category = typeof body.category === "string" ? body.category.trim() : "";
  if (!isVideoCategory(category)) {
    throw new AiError(
      "bad_request",
      `That is not a video category. Use one of: ${VIDEO_CATEGORY_IDS.join(", ")}.`,
      400,
    );
  }

  return {
    title: requireString(body.title, "A title", LIMITS.title),
    description:
      typeof body.description === "string"
        ? body.description.trim().slice(0, LIMITS.description)
        : "",
    category,
    equipment: list(body.equipment, LIMITS.tagCount),
    // Lower-cased exactly as the upload route does, so an edited video matches
    // chat recommendations the same way an uploaded one does.
    keywords: list(body.keywords, LIMITS.tagCount).map((entry) => entry.toLowerCase()),
    tags: list(body.tags, LIMITS.tagCount).map((entry) => entry.toLowerCase()),
  };
}
