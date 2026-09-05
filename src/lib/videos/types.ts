/**
 * The training-video wire contract.
 *
 * No `server-only`: the library screen and the upload dialog need these types.
 * They are types, and the only thing that travels with them is metadata — the
 * bytes never pass through a Next.js request in either direction.
 */

export type TrainingVideoStatus = "pending_upload" | "ready" | "failed";

/**
 * Transcript state.
 *
 * `not_configured` is distinct from `not_started` on purpose: "this deployment
 * has no speech-to-text provider" and "nobody has asked for this one yet" need
 * different words on screen and lead to different actions. Collapsing them
 * would have an administrator waiting for a job that can never be queued.
 */
export type TrainingVideoTranscriptStatus =
  | "not_configured"
  | "not_started"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export interface TrainingVideo {
  id: string;
  title: string;
  description: string;
  category: string;
  durationSeconds: number;
  uploadedByName: string;
  uploadedAt: string;
  equipment: string[];
  keywords: string[];
  tags: string[];
  status: TrainingVideoStatus;
  /**
   * Whether a playable object exists.
   *
   * A BOOLEAN, NOT THE PATH. The browser has no use for a storage path — it
   * plays from a signed URL fetched per view — and sending one would hand every
   * viewer the object layout of a private bucket for nothing.
   */
  hasCloudAsset: boolean;
  mimeType: string | null;
  sizeBytes: number | null;
  transcriptStatus: TrainingVideoTranscriptStatus;
  /** Present only when `transcriptStatus` is `ready`. */
  transcriptText: string | null;
  /** Application-written, never a provider's raw message. */
  transcriptErrorSafe: string | null;
  transcriptProvider: string | null;
  viewCount: number;
  thumbnailTone: "sage" | "tan" | "blush" | "slate" | "gold";
}

/** What the browser sends to begin an upload. Metadata only — never bytes. */
export interface CreateTrainingVideoRequest {
  title: string;
  description?: string;
  category: string;
  durationSeconds?: number;
  equipment?: string[];
  keywords?: string[];
  tags?: string[];
  /** Checked against the allowlist server-side before a token is issued. */
  mimeType: string;
  sizeBytes: number;
}

/**
 * The minimum capability the browser needs to upload, and nothing more.
 *
 * `path` and `token` together authorise writing ONE object. There is no bucket
 * listing, no read grant, and no ability to name a different path — the server
 * derived this one from the row id it just created.
 */
export interface CreateTrainingVideoResponse {
  video: TrainingVideo;
  upload: {
    bucket: string;
    path: string;
    token: string;
  };
}

export interface TrainingVideoPlaybackResponse {
  /** Short-lived, single-object, minted per request. */
  url: string;
  expiresInSeconds: number;
  mimeType: string;
}
