-- ============================================================================
-- ONE-TIME, APPROVED DATA CHANGE — NOT A MIGRATION. Run only with approval.
-- ============================================================================
--
-- KS Manhattan (salon 0462) is run by Rachael Dugan. The reporting workbook
-- still lists it under Patterson, Madeline, so the Reviews and Reports district
-- filters leave it out of Rachael's district.
--
-- Changes ONLY `salon_period_attributes.district_label`, from
-- 'Patterson, Madeline' to 'Dugan, Rachael', for salon 0462, on LIVE
-- (non-superseded) rows in periods ending on or after 2026-10-01 (the current
-- reporting month). Earlier periods are left as reported: the date Manhattan
-- moved is not recorded, and every earlier row says Patterson.
--
-- Does NOT touch the Woven crosswalk, any other salon, any account, scope or
-- permission. Region stays as reported.
--
-- SAFE TO RUN TWICE, and refuses (changing nothing) if salon 0462 is missing or
-- any in-scope row holds a value other than 'Patterson, Madeline' or
-- 'Dugan, Rachael'.
--
-- Future imports keep the correction via src/lib/reporting/district-overrides.ts.
--
-- Run as one transaction:  psql "$DB" -v ON_ERROR_STOP=1 -1 -f <this file>

do $$
declare
  v_salon  uuid;
  v_other  integer;
  v_rows   integer;
begin
  select id into v_salon from public.salons where salon_number = '0462' and store_name = 'KS Manhattan';
  if v_salon is null then
    raise exception 'salon 0462 KS Manhattan not found; nothing changed';
  end if;

  select count(*) into v_other
    from public.salon_period_attributes a
    join public.report_periods p on p.id = a.period_id
   where a.salon_id = v_salon
     and a.superseded_by_ingestion_id is null
     and p.period_end >= date '2026-10-01'
     and coalesce(a.district_label, '') not in ('Patterson, Madeline', 'Dugan, Rachael');
  if v_other > 0 then
    raise exception '% in-scope row(s) hold an unexpected district; nothing changed', v_other;
  end if;

  update public.salon_period_attributes a
     set district_label = 'Dugan, Rachael'
    from public.report_periods p
   where p.id = a.period_id
     and a.salon_id = v_salon
     and a.superseded_by_ingestion_id is null
     and p.period_end >= date '2026-10-01'
     and a.district_label = 'Patterson, Madeline';
  get diagnostics v_rows = row_count;
  raise notice 'salon 0462: % row(s) moved to Dugan, Rachael', v_rows;
end $$;
