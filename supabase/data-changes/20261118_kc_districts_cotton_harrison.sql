-- ============================================================================
-- ONE-TIME, APPROVED DATA CHANGE — NOT A MIGRATION. Run only with approval.
-- ============================================================================
--
-- Approved by the owner, 18 Nov 2026 (the DM L10 run-through, 17 Nov 2026):
--   MO Kansas City Liberty (0394) and MO Kansas City Wornall (0306) belong to
--   'Cotton, Sarah'; KS Lawrence (0468), KS Overland Park (0476) and KS Shawnee
--   Mission Pkwy (0463) belong to 'Harrison, Shelley'. The reporting workbook
--   still lists all five under Patterson, Madeline.
--
-- Changes ONLY `salon_period_attributes.district_label`, from
-- 'Patterson, Madeline' to the district above, for these five salons, on LIVE
-- (non-superseded) rows in periods ending on or after 2026-11-01 (the current
-- reporting month). Earlier periods are left as reported. Same shape as
-- 20261015_manhattan_district_dugan.sql.
--
-- Does NOT touch the Woven crosswalk, any other salon, any account, scope or
-- permission. Region stays as reported. NOTE: an account scoped to the district
-- 'dist-patterson-madeline' resolves to no salons once its salons are moved; an
-- account scoped to 'dist-cotton-sarah' gains Liberty and Wornall.
--
-- SAFE TO RUN TWICE, and refuses (changing nothing) if a salon is missing or
-- any in-scope row holds a value other than 'Patterson, Madeline' or its new
-- district.
--
-- Future imports keep the correction via src/lib/reporting/district-overrides.ts.
--
-- Run as one transaction:  psql "$DB" -v ON_ERROR_STOP=1 -1 -f <this file>

do $$
declare
  v_move   record;
  v_salon  uuid;
  v_other  integer;
  v_rows   integer;
begin
  for v_move in
    select * from (values
      ('0394', 'MO Kansas City Liberty',  'Cotton, Sarah'),
      ('0306', 'MO Kansas City Wornall',  'Cotton, Sarah'),
      ('0468', 'KS Lawrence',             'Harrison, Shelley'),
      ('0476', 'KS Overland Park',        'Harrison, Shelley'),
      ('0463', 'KS Shawnee Mission Pkwy', 'Harrison, Shelley')
    ) as m(salon_number, store_name, district)
  loop
    select id into v_salon from public.salons where salon_number = v_move.salon_number and store_name = v_move.store_name;
    if v_salon is null then
      raise exception 'salon % % not found; nothing changed', v_move.salon_number, v_move.store_name;
    end if;

    select count(*) into v_other
      from public.salon_period_attributes a
      join public.report_periods p on p.id = a.period_id
     where a.salon_id = v_salon
       and a.superseded_by_ingestion_id is null
       and p.period_end >= date '2026-11-01'
       and coalesce(a.district_label, '') not in ('Patterson, Madeline', v_move.district);
    if v_other > 0 then
      raise exception 'salon %: % in-scope row(s) hold an unexpected district; nothing changed', v_move.salon_number, v_other;
    end if;

    update public.salon_period_attributes a
       set district_label = v_move.district
      from public.report_periods p
     where p.id = a.period_id
       and a.salon_id = v_salon
       and a.superseded_by_ingestion_id is null
       and p.period_end >= date '2026-11-01'
       and a.district_label = 'Patterson, Madeline';
    get diagnostics v_rows = row_count;
    raise notice 'salon %: % row(s) moved to %', v_move.salon_number, v_rows, v_move.district;
  end loop;
end $$;
