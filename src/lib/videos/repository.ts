import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { VIDEO_BUCKET, type AllowedVideoMimeType } from "./policy";
import type {
  TrainingVideo,
  TrainingVideoStatus,
  TrainingVideoTranscriptStatus,
} from "./types";
import { getTranscriptionProvider } from "./transcription";

/**
 * ============================================================================
 * THE TRAINING VIDEO LIBRARY, SERVER-SIDE
 * ============================================================================
 *
 * Same posture as the reporting read layer, for the same reason:
 * `training_videos` has RLS enabled and forced with NO policies, so a browser
 * client reads zero rows through PostgREST however it signed in. Reads run
 * here, under the secret key, behind `authorizeRequest`. `import "server-only"`
 * makes a client component importing this file a BUILD failure rather than a
 * review comment.
 *
 * THE ROW IS CREATED BEFORE THE BYTES EXIST, and that ordering is the design.
 * The id has to exist for the storage path to be derived from it, and the path
 * has to exist for an upload token to be scoped to it. So a video is born
 * `pending_upload` and only the server, having LOOKED IN THE BUCKET, moves it
 * to `ready` — the browser saying "uploaded" is a claim, not evidence.
 */

/** Columns selected everywhere, so one place decides what a video row is. */
const COLUMNS =
  "id, title, description, category, duration_seconds, uploaded_by_name, uploaded_at, " +
  "equipment, keywords, tags, storage_bucket, storage_path, mime_type, size_bytes, status, " +
  "transcript_status, transcript_text, transcript_error_safe, transcript_provider, " +
  "view_count, thumbnail_tone";

interface VideoRow {
  id: string;
  title: string;
  description: string;
  category: string;
  duration_seconds: number;
  uploaded_by_name: string;
  uploaded_at: string;
  equipment: string[] | null;
  keywords: string[] | null;
  tags: string[] | null;
  storage_bucket: string;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: TrainingVideoStatus;
  transcript_status: TrainingVideoTranscriptStatus;
  transcript_text: string | null;
  transcript_error_safe: string | null;
  transcript_provider: string | null;
  view_count: number;
  thumbnail_tone: TrainingVideo["thumbnailTone"];
}

/**
 * A row as the browser may see it.
 *
 * THE STORAGE PATH DOES NOT CROSS THIS BOUNDARY. It becomes a boolean. The
 * browser plays from a signed URL fetched per view and has no use for the
 * object layout of a private bucket; sending it would leak that layout to every
 * viewer for nothing.
 *
 * NEITHER DOES TRANSCRIPT TEXT UNLESS IT IS READY. A row whose status is
 * `failed` may still carry text from an earlier partial attempt, and shipping
 * that would put unverified words under a "Transcript" heading.
 */
function toVideo(row: VideoRow): TrainingVideo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    durationSeconds: row.duration_seconds,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at,
    equipment: row.equipment ?? [],
    keywords: row.keywords ?? [],
    tags: row.tags ?? [],
    status: row.status,
    hasCloudAsset: row.status === "ready" && row.storage_path !== null,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    transcriptStatus: row.transcript_status,
    transcriptText: row.transcript_status === "ready" ? row.transcript_text : null,
    transcriptErrorSafe: row.transcript_error_safe,
    transcriptProvider: row.transcript_provider,
    viewCount: row.view_count,
    thumbnailTone: row.thumbnail_tone,
  };
}

/**
 * The library, FILTERED BY STATUS AT THE DATABASE.
 *
 * THE BUG THIS REPLACES: this returned every row regardless of status, so a
 * half-finished upload appeared in the ordinary library as an unplayable
 * video — and the detail screen, seeing no cloud asset, described it with the
 * legacy wording: "added before cloud video storage existed, its file is still
 * only in the browser". That is false about a row created ten seconds ago by
 * this very deployment.
 *
 * The filter is applied HERE rather than in the client, so a viewer without
 * `manage_videos` never receives a pending or failed row at all. Hiding rows
 * in the browser would still have put them on the wire.
 */
export async function listTrainingVideos(
  statuses: readonly TrainingVideoStatus[] = ["ready"],
): Promise<TrainingVideo[]> {
  if (statuses.length === 0) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("training_videos")
    .select(COLUMNS)
    .in("status", statuses as string[])
    .order("uploaded_at", { ascending: false });

  if (error) throw new Error(`Could not list training videos: ${error.message}`);
  return ((data ?? []) as unknown as VideoRow[]).map(toVideo);
}

/**
 * Moves a pending upload to `failed`.
 *
 * Scoped to `pending_upload` by the WHERE clause, so it cannot un-publish a
 * ready video however it is called — the transition is expressed in the query
 * rather than checked beforehand and hoped about.
 */
export async function failPendingTrainingVideo(id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("training_videos")
    .update({ status: "failed" })
    .eq("id", id)
    .eq("status", "pending_upload")
    .select("id");

  if (error) throw new Error(`Could not close that upload: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function getTrainingVideo(id: string): Promise<TrainingVideo | null> {
  const row = await getTrainingVideoRow(id);
  return row ? toVideo(row) : null;
}

/** The full row, storage path included. Never returned to a browser. */
export async function getTrainingVideoRow(id: string): Promise<VideoRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("training_videos")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not read that training video: ${error.message}`);
  return (data as unknown as VideoRow) ?? null;
}

export async function createPendingTrainingVideo(input: {
  title: string;
  description: string;
  category: string;
  durationSeconds: number;
  equipment: string[];
  keywords: string[];
  tags: string[];
  uploadedByUserId: string | null;
  uploadedByName: string;
  thumbnailTone: TrainingVideo["thumbnailTone"];
}): Promise<{ id: string }> {
  const { data, error } = await getSupabaseAdmin()
    .from("training_videos")
    .insert({
      title: input.title,
      description: input.description,
      category: input.category,
      duration_seconds: input.durationSeconds,
      equipment: input.equipment,
      keywords: input.keywords,
      tags: input.tags,
      uploaded_by_user_id: input.uploadedByUserId,
      uploaded_by_name: input.uploadedByName,
      storage_bucket: VIDEO_BUCKET,
      status: "pending_upload",
      /*
       * THE HONEST RESTING STATE. `not_configured` rather than `not_started`,
       * because no speech-to-text provider exists in this deployment — the
       * difference is what an administrator sees and whether waiting for a job
       * would ever end. Read from the provider rather than hardcoded, so this
       * becomes `not_started` by itself the day one is wired.
       */
      transcript_status: getTranscriptionProvider().configured
        ? "not_started"
        : "not_configured",
      thumbnail_tone: input.thumbnailTone,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Could not create that training video: ${error?.message ?? "no row"}`);
  }
  return { id: (data as { id: string }).id };
}

/** Records the path an upload token was issued for, before any bytes exist. */
export async function setPendingStorageTarget(input: {
  id: string;
  storagePath: string;
  mimeType: AllowedVideoMimeType;
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("training_videos")
    .update({ storage_path: input.storagePath, mime_type: input.mimeType })
    .eq("id", input.id);

  if (error) throw new Error(`Could not record the upload target: ${error.message}`);
}

/**
 * Marks a video ready — ONLY after the object was seen in the bucket.
 *
 * `sizeBytes` comes from the storage listing, not from the request, so the
 * recorded size is the object's actual size rather than what a client claimed
 * it was about to upload.
 */
export async function markTrainingVideoReady(input: {
  id: string;
  sizeBytes: number;
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("training_videos")
    .update({ status: "ready", size_bytes: input.sizeBytes })
    .eq("id", input.id);

  if (error) throw new Error(`Could not finalize that training video: ${error.message}`);
}

export async function markTrainingVideoFailed(id: string): Promise<void> {
  // Not deleted. A row that failed is visible and explainable; a row that
  // vanished looks like the upload never happened.
  const { error } = await getSupabaseAdmin()
    .from("training_videos")
    .update({ status: "failed" })
    .eq("id", id);

  if (error) throw new Error(`Could not record that failure: ${error.message}`);
}
