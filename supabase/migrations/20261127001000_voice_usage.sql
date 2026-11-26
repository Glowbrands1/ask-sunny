-- VOICE_INPUT_ENABLED: one row per voice transcription, for the voice limits (src/lib/voice/voice-limits.ts).
--
-- Additive: nothing here alters an existing table. The flag defaults off, and the app writes no row until it is on
-- and the person is on VOICE_INPUT_USERS.
--
-- No audio and no transcript is ever stored here (or anywhere): a row holds who, which salon, which chat box, how
-- long the clip was and how it ended. anon and authenticated have no grants and RLS is forced with no policy, so a
-- signed-in browser cannot read, insert or update anybody's counters (its own included). The server writes with the
-- service role, only after the route's own access check has passed.
--
-- voice_usage_reserve: in one step (serialised by a transaction advisory lock, so two overlapping requests cannot
-- both take the last place), counts the pending and succeeded rows for the person, their salon and the company since
-- Manila midnight, and the person's in the last 60 seconds, and when every cap has room inserts a pending row and
-- returns its id. A pending row counts as the clip length the browser reported (clamped by the caller's minimum and
-- maximum) until it is finished, and it is never released, so a crash still counts. A finished row counts as the
-- audio length the provider reported.

create table public.voice_usage (
  id uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  user_id text not null,
  salon_id text,
  surface text not null check (surface in ('chat', 'overview', 'report', 'l10')),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  clip_seconds numeric not null check (clip_seconds >= 0),
  audio_seconds numeric check (audio_seconds is null or audio_seconds >= 0)
);

create index voice_usage_created_at_idx on public.voice_usage (created_at desc);
create index voice_usage_user_created_idx on public.voice_usage (user_id, created_at desc);
create index voice_usage_salon_created_idx on public.voice_usage (salon_id, created_at desc) where salon_id is not null;

comment on table public.voice_usage is
  'VOICE_INPUT_ENABLED: one row per voice transcription (who, salon, chat box, seconds, outcome). No audio, no text. Service role only.';

alter table public.voice_usage enable row level security;
alter table public.voice_usage force row level security;

revoke all on public.voice_usage from public, anon, authenticated;
grant select, insert, update on public.voice_usage to service_role;

create or replace function public.voice_usage_reserve(
  p_user_id text,
  p_salon_id text,
  p_surface text,
  p_clip_seconds numeric,
  p_min_seconds numeric,
  p_max_seconds numeric,
  p_per_minute integer,
  p_per_day integer,
  p_user_audio_seconds numeric,
  p_salon_audio_seconds numeric,
  p_company_audio_seconds numeric
)
returns table (usage_id uuid, refused text, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
  v_clip numeric := least(p_max_seconds, greatest(p_min_seconds, coalesce(p_clip_seconds, p_max_seconds)));
  v_minute_count integer;
  v_minute_oldest timestamptz;
  v_user_count integer;
  v_user_seconds numeric;
  v_salon_seconds numeric;
  v_company_seconds numeric;
  v_id uuid;
begin
  if p_user_id is null or length(trim(p_user_id)) = 0 then
    raise exception 'voice_usage_reserve: no user';
  end if;

  -- One reservation at a time, so the counts below and the insert are one step.
  perform pg_advisory_xact_lock(hashtext('public.voice_usage_reserve'));

  select count(*), min(u.created_at)
    into v_minute_count, v_minute_oldest
    from public.voice_usage u
   where u.user_id = p_user_id
     and u.status in ('pending', 'succeeded')
     and u.created_at > now() - interval '60 seconds';
  if v_minute_count >= p_per_minute then
    return query select null::uuid, 'user_minute'::text,
      greatest(1, ceil(extract(epoch from (v_minute_oldest + interval '60 seconds' - now()))))::integer;
    return;
  end if;

  select count(*),
         coalesce(sum(case when u.status = 'succeeded' and u.audio_seconds is not null then u.audio_seconds else u.clip_seconds end), 0)
    into v_user_count, v_user_seconds
    from public.voice_usage u
   where u.user_id = p_user_id
     and u.status in ('pending', 'succeeded')
     and u.created_at >= v_day_start;
  if v_user_count >= p_per_day or v_user_seconds + v_clip > p_user_audio_seconds then
    return query select null::uuid, 'user_day'::text, null::integer;
    return;
  end if;

  if p_salon_id is not null then
    select coalesce(sum(case when u.status = 'succeeded' and u.audio_seconds is not null then u.audio_seconds else u.clip_seconds end), 0)
      into v_salon_seconds
      from public.voice_usage u
     where u.salon_id = p_salon_id
       and u.status in ('pending', 'succeeded')
       and u.created_at >= v_day_start;
    if v_salon_seconds + v_clip > p_salon_audio_seconds then
      return query select null::uuid, 'salon_day'::text, null::integer;
      return;
    end if;
  end if;

  select coalesce(sum(case when u.status = 'succeeded' and u.audio_seconds is not null then u.audio_seconds else u.clip_seconds end), 0)
    into v_company_seconds
    from public.voice_usage u
   where u.status in ('pending', 'succeeded')
     and u.created_at >= v_day_start;
  if v_company_seconds + v_clip > p_company_audio_seconds then
    return query select null::uuid, 'company_day'::text, null::integer;
    return;
  end if;

  insert into public.voice_usage (user_id, salon_id, surface, status, clip_seconds)
  values (p_user_id, p_salon_id, p_surface, 'pending', v_clip)
  returning id into v_id;

  return query select v_id, null::text, null::integer;
end;
$$;

comment on function public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric) is
  'VOICE_INPUT_ENABLED: checks the voice caps and, when there is room, inserts a pending voice_usage row and returns its id. Service role only.';

revoke all on function public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric) to service_role;
