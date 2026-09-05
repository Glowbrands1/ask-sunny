-- ---------------------------------------------------------------------------
-- TRAINING VIDEOS — durable metadata and a private bucket for the bytes.
--
-- ADDITIVE ONLY. One new bucket, one new table, its indexes and its policies.
-- Nothing existing is read, rewritten or dropped: `knowledge_documents`,
-- `knowledge_chunks`, the reporting tables, Sales Totals, Forms, `app_users`,
-- and the `knowledge-documents` and `reporting-sources` buckets and their
-- policies are all untouched by this file.
--
-- WHY A SEPARATE BUCKET FROM `knowledge-documents`. Different MIME types,
-- a file-size ceiling two orders of magnitude larger, a different lifecycle,
-- and a different access pattern — a training video is streamed with range
-- requests, a policy PDF is downloaded once and chunked. Widening the
-- knowledge bucket's `allowed_mime_types` and `file_size_limit` to admit video
-- would loosen the constraints that currently stop somebody uploading a 400 MB
-- file into the retrieval corpus. Two buckets keeps each one's limits honest.
--
-- THE BUCKET IS PRIVATE. `public` is false and NO `storage.objects` policy is
-- created for it, so no browser role — anon or authenticated — can list, read
-- or write an object. Every read is a short-lived signed URL minted
-- server-side, and every write goes through a signed upload token scoped to one
-- object path, exactly as `reporting-sources` works today. A public bucket
-- would put company training material behind a guessable URL.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-videos',
  'training-videos',
  false,
  /*
   * 50 MB — MATCHED TO THIS PROJECT'S VERIFIED CEILING.
   *
   * A bucket's `file_size_limit` cannot exceed the PROJECT's global upload
   * limit in any useful way: the project's wins whenever it is lower, and the
   * upload fails at the storage API rather than here. This project was checked
   * in the dashboard (Storage → Files → Settings) and is on the FREE plan,
   * whose global limit is fixed at 50 MB.
   *
   * This value was 500 MB, sized for what a long training video needs rather
   * than for what this deployment can accept — a promise the storage API would
   * have refused mid-transfer.
   *
   * `VIDEO_LIMITS.maxBytes` in `src/lib/videos/policy.ts` is the same number,
   * and a test reads this file to prove it. On a paid plan all three — this
   * value, the application constant, and the dashboard setting — move together.
   */
  52428800,
  array[
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do nothing;

/*
 * WHERE A VIDEO IS IN ITS LIFECYCLE.
 *
 * An enum rather than free text, for the same reason `app_user_role` is one: a
 * typo becomes a rejected write instead of a row in a state nothing handles.
 *
 *   pending_upload — the row exists and a signed upload token has been issued,
 *                    but no object has been confirmed. NOT playable.
 *   ready          — the object was verified to exist in the bucket by the
 *                    server, after the browser said it had uploaded. Playable.
 *   failed         — the upload did not complete. Kept rather than deleted so
 *                    the failure is visible instead of a video silently
 *                    vanishing from the library.
 *
 * `pending_upload` is the default because the row is created BEFORE the bytes
 * exist. A row that never reaches `ready` is a failed upload, and it can never
 * be mistaken for a playable one.
 */
create type public.training_video_status as enum (
  'pending_upload',
  'ready',
  'failed'
);

/*
 * TRANSCRIPT STATE, kept separate from upload state because they are
 * independent: a video is playable the moment its bytes land, whether or not
 * anything has transcribed it.
 *
 *   not_configured — no speech-to-text provider is configured in this
 *                    deployment. The honest resting state today, and NOT the
 *                    same as "nobody has asked yet".
 *   not_started    — a provider exists and no transcription has been requested.
 *   queued         — requested, not yet picked up.
 *   processing     — a provider is working on it.
 *   ready          — transcript text EXISTS. Never set without text.
 *   failed         — the attempt finished without a transcript.
 */
create type public.training_video_transcript_status as enum (
  'not_configured',
  'not_started',
  'queued',
  'processing',
  'ready',
  'failed'
);

create table public.training_videos (
  id uuid primary key default gen_random_uuid(),

  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '',
  category text not null,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),

  /*
   * WHO UPLOADED IT, both ways. The id is the durable link and is set null if
   * the account is ever removed, so a deleted user does not delete the video.
   * The display name is denormalised because a video's history should still
   * read correctly after somebody leaves.
   */
  uploaded_by_user_id uuid references auth.users (id) on delete set null,
  uploaded_by_name text not null default '',
  uploaded_at timestamptz not null default now(),

  equipment text[] not null default '{}',
  keywords text[] not null default '{}',
  tags text[] not null default '{}',

  /*
   * WHERE THE BYTES ARE.
   *
   * `storage_path` is DERIVED FROM THE ROW'S ID by the server and never taken
   * from a request — see `storagePathFor` in `src/lib/videos/policy.ts`. A
   * client-supplied path is a directory-traversal and object-overwrite hazard,
   * and the uniqueness constraint below means two rows cannot claim the same
   * object even if that derivation is ever changed carelessly.
   */
  storage_bucket text not null default 'training-videos',
  storage_path text unique,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),

  status public.training_video_status not null default 'pending_upload',

  transcript_status public.training_video_transcript_status not null
    default 'not_configured',
  transcript_text text,
  /*
   * A SAFE error string, written by the application, never a provider's raw
   * message. A transcription provider echoes its request on failure, and that
   * request carries a signed media URL — which is a working, time-limited
   * credential for a private object. The column name carries the rule.
   */
  transcript_error_safe text,
  transcript_provider text,
  transcript_updated_at timestamptz,

  view_count integer not null default 0 check (view_count >= 0),

  /*
   * The prototype's per-video placeholder swatch, preserved so a migrated
   * record keeps the look it had. Constrained to the five the UI knows.
   */
  thumbnail_tone text not null default 'sage'
    check (thumbnail_tone in ('sage', 'tan', 'blush', 'slate', 'gold')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /*
   * A READY VIDEO HAS BYTES. Enforced in the database rather than trusted to
   * the finalize route, because "ready" is what the playback route checks
   * before minting a signed URL — a ready row with no path would be a 500 at
   * best and a signed URL for a non-existent object at worst.
   */
  constraint training_videos_ready_has_object check (
    status <> 'ready'
    or (storage_path is not null and mime_type is not null and size_bytes is not null)
  ),

  /*
   * A READY TRANSCRIPT HAS TEXT. The rule that stops a status field claiming a
   * transcript exists when it does not — which is the one thing a transcript UI
   * must never do.
   */
  constraint training_videos_ready_transcript_has_text check (
    transcript_status <> 'ready'
    or (transcript_text is not null and length(trim(transcript_text)) > 0)
  )
);

create index training_videos_uploaded_at_idx
  on public.training_videos (uploaded_at desc);
create index training_videos_category_idx
  on public.training_videos (category);
create index training_videos_status_idx
  on public.training_videos (status);

/*
 * RLS ENABLED AND FORCED, WITH NO POLICIES.
 *
 * Same posture as the reporting tables: no policy means no row is visible to
 * `anon` or `authenticated` through PostgREST, however they authenticated.
 * Every read and write goes through the server under the secret key, after
 * `authorizeRequest` has checked `view_videos` or `manage_videos`.
 *
 * FORCE matters. Without it the table owner bypasses RLS, so a future function
 * or view owned by the same role could read the table from a browser context.
 */
alter table public.training_videos enable row level security;
alter table public.training_videos force row level security;

revoke all on public.training_videos from anon, authenticated;

/*
 * `updated_at` maintained by the database, not by whichever caller remembered.
 */
create or replace function public.touch_training_video_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger training_videos_touch_updated_at
  before update on public.training_videos
  for each row
  execute function public.touch_training_video_updated_at();

/*
 * Postgres grants EXECUTE on a new function to PUBLIC. Revoking from `anon,
 * authenticated` alone is a NO-OP, because the grant they are using is
 * PUBLIC's — a lesson this project has already learned once, on
 * `accept_invitation`. Revoke from PUBLIC.
 */
revoke all on function public.touch_training_video_updated_at() from public;

comment on table public.training_videos is
  'Training video library. Bytes live in the private training-videos bucket; '
  'storage_path is derived server-side from the row id and never accepted from '
  'a client. RLS is enabled and forced with no policies: all access is '
  'server-side under the secret key, behind view_videos / manage_videos.';
