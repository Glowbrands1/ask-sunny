-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY FOR THE BED USAGE AND SPA REPORTING TABLES.
--
-- Same posture as the rest of the reporting domain, and the same two-step:
-- REVOKE FIRST, THEN GRANT. Supabase ships
-- `alter default privileges ... grant all on tables to anon, authenticated`,
-- so both browser-held roles hold INSERT / UPDATE / DELETE the moment a table
-- is created in `public`. A `grant select` is ADDITIVE and does not take them
-- away. This was found the expensive way in the knowledge migrations and is
-- pinned by a test.
--
-- VIEWS COUNT AS TABLES for those default privileges, which is the easy one to
-- forget — and these views join across every table in the domain, so securing
-- the tables and forgetting the views would leave the whole thing readable.
--
-- WHY THIS IS NOT THE AUTHORIZATION BOUNDARY FOR THE COMPANY SLICE. The
-- authorized-company narrowing happens in the PARSER, before anything is
-- written: no other company's salon reaches a fact table at all. That is a
-- stronger guarantee than a policy, because it holds even for a query written
-- later that forgets to filter. RLS here is the second gate, doing what it can
-- do — keeping the browser-held roles out entirely until an identity provider
-- exists. Narrowing by district still needs stable district codes the source
-- does not carry; the labels are manager names, which change.
-- ---------------------------------------------------------------------------

alter table public.bed_equipment_levels          enable row level security;
alter table public.spa_equipment_types           enable row level security;
alter table public.bed_usage_snapshots           enable row level security;
alter table public.bed_usage_salon_facts         enable row level security;
alter table public.bed_usage_equipment_facts     enable row level security;
alter table public.bed_usage_chain_benchmarks    enable row level security;
alter table public.spa_wellness_snapshots        enable row level security;
alter table public.spa_wellness_salon_facts      enable row level security;
alter table public.spa_wellness_equipment_facts  enable row level security;
alter table public.spa_equipment_benchmarks      enable row level security;
alter table public.spa_engagement_snapshots      enable row level security;
alter table public.spa_engagement_salon_facts    enable row level security;
alter table public.spa_engagement_manager_facts  enable row level security;
alter table public.spa_bed_inventory             enable row level security;
alter table public.spa_engagement_daily_facts    enable row level security;

-- Forced, so the policies apply to the table owner too and a later migration
-- running as owner cannot quietly read around them.
alter table public.bed_equipment_levels          force row level security;
alter table public.spa_equipment_types           force row level security;
alter table public.bed_usage_snapshots           force row level security;
alter table public.bed_usage_salon_facts         force row level security;
alter table public.bed_usage_equipment_facts     force row level security;
alter table public.bed_usage_chain_benchmarks    force row level security;
alter table public.spa_wellness_snapshots        force row level security;
alter table public.spa_wellness_salon_facts      force row level security;
alter table public.spa_wellness_equipment_facts  force row level security;
alter table public.spa_equipment_benchmarks      force row level security;
alter table public.spa_engagement_snapshots      force row level security;
alter table public.spa_engagement_salon_facts    force row level security;
alter table public.spa_engagement_manager_facts  force row level security;
alter table public.spa_bed_inventory             force row level security;
alter table public.spa_engagement_daily_facts    force row level security;

revoke all on public.bed_equipment_levels                    from anon, authenticated;
revoke all on public.spa_equipment_types                     from anon, authenticated;
revoke all on public.bed_usage_snapshots                     from anon, authenticated;
revoke all on public.bed_usage_salon_facts                   from anon, authenticated;
revoke all on public.bed_usage_equipment_facts               from anon, authenticated;
revoke all on public.bed_usage_chain_benchmarks              from anon, authenticated;
revoke all on public.spa_wellness_snapshots                  from anon, authenticated;
revoke all on public.spa_wellness_salon_facts                from anon, authenticated;
revoke all on public.spa_wellness_equipment_facts            from anon, authenticated;
revoke all on public.spa_equipment_benchmarks                from anon, authenticated;
revoke all on public.spa_engagement_snapshots                from anon, authenticated;
revoke all on public.spa_engagement_salon_facts              from anon, authenticated;
revoke all on public.spa_engagement_manager_facts            from anon, authenticated;
revoke all on public.spa_bed_inventory                       from anon, authenticated;
revoke all on public.spa_engagement_daily_facts              from anon, authenticated;

-- The views. Each one joins across the domain, so each is revoked explicitly.
revoke all on public.bed_usage_current_salon_facts           from anon, authenticated;
revoke all on public.bed_usage_current_equipment_facts       from anon, authenticated;
revoke all on public.spa_wellness_current_salon_facts        from anon, authenticated;
revoke all on public.spa_wellness_current_equipment_facts    from anon, authenticated;
revoke all on public.spa_engagement_current_salon_facts      from anon, authenticated;
revoke all on public.spa_conversion_current                  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- READ POLICIES.
--
-- One read-only SELECT policy per table for `authenticated`, and nothing else.
-- A grant without a policy still reads nothing under RLS, and a policy without
-- a grant is equally useless, so both are stated.
--
-- Writes stay the secret key's alone: `service_role` bypasses RLS by design and
-- is untouched here. No INSERT, UPDATE or DELETE policy exists for any role.
-- ---------------------------------------------------------------------------

create policy bed_equipment_levels_select_authenticated
  on public.bed_equipment_levels for select to authenticated using (true);
create policy spa_equipment_types_select_authenticated
  on public.spa_equipment_types for select to authenticated using (true);
create policy bed_usage_snapshots_select_authenticated
  on public.bed_usage_snapshots for select to authenticated using (true);
create policy bed_usage_salon_facts_select_authenticated
  on public.bed_usage_salon_facts for select to authenticated using (true);
create policy bed_usage_equipment_facts_select_authenticated
  on public.bed_usage_equipment_facts for select to authenticated using (true);
create policy bed_usage_chain_benchmarks_select_authenticated
  on public.bed_usage_chain_benchmarks for select to authenticated using (true);
create policy spa_wellness_snapshots_select_authenticated
  on public.spa_wellness_snapshots for select to authenticated using (true);
create policy spa_wellness_salon_facts_select_authenticated
  on public.spa_wellness_salon_facts for select to authenticated using (true);
create policy spa_wellness_equipment_facts_select_authenticated
  on public.spa_wellness_equipment_facts for select to authenticated using (true);
create policy spa_equipment_benchmarks_select_authenticated
  on public.spa_equipment_benchmarks for select to authenticated using (true);
create policy spa_engagement_snapshots_select_authenticated
  on public.spa_engagement_snapshots for select to authenticated using (true);
create policy spa_engagement_salon_facts_select_authenticated
  on public.spa_engagement_salon_facts for select to authenticated using (true);
create policy spa_engagement_manager_facts_select_authenticated
  on public.spa_engagement_manager_facts for select to authenticated using (true);
create policy spa_bed_inventory_select_authenticated
  on public.spa_bed_inventory for select to authenticated using (true);
create policy spa_engagement_daily_facts_select_authenticated
  on public.spa_engagement_daily_facts for select to authenticated using (true);

grant select on public.bed_equipment_levels                  to authenticated;
grant select on public.spa_equipment_types                   to authenticated;
grant select on public.bed_usage_snapshots                   to authenticated;
grant select on public.bed_usage_salon_facts                 to authenticated;
grant select on public.bed_usage_equipment_facts             to authenticated;
grant select on public.bed_usage_chain_benchmarks            to authenticated;
grant select on public.spa_wellness_snapshots                to authenticated;
grant select on public.spa_wellness_salon_facts              to authenticated;
grant select on public.spa_wellness_equipment_facts          to authenticated;
grant select on public.spa_equipment_benchmarks              to authenticated;
grant select on public.spa_engagement_snapshots              to authenticated;
grant select on public.spa_engagement_salon_facts            to authenticated;
grant select on public.spa_engagement_manager_facts          to authenticated;
grant select on public.spa_bed_inventory                     to authenticated;
grant select on public.spa_engagement_daily_facts            to authenticated;

grant select on public.bed_usage_current_salon_facts         to authenticated;
grant select on public.bed_usage_current_equipment_facts     to authenticated;
grant select on public.spa_wellness_current_salon_facts      to authenticated;
grant select on public.spa_wellness_current_equipment_facts  to authenticated;
grant select on public.spa_engagement_current_salon_facts    to authenticated;
grant select on public.spa_conversion_current                to authenticated;
