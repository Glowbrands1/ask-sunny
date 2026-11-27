-- VOICE_INPUT_ENABLED: the voice caps' day runs midnight to midnight US Central time (America/Chicago), not Manila.
--
-- The owner, 27 Nov 2026, asked whether the voice daily limit should reset at Manila or Central midnight: "central".
-- 20261127002000_voice_usage.sql counted the day from Manila midnight (16:00 UTC), which for a manager in Central
-- time reset the day mid-morning. Central has daylight saving, so the day start is Postgres's own zone maths
-- (`at time zone 'America/Chicago'`), never a fixed offset: a day is 23 hours in March and 25 in November.
--
-- voice_usage_reserve also takes an optional p_now (null means now()), so its tests can pin the clock instead of
-- depending on the hour they run at. The route does not pass it. With p_now, the minute window, the day window and
-- the inserted row's created_at all use that instant.
--
-- The table and its rows are unchanged. Rows already written keep their created_at; from this migration on they
-- are counted against the Central day.
--
-- Rollback: re-run voice_usage_reserve from 20261127002000_voice_usage.sql after
--   drop function if exists public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric, timestamptz);

drop function if exists public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric);

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
  p_company_audio_seconds numeric,
  p_now timestamptz default null
)
returns table (usage_id uuid, refused text, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_day_start timestamptz := date_trunc('day', coalesce(p_now, now()) at time zone 'America/Chicago') at time zone 'America/Chicago';
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
     and u.created_at > v_now - interval '60 seconds'
     and u.created_at <= v_now;
  if v_minute_count >= p_per_minute then
    return query select null::uuid, 'user_minute'::text,
      greatest(1, ceil(extract(epoch from (v_minute_oldest + interval '60 seconds' - v_now))))::integer;
    return;
  end if;

  select count(*),
         coalesce(sum(case when u.status = 'pending' then u.clip_seconds else coalesce(u.audio_seconds, u.clip_seconds) end), 0)
    into v_user_count, v_user_seconds
    from public.voice_usage u
   where u.user_id = p_user_id
     and u.created_at >= v_day_start
     and u.created_at <= v_now;
  if v_user_count >= p_per_day or v_user_seconds + v_clip > p_user_audio_seconds then
    return query select null::uuid, 'user_day'::text, null::integer;
    return;
  end if;

  if p_salon_id is not null then
    select coalesce(sum(case when u.status = 'pending' then u.clip_seconds else coalesce(u.audio_seconds, u.clip_seconds) end), 0)
      into v_salon_seconds
      from public.voice_usage u
     where u.salon_id = p_salon_id
       and u.created_at >= v_day_start
       and u.created_at <= v_now;
    if v_salon_seconds + v_clip > p_salon_audio_seconds then
      return query select null::uuid, 'salon_day'::text, null::integer;
      return;
    end if;
  end if;

  select coalesce(sum(case when u.status = 'pending' then u.clip_seconds else coalesce(u.audio_seconds, u.clip_seconds) end), 0)
    into v_company_seconds
    from public.voice_usage u
   where u.created_at >= v_day_start
     and u.created_at <= v_now;
  if v_company_seconds + v_clip > p_company_audio_seconds then
    return query select null::uuid, 'company_day'::text, null::integer;
    return;
  end if;

  insert into public.voice_usage (user_id, salon_id, surface, status, clip_seconds, created_at)
  values (p_user_id, p_salon_id, p_surface, 'pending', v_clip, v_now)
  returning id into v_id;

  return query select v_id, null::text, null::integer;
end;
$$;

comment on function public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric, timestamptz) is
  'VOICE_INPUT_ENABLED: checks the voice caps (day: Central midnight, America/Chicago) and, when there is room, inserts a pending voice_usage row and returns its id. p_now pins the clock for tests. Service role only.';

revoke all on function public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.voice_usage_reserve(text, text, text, numeric, numeric, numeric, integer, integer, numeric, numeric, numeric, timestamptz) to service_role;
