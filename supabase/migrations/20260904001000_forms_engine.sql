-- ---------------------------------------------------------------------------
-- FORMS — templates, immutable versions, PDF assets, and the forms themselves.
--
-- This is HR data. A coaching form names an employee, states what they did
-- wrong and what happens if it continues; a disciplinary plan records a warning
-- and its consequence. That is a different class of content from the reporting
-- domain, and this schema is built for it:
--
--   NOTHING IS READABLE WITHOUT THE SECRET KEY. Row level security is enabled
--   AND forced on every table, and not one policy is created. `anon` and
--   `authenticated` are revoked outright. Ask Sunny has no identity provider
--   yet — `authorizeRequest` returns 501 in live mode for exactly that reason —
--   so there is no honest way to say which authenticated user may read which
--   employee's file. Until that exists, the answer is nobody: reads and writes
--   go through server routes holding the secret key, which is the only place
--   the app can apply the permission matrix at all.
--
--   When an identity provider lands, the policies added here should be
--   per-user, not per-role-name — see docs/forms-architecture.md.
--
-- A TEMPLATE VERSION IS IMMUTABLE ONCE PUBLISHED. A trigger enforces it rather
-- than a convention: a published version's document cannot be updated, and a
-- finalized form keeps pointing at the exact version it was filled from. A
-- template edited tomorrow does not change yesterday's form. That is the whole
-- reason versions are a table and not a column.
--
-- FIELD RESPONSIBILITY IS TEMPLATE METADATA, NOT A MODEL'S OPINION. The
-- reference forms mark fields "AI FILLS: ..." or "FILLED BY HAND"; those become
-- `form_field_responsibility` on the field inside the version document, and the
-- server drops anything the model writes into a field it does not own. The
-- responsibility of a given field is per template — a self-review section is
-- manual in the DMIT EPP and AI-drafted in the SDIT EPP, and neither is a
-- global rule.
--
-- NOTHING HERE TOUCHES REPORTING. No reporting table, view, function or enum is
-- referenced, altered or dropped. The two domains share the database and
-- nothing else.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------------ enums ---

-- The four layouts the nine templates are built from. Verified from the
-- reference captures: Coaching stands alone; DPOA and Policy Review share the
-- corrective layout; SDIT/TSD/ASD-SDIT/FTTC share one three-page EPP; the two
-- DMIT reviews are one six-page document in two role variants.
create type public.form_layout_family as enum (
  'coaching',
  'corrective',
  'epp',
  'dmit_epp'
);

create type public.form_template_status as enum (
  'draft',      -- editable, never used by a finalized form
  'published',  -- immutable, may be the current version
  'archived'    -- was published, superseded, still referenced by old forms
);

-- WHO PUTS CONTENT IN A FIELD. The server enforces this; the model is told
-- about it but is never trusted to honour it.
create type public.form_field_responsibility as enum (
  'system',     -- the app fills it: today's date, the salon, the template name
  'ai',         -- Ask Sunny may draft it, and a manager may edit it after
  'manager',    -- the manager writes it; AI output into it is discarded
  'employee',   -- the employee's own words, collected in person
  'manual',     -- filled by hand on the printed page; never populated at all
  'signature'   -- always blank, always signed by hand
);

create type public.form_instance_status as enum (
  'draft',      -- being worked on, editable
  'finalized',  -- signed off, values frozen
  'revised'     -- finalized, then superseded by a later revision
);

create type public.form_instance_source as enum (
  'manual',     -- typed by a manager
  'ask_sunny'   -- drafted by the assistant, then reviewed
);

create type public.form_asset_kind as enum (
  'bundled_default',  -- shipped with the app
  'upload'            -- replaced by an administrator
);

create type public.form_asset_status as enum (
  'active',      -- what a download uses today
  'superseded',  -- kept, never deleted; a previous version
  'rejected'     -- failed validation, retained for the audit trail
);

create type public.form_event_kind as enum (
  'created',
  'drafted',      -- the assistant wrote into it
  'edited',
  'finalized',
  'exported',
  'revised',
  'reevaluated'
);

-- ----------------------------------------------------------- the library ---

create table public.form_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  -- Stable machine key. Forms, assets and the assistant all address a template
  -- by this, so renaming the human label never breaks a link.
  key text not null unique,
  name text not null,
  short_name text not null,
  description text not null default '',
  layout_family public.form_layout_family not null,
  -- The permission a user must hold to CREATE this form. Mirrors the app's
  -- permission matrix by name; the server resolves it, never the browser.
  required_permission text not null,
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.form_templates is
  'One row per business form. The document itself lives in form_template_versions; this table is only its identity.';

create table public.form_template_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  template_id uuid not null references public.form_templates (id) on delete cascade,
  version integer not null,
  status public.form_template_status not null default 'draft',
  /*
   * THE DOCUMENT. An ordered block list — headings, fields, checkbox groups,
   * numbered lists, signature rows, page breaks, role-scoped reference blocks —
   * carrying each field's responsibility. Shape and invariants live in
   * src/lib/forms/document.ts, which parses this on the way in and on the way
   * out; the column stores what that parser produced.
   */
  document jsonb not null,
  -- Role variants this version offers, e.g. the DMIT review's TSD and DMIT
  -- readings. Empty for a template with a single reading.
  variants jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_by text,
  archived_at timestamptz,

  constraint form_template_versions_version_positive check (version >= 1),
  constraint form_template_versions_unique_version unique (template_id, version),
  -- A published version must record when and by whom, so provenance is not
  -- optional metadata somebody forgot to fill in.
  constraint form_template_versions_published_has_stamp check (
    status <> 'published' or (published_at is not null and published_by is not null)
  )
);

comment on table public.form_template_versions is
  'Immutable once published. Editing a published version means cloning it to a new draft — see forms_guard_published_version().';

-- At most one draft per template at a time: a second draft would mean two
-- people editing different futures of the same form with no way to say which
-- wins.
create unique index form_template_versions_one_draft
  on public.form_template_versions (template_id)
  where status = 'draft';

-- The current published version. Partial-unique so "which version does a new
-- form use" has exactly one answer, enforced by the database.
create table public.form_template_current (
  template_id uuid primary key references public.form_templates (id) on delete cascade,
  version_id uuid not null references public.form_template_versions (id) on delete restrict,
  updated_at timestamptz not null default now()
);

comment on table public.form_template_current is
  'Which published version a new form is created from. One row per template, so the answer is never ambiguous.';

-- --------------------------------------------------------- the PDF assets ---

create table public.form_template_assets (
  id uuid primary key default extensions.gen_random_uuid(),
  template_id uuid not null references public.form_templates (id) on delete cascade,
  version integer not null,
  kind public.form_asset_kind not null,
  status public.form_asset_status not null default 'active',
  file_name text not null,
  storage_bucket text not null default 'forms-templates',
  storage_path text,
  content_sha256 text,
  size_bytes bigint,
  mime_type text not null default 'application/pdf',
  page_count integer,
  /*
   * WHAT THE UPLOAD ACTUALLY CONTAINS. An uploaded PDF does not become fillable
   * by being uploaded: it either carries AcroForm fields or it does not. This
   * records the inspection — field names, page count, whether a mapping exists
   * — so "can Ask Sunny fill this?" is answered from evidence rather than hope.
   */
  acroform jsonb not null default '{}'::jsonb,
  -- Why an asset was rejected, or what the validator noticed. Never discarded:
  -- a rejected upload is part of the audit trail.
  validation jsonb not null default '{}'::jsonb,
  field_map jsonb not null default '{}'::jsonb,
  uploaded_by text not null default 'system',
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.form_template_assets (id),

  constraint form_template_assets_unique_version unique (template_id, version),
  constraint form_template_assets_version_positive check (version >= 1),
  -- An upload must say where its bytes are; a bundled default is code.
  constraint form_template_assets_upload_has_bytes check (
    kind <> 'upload' or (storage_path is not null and content_sha256 is not null)
  )
);

comment on table public.form_template_assets is
  'Every PDF ever attached to a template, newest last. Replacement adds a row; it never overwrites or deletes an earlier one.';

create unique index form_template_assets_one_active
  on public.form_template_assets (template_id)
  where status = 'active';

create index form_template_assets_by_template
  on public.form_template_assets (template_id, version desc);

-- -------------------------------------------------------------- the forms ---

create table public.form_instances (
  id uuid primary key default extensions.gen_random_uuid(),
  template_id uuid not null references public.form_templates (id) on delete restrict,
  /*
   * THE EXACT VERSION THIS FORM WAS FILLED FROM. `on delete restrict` and an
   * immutable published document together are what make a finalized form
   * reproducible: re-rendering it years later reads the same blocks, labels and
   * responsibilities it was filled against.
   */
  template_version_id uuid not null references public.form_template_versions (id) on delete restrict,
  variant_key text,

  -- Subject. Synthetic in every environment until an identity provider exists.
  employee_name text not null,
  employee_role text,
  location_id text,
  location_name text,

  created_by text not null,
  created_by_role text,
  source public.form_instance_source not null default 'manual',
  status public.form_instance_status not null default 'draft',

  form_date date not null default current_date,
  follow_up_date date,
  finalized_at timestamptz,
  exported_at timestamptz,
  -- A revision points at what it replaced, so the DMIT lifecycle — review,
  -- plan, follow-up, re-evaluation — reads as one history rather than as
  -- unrelated documents.
  revises_instance_id uuid references public.form_instances (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint form_instances_finalized_has_stamp check (
    status = 'draft' or finalized_at is not null
  )
);

create index form_instances_by_template on public.form_instances (template_id, created_at desc);
create index form_instances_by_status on public.form_instances (status, follow_up_date);
create index form_instances_by_employee on public.form_instances (lower(employee_name));

create table public.form_instance_values (
  id uuid primary key default extensions.gen_random_uuid(),
  instance_id uuid not null references public.form_instances (id) on delete cascade,
  -- The field's key inside the version document. Not a foreign key, because the
  -- document is jsonb; the server validates membership on write.
  field_key text not null,
  value text,
  -- Ticked options for a checkbox group, as an array of option keys.
  checked jsonb not null default '[]'::jsonb,
  /*
   * WHO PUT THIS HERE. Not the same thing as who is ALLOWED to: responsibility
   * lives on the template, this records what actually happened, which is what
   * makes "Ask Sunny drafted this, a manager edited it" answerable later.
   */
  filled_by public.form_field_responsibility not null default 'manager',
  -- For a policy-grounded field: the knowledge documents the language came
  -- from, and whether it was verified. An unverified policy field is never
  -- presented as authoritative.
  provenance jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),

  constraint form_instance_values_unique_field unique (instance_id, field_key)
);

create index form_instance_values_by_instance on public.form_instance_values (instance_id);

create table public.form_instance_events (
  id uuid primary key default extensions.gen_random_uuid(),
  instance_id uuid not null references public.form_instances (id) on delete cascade,
  kind public.form_event_kind not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index form_instance_events_by_instance
  on public.form_instance_events (instance_id, created_at desc);

-- ------------------------------------------------------------- immutable ---

/*
 * A PUBLISHED VERSION CANNOT BE EDITED.
 *
 * Only the lifecycle columns may move: publishing stamps `published_at`, and
 * archiving stamps `archived_at`. The document, the variants and the version
 * number are frozen the moment the version is published, because a finalized
 * form points here and must still render the way it was signed.
 */
create or replace function public.forms_guard_published_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' then
    if new.document is distinct from old.document then
      raise exception 'A published template version is immutable: clone it to a draft and publish a new version.'
        using errcode = '23514';
    end if;
    if new.variants is distinct from old.variants then
      raise exception 'A published template version is immutable: its role variants cannot change.'
        using errcode = '23514';
    end if;
    if new.version is distinct from old.version then
      raise exception 'A published template version cannot be renumbered.'
        using errcode = '23514';
    end if;
    if new.status not in ('published', 'archived') then
      raise exception 'A published template version can only be archived, not returned to draft.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger form_template_versions_immutable
  before update on public.form_template_versions
  for each row execute function public.forms_guard_published_version();

/*
 * A FINALIZED FORM'S VALUES ARE FROZEN.
 *
 * Correcting a finalized form means creating a revision that points at it, not
 * quietly rewriting what somebody signed.
 */
create or replace function public.forms_guard_finalized_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  instance_status public.form_instance_status;
begin
  select status into instance_status
  from public.form_instances
  where id = coalesce(new.instance_id, old.instance_id);

  if instance_status in ('finalized', 'revised') then
    raise exception 'This form is finalized. Create a revision instead of editing its values.'
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger form_instance_values_frozen
  before insert or update or delete on public.form_instance_values
  for each row execute function public.forms_guard_finalized_values();

-- --------------------------------------------------------------- updated ---

create trigger form_templates_touch_updated_at
  before update on public.form_templates
  for each row execute function public.touch_updated_at();

create trigger form_template_versions_touch_updated_at
  before update on public.form_template_versions
  for each row execute function public.touch_updated_at();

create trigger form_instances_touch_updated_at
  before update on public.form_instances
  for each row execute function public.touch_updated_at();

create trigger form_instance_values_touch_updated_at
  before update on public.form_instance_values
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------- read ---

/*
 * WHAT FORM MONITORING READS. One row per form, already joined to its template
 * and its version, so the screen does not assemble HR records client-side.
 * `security_invoker` so row level security applies as the caller, not as the
 * view's owner — the same rule the reporting views follow.
 */
create view public.form_instance_overview
with (security_invoker = true) as
select
  i.id,
  i.template_id,
  t.key as template_key,
  t.name as template_name,
  t.short_name as template_short_name,
  t.layout_family,
  i.template_version_id,
  v.version as template_version,
  i.variant_key,
  i.employee_name,
  i.employee_role,
  i.location_id,
  i.location_name,
  i.created_by,
  i.created_by_role,
  i.source,
  i.status,
  i.form_date,
  i.follow_up_date,
  i.finalized_at,
  i.exported_at,
  i.revises_instance_id,
  i.created_at,
  i.updated_at
from public.form_instances i
join public.form_templates t on t.id = i.template_id
join public.form_template_versions v on v.id = i.template_version_id;

-- ------------------------------------------------------------- lock it up ---

/*
 * DENY BY DEFAULT, AND NO POLICIES AT ALL.
 *
 * Row level security is enabled and FORCED, and not one policy is created — so
 * every role except the secret key gets nothing, including the table owner.
 * `anon` and `authenticated` are revoked outright on top, because Supabase
 * grants them by default and a table with RLS on and no policy still reads
 * better as an explicit revoke.
 *
 * This is deliberate and it is the honest posture: the app has no identity
 * provider, so there is no way to write a policy that says "this manager may
 * read this employee's file". Server routes hold the secret key and apply the
 * permission matrix themselves. When real authentication lands, policies go
 * here — and that is the moment this comment should be deleted, not before.
 */
alter table public.form_templates          enable row level security;
alter table public.form_template_versions  enable row level security;
alter table public.form_template_current   enable row level security;
alter table public.form_template_assets    enable row level security;
alter table public.form_instances          enable row level security;
alter table public.form_instance_values    enable row level security;
alter table public.form_instance_events    enable row level security;

alter table public.form_templates          force row level security;
alter table public.form_template_versions  force row level security;
alter table public.form_template_current   force row level security;
alter table public.form_template_assets    force row level security;
alter table public.form_instances          force row level security;
alter table public.form_instance_values    force row level security;
alter table public.form_instance_events    force row level security;

revoke all on public.form_templates          from anon, authenticated;
revoke all on public.form_template_versions  from anon, authenticated;
revoke all on public.form_template_current   from anon, authenticated;
revoke all on public.form_template_assets    from anon, authenticated;
revoke all on public.form_instances          from anon, authenticated;
revoke all on public.form_instance_values    from anon, authenticated;
revoke all on public.form_instance_events    from anon, authenticated;
revoke all on public.form_instance_overview  from anon, authenticated;
