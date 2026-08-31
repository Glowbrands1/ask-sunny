-- Ask Sunny — row level security for the reporting domain.
--
-- Same defensive posture as the knowledge tables, INCLUDING the two defects
-- that only showed up when those migrations were applied to a live project:
--
--   1. Supabase ships `alter default privileges ... grant all on tables to
--      anon, authenticated`, so BOTH roles hold INSERT/UPDATE/DELETE the moment
--      a table is created in `public`. A later `grant select` is additive and
--      does not take those away. Every table below is therefore REVOKED from
--      first and granted afterwards.
--
--   2. Views are "tables" for the purposes of those default privileges, so
--      comp_sales_current_facts needs the same treatment as a real table. It is
--      easy to secure five tables and forget the view that reads all of them.
--
-- Enabled AND FORCED on every table: forcing means the policies apply to the
-- table owner too, so a future migration running as the owner cannot quietly
-- read around them. Only the secret key — which holds `service_role` and
-- bypasses RLS by design — writes here, and only from server-side route
-- handlers.

alter table public.report_sources           enable row level security;
alter table public.report_files             enable row level security;
alter table public.report_periods           enable row level security;
alter table public.report_ingestions        enable row level security;
alter table public.report_metrics           enable row level security;
alter table public.salons                   enable row level security;
alter table public.salon_period_attributes  enable row level security;
alter table public.comp_sales_facts         enable row level security;

alter table public.report_sources           force row level security;
alter table public.report_files             force row level security;
alter table public.report_periods           force row level security;
alter table public.report_ingestions        force row level security;
alter table public.report_metrics           force row level security;
alter table public.salons                   force row level security;
alter table public.salon_period_attributes  force row level security;
alter table public.comp_sales_facts         force row level security;

-- Strip every privilege the browser-held roles inherited at creation time.
revoke all on public.report_sources           from anon, authenticated;
revoke all on public.report_files             from anon, authenticated;
revoke all on public.report_periods           from anon, authenticated;
revoke all on public.report_ingestions        from anon, authenticated;
revoke all on public.report_metrics           from anon, authenticated;
revoke all on public.salons                   from anon, authenticated;
revoke all on public.salon_period_attributes  from anon, authenticated;
revoke all on public.comp_sales_facts         from anon, authenticated;
revoke all on public.comp_sales_current_facts from anon, authenticated;

-- Grant back only what the threat model intends: read-only access for signed-in
-- employees, once authentication ships. `anon` receives nothing at all.
grant select on public.report_sources           to authenticated;
grant select on public.report_files             to authenticated;
grant select on public.report_periods           to authenticated;
grant select on public.report_ingestions        to authenticated;
grant select on public.report_metrics           to authenticated;
grant select on public.salons                   to authenticated;
grant select on public.salon_period_attributes  to authenticated;
grant select on public.comp_sales_facts         to authenticated;
grant select on public.comp_sales_current_facts to authenticated;

-- Policies. A grant without a policy still reads nothing under RLS; both are
-- required, and both are stated explicitly rather than relying on either alone.
--
-- SCOPE, STATED HONESTLY: these permit any authenticated user to read every
-- salon. That matches the knowledge tables today and is safe only because no
-- identity provider is configured yet, so nobody holds `authenticated`. When
-- authentication ships these MUST be narrowed — the join that does it already
-- exists, because salon_period_attributes records the district and region a
-- salon reported under for each period. Until then the data is reachable only
-- through the secret key, server-side.

create policy report_sources_select_authenticated
  on public.report_sources for select to authenticated using (true);

create policy report_files_select_authenticated
  on public.report_files for select to authenticated using (true);

create policy report_periods_select_authenticated
  on public.report_periods for select to authenticated using (true);

create policy report_ingestions_select_authenticated
  on public.report_ingestions for select to authenticated using (true);

create policy report_metrics_select_authenticated
  on public.report_metrics for select to authenticated using (true);

create policy salons_select_authenticated
  on public.salons for select to authenticated using (true);

create policy salon_period_attributes_select_authenticated
  on public.salon_period_attributes for select to authenticated using (true);

create policy comp_sales_facts_select_authenticated
  on public.comp_sales_facts for select to authenticated using (true);

-- No insert, update or delete policy exists for any role. Writes happen only
-- under `service_role`, which bypasses row level security, and only from route
-- handlers holding SUPABASE_SECRET_KEY. `service_role` is untouched here by
-- design.
