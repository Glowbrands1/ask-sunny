-- ---------------------------------------------------------------------------
-- REPORTING TABLES BECOME SERVER-ONLY.
--
-- FOUND BY AUDIT, NOT BY THE LINTER. Every reporting table carried
-- `grant select ... to authenticated` plus a policy of `using (true)`. Supabase
-- reports that as healthy — row level security IS enabled and a policy DOES
-- exist — so no advisor warning was ever raised. The policy just happened to
-- permit everything.
--
-- ===========================================================================
-- WHAT THAT ACTUALLY ALLOWED
-- ===========================================================================
--
-- Ask Sunny enforces salon scope in server code. The browser holds a real
-- session and the publishable key ships in every bundle, so a signed-in person
-- could skip the application entirely and read PostgREST directly:
--
--   GET /rest/v1/comp_sales_facts?select=*
--
-- Assuming the `authenticated` role, that returned 13824 rows of company sales
-- covering every salon. A leader restricted to salon 0306 could read 0307 and
-- all the rest by asking the database instead of the app. The scope check was
-- never wrong; it was simply not the only door.
--
-- ===========================================================================
-- WHY REMOVING THE ACCESS IS THE FIX, NOT REWRITING THE POLICIES
-- ===========================================================================
--
-- NOTHING IN THE BROWSER READS THESE RELATIONS. Every reporting read goes
-- through `getSupabaseAdmin()` under the secret key, in a module carrying
-- `import "server-only"`, which makes importing it from a client component a
-- BUILD failure. The `authenticated` grants were never used by any code path --
-- they were reachable, and nothing more.
--
-- So the salon rule is NOT duplicated into 27 row level policies. Two copies of
-- an authorization rule drift, and the copy in SQL is the one nobody reads when
-- the roster changes. The browser is taken off the list instead: no grant, no
-- policy, no second door to keep in step with the first.
--
-- `service_role` holds BYPASSRLS, so every server read is unaffected by both
-- the revokes and the dropped policies. That was verified on this database
-- before this migration was written, not assumed.
--
-- ===========================================================================
-- DELIBERATELY NOT TOUCHED
-- ===========================================================================
--
--   public.app_users   `getAppUser` reads it through the SESSION client on
--                      purpose, so `app_users_select_own` (`id = auth.uid()`)
--                      backs up the `.eq("id", ...)` rather than trusting it.
--                      This is a real browser dependency and sign-in breaks
--                      without it. Its policy is identity-scoped, not
--                      `using (true)`, so it is not this class of bug.
--
--   Auth and invitation paths are untouched, as are the activity, feedback and
--   form tables, which already deny every browser role.
--
-- RLS STAYS ENABLED AND FORCED on all 27 tables. Dropping a permissive policy
-- while RLS remains on leaves deny-all, which is the posture the activity and
-- feedback tables already use. Nothing here disables anything.
--
-- ADDITIVE AND DEPLOY-SAFE IN EITHER ORDER: the running application already
-- reads under the secret key, so this can be applied before or after any
-- deployment without a broken window.
-- ---------------------------------------------------------------------------

-- ------------------------------------------- 27 tables: the browser grant ---

revoke all on public.bed_equipment_levels         from anon, authenticated;
revoke all on public.bed_usage_chain_benchmarks   from anon, authenticated;
revoke all on public.bed_usage_equipment_facts    from anon, authenticated;
revoke all on public.bed_usage_salon_facts        from anon, authenticated;
revoke all on public.bed_usage_snapshots          from anon, authenticated;
revoke all on public.comp_sales_facts             from anon, authenticated;
revoke all on public.report_files                 from anon, authenticated;
revoke all on public.report_ingestions            from anon, authenticated;
revoke all on public.report_metrics               from anon, authenticated;
revoke all on public.report_periods               from anon, authenticated;
revoke all on public.report_sources               from anon, authenticated;
revoke all on public.sales_totals_facts           from anon, authenticated;
revoke all on public.sales_totals_metrics         from anon, authenticated;
revoke all on public.sales_totals_scopes          from anon, authenticated;
revoke all on public.sales_totals_snapshots       from anon, authenticated;
revoke all on public.salon_period_attributes      from anon, authenticated;
revoke all on public.salons                       from anon, authenticated;
revoke all on public.spa_bed_inventory            from anon, authenticated;
revoke all on public.spa_engagement_daily_facts   from anon, authenticated;
revoke all on public.spa_engagement_manager_facts from anon, authenticated;
revoke all on public.spa_engagement_salon_facts   from anon, authenticated;
revoke all on public.spa_engagement_snapshots     from anon, authenticated;
revoke all on public.spa_equipment_benchmarks     from anon, authenticated;
revoke all on public.spa_equipment_types          from anon, authenticated;
revoke all on public.spa_wellness_equipment_facts from anon, authenticated;
revoke all on public.spa_wellness_salon_facts     from anon, authenticated;
revoke all on public.spa_wellness_snapshots       from anon, authenticated;

-- --------------------------------- 12 views: the same grant, same problem ---
--
-- A view is a table to the default privileges, and these join the facts back
-- together. Securing 27 tables and leaving the views that read them would move
-- the door rather than close it. They are `security_invoker`, so the revokes
-- above already deny them -- this says so at the privilege layer too, which is
-- the posture the rest of the schema carries.

revoke all on public.bed_usage_current_equipment_facts    from anon, authenticated;
revoke all on public.bed_usage_current_salon_facts        from anon, authenticated;
revoke all on public.comp_sales_current_facts             from anon, authenticated;
revoke all on public.comp_sales_filter_options            from anon, authenticated;
revoke all on public.comp_sales_metric_catalogue          from anon, authenticated;
revoke all on public.comp_sales_report_scope              from anon, authenticated;
revoke all on public.comp_sales_source_views              from anon, authenticated;
revoke all on public.sales_totals_current_facts           from anon, authenticated;
revoke all on public.spa_conversion_current               from anon, authenticated;
revoke all on public.spa_engagement_current_salon_facts   from anon, authenticated;
revoke all on public.spa_wellness_current_equipment_facts from anon, authenticated;
revoke all on public.spa_wellness_current_salon_facts     from anon, authenticated;

-- ------------------------------------ the permissive policies themselves ---
--
-- The revoke alone would already deny these roles. The policies still go,
-- because a `using (true)` left lying beside a revoked grant is a loaded
-- spring: one `grant select` typed by someone later -- or a Supabase default
-- privilege applied to a rebuilt table -- and the table is wide open again with
-- nothing in the diff to suggest it. Deny-all should require adding a policy to
-- undo, not merely a grant.
--
-- `if exists` so re-running this on a database that has already had it is a
-- no-op rather than an abort.

drop policy if exists bed_equipment_levels_select_authenticated         on public.bed_equipment_levels;
drop policy if exists bed_usage_chain_benchmarks_select_authenticated   on public.bed_usage_chain_benchmarks;
drop policy if exists bed_usage_equipment_facts_select_authenticated    on public.bed_usage_equipment_facts;
drop policy if exists bed_usage_salon_facts_select_authenticated        on public.bed_usage_salon_facts;
drop policy if exists bed_usage_snapshots_select_authenticated          on public.bed_usage_snapshots;
drop policy if exists comp_sales_facts_select_authenticated             on public.comp_sales_facts;
drop policy if exists report_files_select_authenticated                 on public.report_files;
drop policy if exists report_ingestions_select_authenticated            on public.report_ingestions;
drop policy if exists report_metrics_select_authenticated               on public.report_metrics;
drop policy if exists report_periods_select_authenticated               on public.report_periods;
drop policy if exists report_sources_select_authenticated               on public.report_sources;
drop policy if exists sales_totals_facts_select_authenticated           on public.sales_totals_facts;
drop policy if exists sales_totals_metrics_select_authenticated         on public.sales_totals_metrics;
drop policy if exists sales_totals_scopes_select_authenticated          on public.sales_totals_scopes;
drop policy if exists sales_totals_snapshots_select_authenticated       on public.sales_totals_snapshots;
drop policy if exists salon_period_attributes_select_authenticated      on public.salon_period_attributes;
drop policy if exists salons_select_authenticated                       on public.salons;
drop policy if exists spa_bed_inventory_select_authenticated            on public.spa_bed_inventory;
drop policy if exists spa_engagement_daily_facts_select_authenticated   on public.spa_engagement_daily_facts;
drop policy if exists spa_engagement_manager_facts_select_authenticated on public.spa_engagement_manager_facts;
drop policy if exists spa_engagement_salon_facts_select_authenticated   on public.spa_engagement_salon_facts;
drop policy if exists spa_engagement_snapshots_select_authenticated     on public.spa_engagement_snapshots;
drop policy if exists spa_equipment_benchmarks_select_authenticated     on public.spa_equipment_benchmarks;
drop policy if exists spa_equipment_types_select_authenticated          on public.spa_equipment_types;
drop policy if exists spa_wellness_equipment_facts_select_authenticated on public.spa_wellness_equipment_facts;
drop policy if exists spa_wellness_salon_facts_select_authenticated     on public.spa_wellness_salon_facts;
drop policy if exists spa_wellness_snapshots_select_authenticated       on public.spa_wellness_snapshots;
