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
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  checkVideoFile,
  storagePathFor,
  VIDEO_BUCKET,
} from "@/lib/videos/policy";
import {
  createPendingTrainingVideo,
  getTrainingVideo,
  listTrainingVideos,
  setPendingStorageTarget,
} from "@/lib/videos/repository";
import type {
  CreateTrainingVideoRequest,
  CreateTrainingVideoResponse,
  TrainingVideo,
} from "@/lib/videos/types";

/**
 * GET  /api/videos — the library.        Requires `view_videos`.
 * POST /api/videos — begin an upload.    Requires `manage_videos`.
 *
 * ============================================================================
 * THE BYTES DO NOT COME THROUGH HERE
 * ============================================================================
 *
 * A 500 MB training video posted to a Next.js route would be buffered by the
 * serverless function before the handler saw a byte of it — which exceeds the
 * request-body and memory limits of every hosting platform this app runs on,
 * and would time out long before it exceeded them.
 *
 * So this route issues a CAPABILITY, not a destination for data. It creates the
 * metadata row, derives the object path from that row's id, mints a signed
 * upload token scoped to that one path, and returns it. The browser then
 * uploads straight to Supabase Storage, and `POST /api/videos/:id/finalize`
 * confirms the object exists before the video becomes playable.
 *
 * WHAT THE TOKEN CAN DO, and only this: write one object at one path in one
 * private bucket. It cannot list the bucket, cannot read anything, and cannot
 * name a different path — the path was derived server-side from a UUID this
 * route generated, never taken from the request. A leaked token overwrites that
 * video's own source file and nothing else.
 *
 * Guard order matches every other live route: mode, configuration,
 * authorization, rate limit, then validation — so an unauthorized caller cannot
 * spend an authorized colleague's budget, and no row is created before the
 * permission check clears.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TONES: TrainingVideo["thumbnailTone"][] = ["sage", "tan", "blush", "slate", "gold"];

export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    await authorizeRequest(request, "view_videos");

    return NextResponse.json({ videos: await listTrainingVideos() });
  } catch (error) {
    return errorResponse(error, "GET /api/videos");
  }
}

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    // MANAGE, not view. Uploading is not something a viewer may do, and hiding
    // the button is not what stops them.
    const context = await authorizeRequest(request, "manage_videos");
    assertWithinRateLimit(request, "upload");

    const body = await parseJsonBody<CreateTrainingVideoRequest>(request);
    const input = parseCreateRequest(body);

    /*
     * THE FILE IS CHECKED BEFORE ANYTHING IS CREATED. The browser checks too,
     * for a fast failure, but that check is a courtesy — this one decides, and
     * the bucket's own `allowed_mime_types` and `file_size_limit` decide again
     * after that.
     */
    const verdict = checkVideoFile({ mimeType: input.mimeType, sizeBytes: input.sizeBytes });
    if (!verdict.ok) {
      throw new AiError("bad_request", verdict.message, 400);
    }

    const { id } = await createPendingTrainingVideo({
      title: input.title,
      description: input.description,
      category: input.category,
      durationSeconds: input.durationSeconds,
      equipment: input.equipment,
      keywords: input.keywords,
      tags: input.tags,
      uploadedByUserId: context.identity.subject.startsWith("unauthenticated:")
        ? null
        : context.identity.subject,
      uploadedByName: context.identity.displayName || context.identity.email || "Unknown",
      thumbnailTone: TONES[Math.floor(Math.random() * TONES.length)],
    });

    // DERIVED FROM THE ID THIS ROUTE JUST GENERATED. Nothing in the request
    // contributes to it.
    const path = storagePathFor(id, verdict.mimeType);
    await setPendingStorageTarget({ id, storagePath: path, mimeType: verdict.mimeType });

    const { data, error } = await getSupabaseAdmin()
      .storage.from(VIDEO_BUCKET)
      /*
       * `upsert` so a retry for the same video row can overwrite its own
       * partial object rather than failing on a conflict. Safe because the path
       * belongs to exactly one row: there is no other object this token could
       * replace.
       *
       * No expiry argument — the installed SDK does not accept one, and the
       * Storage API fixes it. See the note in `policy.ts`.
       */
      .createSignedUploadUrl(path, { upsert: true });

    if (error || !data?.token) {
      // The storage error is not reflected back: it can echo the request and
      // name internal paths.
      throw new AiError(
        "bad_request",
        "The upload could not be authorized. Nothing was saved.",
        502,
      );
    }

    const video = await getTrainingVideo(id);
    if (!video) throw new AiError("bad_request", "The video record could not be read.", 500);

    const response: CreateTrainingVideoResponse = {
      video,
      upload: { bucket: VIDEO_BUCKET, path, token: data.token },
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST /api/videos");
  }
}

/** Bounds everything that arrived from the browser. */
function parseCreateRequest(body: Partial<CreateTrainingVideoRequest>) {
  const list = (value: unknown, limit: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0 && entry.length <= LIMITS.tag)
          .slice(0, limit)
      : [];

  const duration = Number(body.durationSeconds);

  return {
    title: requireString(body.title, "A title", LIMITS.title),
    description:
      typeof body.description === "string"
        ? body.description.trim().slice(0, LIMITS.description)
        : "",
    category: requireString(body.category, "A category", LIMITS.tag),
    durationSeconds:
      Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0,
    equipment: list(body.equipment, LIMITS.tagCount),
    keywords: list(body.keywords, LIMITS.tagCount).map((entry) => entry.toLowerCase()),
    tags: list(body.tags, LIMITS.tagCount).map((entry) => entry.toLowerCase()),
    mimeType: typeof body.mimeType === "string" ? body.mimeType : "",
    sizeBytes: Number(body.sizeBytes),
  };
}
