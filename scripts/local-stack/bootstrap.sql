-- ============================================================================
-- A SUPABASE-SHAPED DATABASE, FOR THE DISPOSABLE LOCAL STACK ONLY.
-- ============================================================================
--
-- Mirrors what Ask Sunny's Supabase project was observed to have (read-only
-- catalog check, 2 Oct 2026), so migrations and RLS behave as they do there:
--
--   * `supabase_admin` is the superuser; `postgres` is NOT — it is LOGIN,
--     CREATEROLE, BYPASSRLS, and it applies the migrations.
--   * `anon`, `authenticated` (no RLS bypass) and `service_role` (BYPASSRLS)
--     are NOLOGIN; `authenticator` (LOGIN, NOINHERIT) is PostgREST's login.
--   * `supabase_auth_admin` owns the `auth` schema, as Supabase Auth expects.
--   * Default privileges in `public` grant tables, functions and sequences to
--     anon, authenticated and service_role — which is why Ask Sunny's
--     migrations revoke explicitly.
--   * `postgres` may DELETE from auth.sessions / auth.refresh_tokens (granted
--     after Supabase Auth has created them; see up.sh).
--
-- `storage` is a stub: Ask Sunny's migrations only create buckets in it.

create role postgres login createrole createdb bypassrls password 'postgres';
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;
create role supabase_auth_admin login noinherit createrole password 'supabase_auth_admin';

alter schema public owner to postgres;
grant usage on schema public to anon, authenticated, service_role;

create schema extensions authorization postgres;
grant usage on schema extensions to anon, authenticated, service_role, supabase_auth_admin;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

create schema auth authorization supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role;
alter role supabase_auth_admin set search_path = auth;

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

create schema storage authorization postgres;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key, name text not null unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default extensions.gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to postgres;
