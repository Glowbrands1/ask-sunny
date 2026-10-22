-- FORMS — ONE FORM PER CHAT CARD, GUARANTEED BY THE DATABASE
--
-- A form created from an Ask Sunny chat card carries the card's id
-- (`proposalId`). The create route returns the form a card already made rather
-- than filing a second one — after a lost response, a retry, a second tab or a
-- reopened conversation. In the app that is a lookup, serialised per card
-- within one server process; two requests landing on DIFFERENT server
-- instances at the same moment could both pass the lookup. This table closes
-- that: the first request to claim (manager, card) wins, and every other
-- request for the same card waits for, and returns, the winner's form.
--
-- Additive only: one new table. Nothing existing is altered. Like every forms
-- table it is server-only: RLS enabled AND forced, no policy, every privilege
-- revoked from anon and authenticated.
--
-- DEPLOY ORDER. Either order is safe. Until this is applied the code skips the
-- claim and relies on the lookup and the in-process lock alone (see
-- `src/lib/forms/create-once.ts`).

create table if not exists public.form_create_claims (
  created_by text not null check (length(created_by) between 1 and 200),
  proposal_id text not null check (proposal_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Null while the winning request is still creating the form.
  instance_id uuid references public.form_instances (id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (created_by, proposal_id)
);

comment on table public.form_create_claims is
  'One row per (manager, chat card) that created a form. The primary key is what stops two concurrent creates from the same card filing two forms. Server-only.';

alter table public.form_create_claims enable row level security;
alter table public.form_create_claims force row level security;
revoke all on public.form_create_claims from anon, authenticated;
