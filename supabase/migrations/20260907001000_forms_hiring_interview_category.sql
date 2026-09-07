-- ============================================================================
-- HIRING & INTERVIEW FORMS — the category, the layout family, and the marker
-- that lets a re-issued source document become a new version.
--
-- ADDITIVE AND, WITH ONE STATED EXCEPTION, REVERSIBLE. Nothing here drops,
-- renames or rewrites anything. Two columns are added with defaults that
-- describe the rows already in the table, so every existing template and every
-- existing version keeps meaning exactly what it meant before this ran, and
-- both columns can be dropped again.
--
-- THE EXCEPTION IS THE ENUM. Postgres can add a value to an enum type and
-- cannot remove one. `interview` is therefore a one-way change to
-- `form_layout_family`. Rolling this migration back means dropping the two
-- columns and leaving the unused enum value in place — it is inert unless a row
-- uses it, and after a rollback none would.
--
-- WHAT DEPENDS ON IT. The four Hiring & Interview templates are seeded with
-- `layout_family = 'interview'`, so `ensureTemplateLibrary` cannot install them
-- until this has run. The existing nine are unaffected either way.
-- ============================================================================

-- ------------------------------------------------------- the layout family ---

-- A fifth layout, for a form filled in the room while a candidate answers: no
-- Employee Information, no acknowledgement, no employee signature, and a long
-- run of question-and-notes pairs the other four layouts have nothing like.
alter type public.form_layout_family add value if not exists 'interview';

-- ------------------------------------------------------------ the category ---

/*
 * WHICH SECTION OF THE FORMS PAGE A TEMPLATE RENDERS UNDER.
 *
 * Plain text, not an enum, and deliberately so: a category is a grouping the
 * app ships and the value is checked against `FORM_CATEGORIES` in
 * src/lib/forms/catalog.ts on the way out. Adding a category should be a code
 * change, not a schema change — an enum here would mean a migration every time
 * the business wanted a new heading.
 *
 * The default names the group the nine existing forms were already in, so this
 * column arrives correct for every row that predates it.
 */
alter table public.form_templates
  add column if not exists category text not null default 'hr_performance';

comment on column public.form_templates.category is
  'Which section of the Forms page this template renders under. Checked against FORM_CATEGORIES in src/lib/forms/catalog.ts; hr_performance is the group the original nine forms are in.';

create index if not exists form_templates_by_category
  on public.form_templates (category, display_order);

-- --------------------------------------------------- the source revision ---

/*
 * WHICH READING OF THE PAPER FORM A VERSION WAS PUBLISHED FROM.
 *
 * The problem this solves: seeding skips a template whose key already exists,
 * which is right — it is what stops the code overwriting an administrator's
 * published edits. But it also meant that when the business re-issued a form,
 * the new document could never reach a database that already had the old one.
 * The Coaching Form was re-issued; without this column its first version would
 * stay published forever.
 *
 * So a seeded version records its seed's revision, and `ensureTemplateLibrary`
 * publishes a NEW version when the code's revision is higher than anything in
 * the table. The old version is archived, never edited and never deleted, so
 * forms already filled from it still render against it.
 *
 * 0 MEANS A PERSON WROTE IT. `openDraft` stores 0, so any version authored
 * through the editor is marked as such and the seeder stands down for that
 * template rather than publishing over somebody's work.
 *
 * The default of 1 is correct for every existing row: they are all version 1 as
 * originally seeded.
 */
alter table public.form_template_versions
  add column if not exists seed_revision integer not null default 1;

comment on column public.form_template_versions.seed_revision is
  'The revision of the source document this version was published from; 0 when a person authored it in the editor. Read only by ensureTemplateLibrary, which will not publish a seed revision over a version marked 0.';

alter table public.form_template_versions
  drop constraint if exists form_template_versions_seed_revision_not_negative;
alter table public.form_template_versions
  add constraint form_template_versions_seed_revision_not_negative
  check (seed_revision >= 0);
