-- ---------------------------------------------------------------------------
-- AI TRAINING -> ASSIGNMENTS: the twice-monthly AI assignment tracker.
--
-- Two assignments a month per person: one for the 1st to the 15th, one for the
-- 16th to month end. A person's half is Done, More time (an extension), or not
-- marked; an unmarked half reads Due while it runs and Missing once it ends
-- (computed in `src/lib/ai-training/assignments.ts`, never stored).
--
-- Replaces a standalone tracker page (Pau, 23 Nov 2026). Who may see or change it
-- is a named list of people (`AI_ASSIGNMENT_TRACKER_EMAILS`, else the AI Training
-- editors), checked on the server.
--
-- ADDITIVE ONLY. Two new tables; nothing existing is read, rewritten or dropped.
--
-- RLS IS ENABLED WITH NO POLICIES, as for the other `ai_training_*` tables: a
-- browser client reads zero rows through PostgREST however it signed in. Every
-- read and write runs on the server under the secret key, after the access check
-- (`src/lib/ai-training/assignments-repository.ts`).
-- ---------------------------------------------------------------------------

create table public.ai_assignment_people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  -- An optional heading the grid groups people under (a team, a department).
  group_name text check (group_name is null or length(trim(group_name)) between 1 and 100),
  -- Joined recently: halves before this date read as not applicable.
  start_date date,
  sort_order integer,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index ai_assignment_people_name_idx
  on public.ai_assignment_people (lower(trim(name)));

create table public.ai_assignment_marks (
  person_id uuid not null references public.ai_assignment_people (id) on delete cascade,
  -- The month, as YYYY-MM.
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- 0: the 1st to the 15th; 1: the 16th to month end.
  half smallint not null check (half in (0, 1)),
  state text not null check (state in ('done', 'extended')),
  marked_by text not null default '',
  marked_at timestamptz not null default now(),
  primary key (person_id, month, half)
);

alter table public.ai_assignment_people enable row level security;
alter table public.ai_assignment_people force row level security;
alter table public.ai_assignment_marks enable row level security;
alter table public.ai_assignment_marks force row level security;

revoke all on public.ai_assignment_people, public.ai_assignment_marks from anon, authenticated;
grant all on public.ai_assignment_people, public.ai_assignment_marks to service_role;
