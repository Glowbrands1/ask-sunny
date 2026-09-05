/**
 * ============================================================================
 * WHAT COUNTS AS A TRAINING VIDEO, AND WHERE ITS BYTES GO
 * ============================================================================
 *
 * Pure and dependency-free, so both the server routes and the upload dialog can
 * use the same rules and a test can prove them without a database. No
 * `server-only`: nothing here is a credential, and a browser that checks the
 * size before starting a 300 MB upload saves everybody a wasted five minutes.
 *
 * THE BROWSER'S COPY IS A COURTESY, NOT THE GATE. Every rule below is
 * re-checked server-side before a signed upload token is issued, and again by
 * the bucket itself — Supabase enforces `allowed_mime_types` and
 * `file_size_limit` whatever the application believes. Three layers, and only
 * the outer two are trustworthy.
 */

export const VIDEO_BUCKET = "training-videos";

/**
 * The MIME types a training video may be.
 *
 * ENUMERATED, NOT `video/*`. The file input's `accept="video/*"` is a hint to
 * the file picker and nothing more — it does not constrain what a request can
 * send, and it would admit `video/x-msvideo`, `video/mpeg` and a dozen formats
 * no browser can play natively. These three cover what the platform's `<video>`
 * element actually plays:
 *
 *   video/mp4        — H.264/AAC. Plays everywhere.
 *   video/webm       — VP8/VP9. Plays everywhere except older Safari.
 *   video/quicktime  — .mov, which is what an iPhone records. Accepted because
 *                      that is where a salon's phone footage comes from, and
 *                      most .mov files are H.264 in a QuickTime container that
 *                      Safari and Chrome play. FIREFOX GENERALLY DOES NOT, so a
 *                      .mov is stored honestly and may still not play for every
 *                      viewer — a transcoding step would be the fix, and that
 *                      is not this milestone.
 */
export const ALLOWED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export type AllowedVideoMimeType = (typeof ALLOWED_VIDEO_MIME_TYPES)[number];

/** The extension each accepted type is stored under. */
const EXTENSION_FOR: Record<AllowedVideoMimeType, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const VIDEO_LIMITS = {
  /**
   * 500 MB.
   *
   * THE SAME NUMBER AS THE BUCKET'S `file_size_limit` in
   * `20260906001000_training_videos.sql`, and it must stay that way: if this is
   * the larger of the two, the application accepts a file the storage API then
   * rejects, and the failure surfaces halfway through a long upload.
   *
   * A Supabase PROJECT also carries a global upload ceiling, set in the
   * dashboard rather than in SQL, which overrides a bucket's when it is lower.
   * That one cannot be asserted from here — it is named in the return report as
   * something to verify rather than assumed.
   */
  maxBytes: 500 * 1024 * 1024,
  minBytes: 1,
} as const;

/** Why a file was refused. Each needs different wording for the uploader. */
export type VideoRejection =
  | "empty"
  | "too_large"
  | "unsupported_type";

export type VideoFileVerdict =
  | { ok: true; mimeType: AllowedVideoMimeType }
  | { ok: false; reason: VideoRejection; message: string };

export function isAllowedVideoMimeType(value: string): value is AllowedVideoMimeType {
  return (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(value);
}

/** Human-readable size, for a message somebody has to act on. */
function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Whether these file properties may become a training video.
 *
 * THE MIME TYPE IS TAKEN AT FACE VALUE HERE, and that is a deliberate limit
 * rather than an oversight: a browser reports it from the file extension, so it
 * is a claim, not a measurement. What makes the claim safe to act on is that
 * the bucket enforces `allowed_mime_types` independently — a file that lies its
 * way past this check is refused by Supabase at upload time, and a file that
 * lies its way into the bucket is served back with the type the bucket
 * recorded, not one the browser chose.
 */
export function checkVideoFile(input: {
  mimeType: string;
  sizeBytes: number;
}): VideoFileVerdict {
  const mimeType = input.mimeType.trim().toLowerCase();

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < VIDEO_LIMITS.minBytes) {
    return { ok: false, reason: "empty", message: "That file is empty." };
  }

  if (input.sizeBytes > VIDEO_LIMITS.maxBytes) {
    return {
      ok: false,
      reason: "too_large",
      message: `That video is ${megabytes(input.sizeBytes)}. The limit is ${megabytes(
        VIDEO_LIMITS.maxBytes,
      )}.`,
    };
  }

  if (!isAllowedVideoMimeType(mimeType)) {
    return {
      ok: false,
      reason: "unsupported_type",
      message:
        "That file type cannot be used as a training video. Upload an MP4, a WebM, or a QuickTime .mov.",
    };
  }

  return { ok: true, mimeType };
}

/**
 * ============================================================================
 * THE OBJECT PATH IS DERIVED, NEVER SUPPLIED
 * ============================================================================
 *
 * A path that arrived in a request is an overwrite primitive and a traversal
 * hazard: `../knowledge-documents/policy.pdf` and `<another video's id>/source`
 * are both things a caller would otherwise be able to name. So the path is a
 * pure function of the row's id, which the server generated, and the id is
 * validated as a UUID first — anything else throws rather than being escaped
 * and hoped about.
 *
 * The database backs this up with `storage_path unique`, so even a careless
 * future change here cannot let two rows point at one object.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function storagePathFor(videoId: string, mimeType: AllowedVideoMimeType): string {
  if (!UUID.test(videoId)) {
    throw new Error("A training video id must be a UUID.");
  }
  return `${videoId}/source.${EXTENSION_FOR[mimeType]}`;
}

/**
 * How long a playback link lives.
 *
 * Long enough that an ordinary training video does not expire mid-watch — the
 * library's longest clips run about twenty minutes, and a viewer may pause. Two
 * hours covers that with room to spare while still being far short of "may as
 * well be public".
 *
 * The URL is minted per request, so a viewer who leaves a tab open overnight
 * reloads the page and gets a fresh one rather than a silent failure.
 */
export const PLAYBACK_URL_TTL_SECONDS = 2 * 60 * 60;

/**
 * ============================================================================
 * THE UPLOAD TOKEN'S LIFETIME IS NOT OURS TO SET
 * ============================================================================
 *
 * There is deliberately no constant here, and the absence is the finding.
 *
 * `createSignedUploadUrl(path, options?: { upsert })` in the installed
 * `@supabase/storage-js` takes NO expiry argument — checked in its source, not
 * assumed. The token's lifetime is fixed by the Storage API (two hours at the
 * time of writing) and cannot be shortened or extended from the application. An
 * exported `UPLOAD_TOKEN_TTL_SECONDS` would have looked like a setting that
 * controlled something, and nothing would have read it.
 *
 * What the application DOES control is the other, more important dimension of
 * the token's scope: it authorises writing ONE object at ONE path, derived
 * above from a row id the server generated. A leaked token can overwrite that
 * video's own source file and nothing else — it cannot list the bucket, read an
 * object, or name a different path.
 */
export const UPLOAD_TOKEN_EXPIRY_IS_FIXED_BY_SUPABASE = true;
