-- ---------------------------------------------------------------------------
-- IN-APP NOTIFICATIONS — the bell in the top bar.
--
-- First use (Pau, 20 Nov 2026): when someone submits AI Training work, the
-- people on `AI_TRAINING_NOTIFY_EMAILS` get a notification that links to the
-- submissions to review. The table is generic so later alerts use the same
-- bell.
--
-- ADDITIVE ONLY. One new table; nothing existing is read, rewritten or dropped.
--
-- Addressed by EMAIL, the identity the app already matches AI Training editors
-- on (`src/lib/ai-training/editors.ts`), so a notification can be written for
-- someone before they have ever signed in.
--
-- RLS IS ENABLED WITH NO POLICIES, as for the AI Training tables: a browser
-- client reads zero rows. Every read and write runs on the server under the
-- secret key, scoped to the signed-in caller's own email
-- (`src/lib/notifications/repository.ts`).
-- ---------------------------------------------------------------------------

create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null
    check (recipient_email = lower(btrim(recipient_email)) and position('@' in recipient_email) > 1),
  -- What raised it, e.g. 'ai_training_submission'.
  kind text not null check (kind ~ '^[a-z][a-z0-9_]{0,59}$'),
  title text not null check (length(btrim(title)) between 1 and 300),
  body text not null default '' check (length(body) <= 2000),
  -- An in-app path only ("/ai-training/manage?tab=submissions"), never another site.
  href text check (href is null or href ~ '^/[^/\\]'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index app_notifications_recipient_idx
  on public.app_notifications (recipient_email, created_at desc);
create index app_notifications_unread_idx
  on public.app_notifications (recipient_email)
  where read_at is null;

alter table public.app_notifications enable row level security;
alter table public.app_notifications force row level security;

revoke all on public.app_notifications from anon, authenticated;
grant all on public.app_notifications to service_role;
