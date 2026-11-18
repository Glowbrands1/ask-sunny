-- ---------------------------------------------------------------------------
-- AI TRAINING — the JBA AI Training program, rebuilt inside this app.
--
-- It was a separate Lovable app with its own sign-in, name confirmation and
-- approval screens. Here it sits behind this app's own login: who may read it
-- is the `view_ai_training` permission, who may edit it is the admin console
-- roles (`ADMIN_CONSOLE_ROLES`), both checked on the server.
--
-- ADDITIVE ONLY. Five new tables; nothing existing is read, rewritten or
-- dropped.
--
-- RLS IS ENABLED WITH NO POLICIES, the same posture as `training_videos`: a
-- browser client reads zero rows through PostgREST however it signed in. Every
-- read and write runs on the server under the secret key, after the permission
-- check (`src/lib/ai-training/repository.ts`).
--
-- IDS ARE KEPT FROM THE OLD APP. The import (`src/lib/ai-training/import.ts`)
-- upserts the old app's exported rows by their own uuids, so a second import of
-- a fresh export updates rows instead of duplicating them.
-- ---------------------------------------------------------------------------

create table public.ai_training_tracks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title text not null check (length(trim(title)) between 1 and 200),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.ai_training_modules (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ai_training_tracks (id) on delete cascade,
  slug text not null,
  title text not null check (length(trim(title)) between 1 and 300),
  sort_order integer not null default 0,
  -- An archive module: visible to administrators only.
  admin_only boolean not null default false,
  created_at timestamptz not null default now(),
  unique (track_id, slug)
);

create table public.ai_training_lessons (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ai_training_tracks (id) on delete cascade,
  module_id uuid references public.ai_training_modules (id) on delete set null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,160}$'),
  title text not null check (length(trim(title)) between 1 and 300),
  summary text,
  -- Notion-flavoured markdown, rendered by `src/lib/ai-training/markdown.ts`.
  body_md text not null default '',
  week_number integer,
  sort_order integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_id, slug)
);

create index ai_training_lessons_track_idx
  on public.ai_training_lessons (track_id, sort_order);

/*
 * THE PROGRAM'S OWN PAGES: `policy` (AI Access & Use Policy), `best_practices`,
 * `announcement` and `home_intro`, keyed as the old app keyed them.
 */
create table public.ai_training_pages (
  key text primary key check (key ~ '^[a-z0-9_]{1,60}$'),
  title text not null,
  body_md text not null default '',
  updated_at timestamptz not null default now()
);

/*
 * A STAFF MEMBER'S RESPONSE TO A LESSON, and an administrator's review of it.
 *
 * `user_subject` is the auth subject of the person who submitted it; the name
 * is denormalised so the record still reads correctly after somebody leaves.
 * Private to its author and administrators — enforced in the repository, as
 * every read here is server-side.
 */
create table public.ai_training_submissions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid references public.ai_training_lessons (id) on delete set null,
  user_subject text not null,
  user_name text not null default '',
  user_email text not null default '',
  title text not null check (length(trim(title)) between 1 and 300),
  body text not null default '' check (length(body) <= 20000),
  link_url text check (link_url is null or link_url ~ '^https?://'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested')),
  feedback text not null default '',
  reviewed_by_name text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_training_submissions_user_idx
  on public.ai_training_submissions (user_subject, created_at desc);
create index ai_training_submissions_lesson_idx
  on public.ai_training_submissions (lesson_id);
create index ai_training_submissions_status_idx
  on public.ai_training_submissions (status, created_at desc);

create trigger ai_training_lessons_touch_updated_at
  before update on public.ai_training_lessons
  for each row execute function public.touch_updated_at();
create trigger ai_training_pages_touch_updated_at
  before update on public.ai_training_pages
  for each row execute function public.touch_updated_at();
create trigger ai_training_submissions_touch_updated_at
  before update on public.ai_training_submissions
  for each row execute function public.touch_updated_at();

alter table public.ai_training_tracks enable row level security;
alter table public.ai_training_tracks force row level security;
alter table public.ai_training_modules enable row level security;
alter table public.ai_training_modules force row level security;
alter table public.ai_training_lessons enable row level security;
alter table public.ai_training_lessons force row level security;
alter table public.ai_training_pages enable row level security;
alter table public.ai_training_pages force row level security;
alter table public.ai_training_submissions enable row level security;
alter table public.ai_training_submissions force row level security;

revoke all on public.ai_training_tracks, public.ai_training_modules,
  public.ai_training_lessons, public.ai_training_pages,
  public.ai_training_submissions from anon, authenticated;
grant all on public.ai_training_tracks, public.ai_training_modules,
  public.ai_training_lessons, public.ai_training_pages,
  public.ai_training_submissions to service_role;
