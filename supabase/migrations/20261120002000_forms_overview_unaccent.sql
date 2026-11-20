-- QA's f072 (20 Nov 2026): a forms-on-file question typed without accents ("lucia ramirez") never found a form stored
-- with them ("Lucía Ramírez"), because PostgREST's ilike compares the letters as stored. The overview gains one column,
-- employee_name_folded = lower(unaccent(employee_name)), which `listInstances` matches beside employee_name (the typed
-- words are folded the same way in code, `foldName`). Until this is applied, `listInstances` reads by the stored name
-- only, as before.
--
-- Not applied by the pull request: QA applies it after merge.

create extension if not exists unaccent with schema extensions;

-- `create or replace` may add a column only at the end; every existing column keeps its name, type and order, as
-- 20260904004000_forms_follow_up_tracking.sql defined them (production's definition, read 20 Nov 2026, is the same).
create or replace view public.form_instance_overview
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
  i.followed_up_at,
  i.followed_up_by,
  i.finalized_at,
  i.exported_at,
  i.archived_at,
  i.revises_instance_id,
  i.created_at,
  i.updated_at,
  lower(extensions.unaccent(i.employee_name)) as employee_name_folded
from public.form_instances i
join public.form_templates t on t.id = i.template_id
join public.form_template_versions v on v.id = i.template_version_id;

-- Restated, as every redefinition of this view does: deny by default on top of a security_invoker view.
revoke all on public.form_instance_overview from anon, authenticated;
