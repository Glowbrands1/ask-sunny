import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { LIMITS, parseJsonBody, requireString } from "@/lib/api/validation";
import { isVideoCategory, VIDEO_CATEGORY_IDS } from "@/lib/videos/categories";
import { authorizeRequest } from "@/lib/auth/server";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
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
  markTrainingVideoFailed,
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
 * A training video posted to a Next.js route would be buffered by the
 * serverless function before the handler saw a byte of it. Even at this
 * deployment's 50 MB ceiling that is a body most hosting platforms refuse, and
 * the argument only gets stronger if the project ever moves to a plan whose
 * limit is measured in hundreds of megabytes.
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

/**
 * ============================================================================
 * WHO RECEIVES WHICH ROWS — DECIDED ON THE SERVER
 * ============================================================================
 *
 * `videos` is READY ROWS ONLY, for everyone. A pending or failed upload is not
 * a video anybody can watch, and putting one in the ordinary library is what
 * made the detail screen describe a ten-second-old cloud row as a pre-cloud
 * browser-local file.
 *
 * `needsAttention` carries the pending and failed rows and is populated ONLY
 * for a caller holding `manage_videos`. The partition is at the database, not
 * in the browser: a viewer without that permission never receives those rows,
 * rather than receiving them and being trusted not to render them.
 *
 * The permission is read from the SERVER'S matrix against the identity
 * `authorizeRequest` returned — never from anything the request carried.
 */
export async function GET(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "view_videos");

    const canManage = hasPermission(
      DEFAULT_PERMISSION_MATRIX,
      context.identity.role,
      "manage_videos",
    );

    return NextResponse.json({
      videos: await listTrainingVideos(["ready"]),
      needsAttention: canManage
        ? await listTrainingVideos(["pending_upload", "failed"])
        : [],
    });
  } catch (error) {
    return errorResponse(error, "GET /api/videos");
  }
}

/**
 * A create failure, with the one fact the client cannot infer: whether a row
 * exists.
 *
 * THE CLIENT USED TO GUESS IT FROM THE HTTP STATUS — treating any 5xx as "the
 * row was created and the token failed". That is wrong for every 5xx raised
 * BEFORE the insert: an unreachable database, a failed insert, a configuration
 * fault. The server knows which side of the insert it failed on, so it says so
 * rather than leaving the browser to deduce it from a number that carries no
 * such meaning.
 */
function createFailure(input: {
  status: number;
  code: string;
  stage: "metadata" | "authorization";
  recordCreated: boolean;
  error: string;
}): NextResponse {
  return NextResponse.json(
    {
      error: input.error,
      code: input.code,
      stage: input.stage,
      recordCreated: input.recordCreated,
    },
    { status: input.status },
  );
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

    /*
     * THE CATEGORY IS CHECKED AGAINST A LIST, not merely for being a non-empty
     * string. It used to be the latter, which meant a crafted request could
     * persist a category no filter matches and no label exists for — the Select
     * control is a convenience for a person, never a constraint on a request.
     */
    if (!isVideoCategory(input.category)) {
      throw new AiError(
        "bad_request",
        `That is not a video category. Use one of: ${VIDEO_CATEGORY_IDS.join(", ")}.`,
        400,
      );
    }

    /*
     * EVERYTHING BEFORE THIS POINT FAILS WITH `recordCreated: false`, because
     * nothing exists yet. The insert is the line that changes the answer, so it
     * is the line the two branches are drawn around.
     */
    let id: string;
    try {
      ({ id } = await createPendingTrainingVideo({
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
      }));
    } catch {
      /*
       * The database was unreachable, or the insert was rejected. NO ROW
       * EXISTS, and the response says so — the client must not be left
       * inferring otherwise from a 5xx.
       *
       * The underlying error is not reflected: a Postgres message can name a
       * constraint and occasionally a value from the offending row.
       */
      return createFailure({
        status: 502,
        code: "video_record_failed",
        stage: "metadata",
        recordCreated: false,
        error: "The video record could not be created. Nothing was saved — try again.",
      });
    }

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
      /*
       * THE ROW ALREADY EXISTS BY THIS POINT, so "nothing was saved" — what
       * this used to say — was false, and it left an invisible `pending_upload`
       * row that nothing would ever move on. A row stuck pending forever is
       * indistinguishable from one still uploading.
       *
       * MARKED FAILED RATHER THAN DELETED, which is the convention this
       * codebase already follows for a Form instance that could not be
       * completed and for a video whose object never arrived: a failure that
       * can be seen and explained beats a record that silently vanishes. The
       * mark is best-effort — if it also fails, the original error is still
       * what the caller is told, because the upload is the thing they asked
       * for.
       */
      await markTrainingVideoFailed(id).catch(() => {});

      // The storage error itself is not reflected back: it can echo the
      // request and name internal paths.
      return createFailure({
        status: 502,
        code: "upload_authorization_failed",
        stage: "authorization",
        recordCreated: true,
        error:
          "The upload could not be authorized, so this video was recorded as failed. Try uploading it again.",
      });
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
