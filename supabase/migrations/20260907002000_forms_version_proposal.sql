-- ============================================================================
-- WHERE A DRAFT RECORDS THE DOCUMENT IT WAS EXTRACTED FROM.
--
-- An administrator can now upload the business's own PDF or Word file and have
-- Ask Sunny read it into a PROPOSED form. The proposal is not a new kind of
-- record: it is an ordinary DRAFT VERSION, so it inherits everything the engine
-- already guarantees — a published version cannot be edited, publishing
-- archives the one it replaces, and forms already filled keep rendering against
-- the version they were signed on. This column is the only thing that was
-- missing: which upload a draft came from, and what the extractor was unsure
-- about.
--
-- ADDITIVE AND REVERSIBLE. One nullable-by-default jsonb column. Every existing
-- row means exactly what it meant before — a draft with no proposal is a draft
-- somebody typed, which is what all of them are today — and the column drops
-- cleanly with no data loss anywhere else.
--
-- IT IS NOT A PUBLICATION SWITCH. Nothing about this column makes a version
-- current. The draft becomes the active form through the same publish path a
-- hand-edited draft uses, which is a person's decision and a person's click.
-- ============================================================================

alter table public.form_template_versions
  add column if not exists proposal jsonb not null default '{}'::jsonb;

comment on column public.form_template_versions.proposal is
  'For a draft extracted from an uploaded PDF or Word document: which asset it came from, the extractor''s warnings, the lines it could not place, and how its fields aligned to the published version. Empty for a draft a person authored. Never read when deciding which version is current.';

-- Finding the draft proposed from a given upload, without scanning versions.
create index if not exists form_template_versions_by_proposal_asset
  on public.form_template_versions ((proposal ->> 'assetId'))
  where proposal ? 'assetId';
