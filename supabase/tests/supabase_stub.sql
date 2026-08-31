-- Stand-ins for the Supabase-managed objects the migrations reference, so the
-- full migration sequence can be applied to a plain local PostgreSQL cluster.
--
-- The last statement is the important one: Supabase ships default privileges
-- that grant ALL on every new table in `public` to `anon` and `authenticated`.
-- Reproducing that locally is what makes the privilege checks meaningful — it
-- is the exact behaviour that left write privileges in place on the knowledge
-- tables until post-application verification caught it.

do $$ begin if not exists (select 1 from pg_roles where rolname='anon')
  then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated')
  then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role')
  then create role service_role nologin bypassrls; end if; end $$;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (id uuid primary key);

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id        uuid primary key,
  bucket_id text,
  name      text
);

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector   with schema extensions;

alter default privileges in schema public grant all on tables to anon, authenticated;
