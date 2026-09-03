-- ---------------------------------------------------------------------------
-- NOT EVERY REPORT FAMILY IS PERIOD-BASED.
--
-- `report_ingestions_succeeded_requires_period` was written when comp_sales was
-- the only family, and it encodes a true statement about that family: a
-- succeeded Comp Report ingestion must name the `report_periods` row its facts
-- belong to, or those facts are unattributable.
--
-- Sales Totals is not period-based, and forcing it to be would have caused real
-- damage. It is a DAILY snapshot carrying two windows at once (previous day and
-- month to date), so it maps to no single `report_periods` row. Satisfying the
-- old constraint would have meant one of two bad things:
--
--   * adding a 'daily' value to `report_period_grain`, which would put every
--     Sales Totals date into the Salon Performance period dropdown — a
--     regression in the other report;
--   * or filing a day's figures under an 'mtd' period, which is not what the
--     report says and would make the two families' periods collide.
--
-- Its date belongs on `sales_totals_snapshots.report_date`, which is where it
-- is.
--
-- So the requirement becomes explicit and OPT-OUT rather than universal.
-- `period_scoped` defaults to TRUE, which means:
--
--   * all 12 existing comp_sales ingestions keep the strict requirement,
--     unchanged and still enforced;
--   * any future family gets it by default and must declare itself period-less
--     deliberately — the safe direction, because the cost of forgetting is a
--     refused write rather than a fact nobody can attribute.
--
-- `finished_at` is still required on success for every family: a succeeded
-- ingestion with no completion time is incoherent whatever the family.
-- ---------------------------------------------------------------------------

alter table public.report_ingestions
  add column if not exists period_scoped boolean not null default true;

comment on column public.report_ingestions.period_scoped is
  'Whether this family attributes facts to a report_periods row. True for comp_sales. False for sales_totals, which is a daily snapshot keyed on sales_totals_snapshots.report_date and carries two windows at once. Defaults true so a new family must opt out deliberately.';

alter table public.report_ingestions
  drop constraint report_ingestions_succeeded_requires_period;

alter table public.report_ingestions
  add constraint report_ingestions_succeeded_requires_period
  check (
    status <> 'succeeded'
    or (
      finished_at is not null
      and (period_scoped = false or period_id is not null)
    )
  );

update public.report_ingestions
   set period_scoped = false
 where parser_key = 'sales_totals_daily';
