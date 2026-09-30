// Verifies supabase/migrations/20260928002000_woven_employee_directory.sql, then
// 20260930000100_woven_employee_role_overrides.sql on top of it, against
// a real Postgres engine (PGlite), with minimal stubs for the Supabase objects it
// depends on. Nothing here touches a real database.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/verify-woven-migration.mjs
//
// PGlite is deliberately not a declared dependency: this is a pre-apply check
// a reviewer runs on demand, not part of the build.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIGRATION = new URL("../supabase/migrations/20260928002000_woven_employee_directory.sql", import.meta.url);
const OVERRIDES_MIGRATION = new URL("../supabase/migrations/20260930000100_woven_employee_role_overrides.sql", import.meta.url);
/* A protected admin whose app_users.email is its own id, as two live accounts' are: only the override can find it. */
const PROTECTED_ADMIN = "11111111-1111-4111-8111-111111111111";
const db = new PGlite();
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const q = async (sql, params) => (await db.query(sql, params)).rows;
const raises = async (fn) => { try { await fn(); return false; } catch { return true; } };

// ---- Supabase stand-ins ----
await db.exec(`
  create role anon; create role authenticated;
  create schema extensions;
  create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
  -- Supabase grants new objects to anon/authenticated by default; the migration must undo that.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
    begin new.updated_at := now(); return new; end; $$;
  create table public.salons (id uuid primary key default gen_random_uuid(), salon_number text unique not null, store_name text not null);
  insert into public.salons (salon_number, store_name) values ('0306', 'KS Manhattan'), ('0144', 'NE Lincoln');
  create type public.app_user_role as enum ('employee','assistant_salon_director','salon_director','district_manager','admin');
  create type public.app_user_status as enum ('invited','active','disabled');
  create type public.app_scope_level as enum ('global','region','district','salon');
  create table public.app_users (
    id uuid primary key default gen_random_uuid(), email text not null,
    role public.app_user_role not null, status public.app_user_status not null,
    scope_level public.app_scope_level not null default 'salon', scope_primary_area_id text,
    scope_also_covers_area_ids text[] not null default '{}'
  );
  insert into public.app_users (email, role, status, scope_level, scope_primary_area_id) values
    ('Sam.Smith@SunTanCity.test', 'assistant_salon_director', 'active', 'salon', 'loc-0144'),
    ('gone@suntancity.test', 'employee', 'active', 'salon', 'loc-0306');
  insert into public.app_users (id, email, role, status, scope_level) values
    ('${PROTECTED_ADMIN}', '${PROTECTED_ADMIN}', 'admin', 'active', 'global');
`);
const appUsersBefore = JSON.stringify(await q("select * from public.app_users order by id"));

// ---- apply the migration in ONE transaction, verbatim ----
const sql = readFileSync(MIGRATION, "utf8");
await db.exec(`begin;\n${sql}\ncommit;`);
ok(true, "migration applies in one transaction");
// ...and is re-runnable (every create is guarded)
await db.exec(`begin;\n${sql}\ncommit;`);
ok(true, "migration re-applies cleanly (idempotent DDL)");

// ---- privileges ----
const TABLES = ["employee_sync_runs", "employee_access_directory", "employee_location_affiliations", "employee_directory_changes", "woven_location_map", "woven_position_map"];
const VIEWS = ["employee_sync_status", "employee_sync_run_summary", "employee_directory_view", "employee_directory_login_matches", "employee_access_preview"];
for (const table of [...TABLES, ...VIEWS]) {
  for (const role of ["anon", "authenticated"]) {
    const r = await one(`select has_table_privilege($1, 'public.${table}', 'select') as s, has_table_privilege($1, 'public.${table}', 'insert') as i`, [role]);
    ok(!r.s && !r.i, `${role} has no select/insert on ${table}`);
  }
}
for (const fn of [
  "employee_sync_claim_run(text)",
  "employee_sync_commit_run(uuid, jsonb, jsonb, jsonb, jsonb)",
  "employee_sync_abandon_run(uuid, public.employee_sync_run_status, text, text, jsonb)",
  "woven_location_map_review(text, public.woven_location_map_status, text, text)",
  "woven_position_map_review(text, public.woven_position_map_status, public.app_user_role, public.app_scope_level, smallint, text)",
  "employee_directory_changes_guard()",
]) {
  for (const role of ["public", "anon", "authenticated"]) {
    const r = role === "public"
      ? await one(`select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.${fn}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as x`)
      : await one(`select has_function_privilege($1, 'public.${fn}', 'execute') as x`, [role]);
    ok(!r.x, `${role} cannot execute ${fn}`);
  }
}
const rls = await q(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1)`, [TABLES]);
ok(rls.length === 6 && rls.every((r) => r.relrowsecurity && r.relforcerowsecurity), "RLS enabled and forced on all six tables");
const policies = await one(`select count(*)::int as n from pg_policies where tablename = any($1)`, [TABLES]);
ok(policies.n === 0, "no RLS policy exists on any Woven table");

// ---- change vocabulary ----
const kinds = (await q(`select unnest(enum_range(null::public.employee_directory_change_kind))::text as k`)).map((r) => r.k);
ok(
  JSON.stringify(kinds) === JSON.stringify(["new_employee", "terminated", "reactivated", "position_changed", "primary_location_changed", "location_access_added", "location_access_removed", "email_changed", "missing_from_source"]),
  `change kinds are the normalised names ${kinds.join(",")}`,
);
const access = (await q(`select unnest(enum_range(null::public.employee_location_access_type))::text as k`)).map((r) => r.k);
ok(access.join(",") === "primary,additional,temporary_or_expiring_access", "access types never assert 'borrowed'");

// ---- helpers ----
const hash = (c) => c.repeat(64);
const aff = (id, access_type, over = {}) => ({ woven_location_id: id, location_name: id, location_number: null, access_type, expires_on: null, ...over });
const emp = (id, over = {}) => ({
  external_employee_id: id, employee_login_id: "L-" + id, external_hris_id: "H" + id,
  first_name: "F" + id, last_name: "L" + id, preferred_first_name: null,
  email_address: `e${id}@suntancity.test`, employment_status: "active", employment_status_code: 1,
  hire_date: "2024-01-15", start_date: "2024-01-20", termination_date: null, termination_last_day_worked: null, termination_type_code: null,
  position_id: "P1", position_name: "Consultant", primary_woven_location_id: "LOC-A", primary_location_name: "A",
  has_multiple_location_access: true, has_all_location_access: false, woven_login_allowed: true,
  affiliations: [aff("LOC-A", "primary"), aff("LOC-B", "temporary_or_expiring_access", { expires_on: "2026-12-31" })],
  data_issues: [], record_hash: hash("a"), ...over,
});
const LOCS = [
  { woven_location_id: "LOC-A", woven_location_name: "A", woven_location_number: "0306", woven_district_name: "North" },
  { woven_location_id: "LOC-B", woven_location_name: "B", woven_location_number: "144" },
];
const claim = async (by = "cron") => (await one(`select public.employee_sync_claim_run($1) as r`, [by])).r;
const commit = async (runId, employees, changes, locations = LOCS, stats = { requests_made: 5, issue_counts: { x: 1 } }) =>
  (await one(`select public.employee_sync_commit_run($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb) as r`,
    [runId, JSON.stringify(employees), JSON.stringify(changes), JSON.stringify(locations), JSON.stringify(stats)])).r;
const affOf = async (id) => q(
  `select a.woven_location_id as loc, a.access_type, a.is_primary, a.active, a.expires_on::text as expires_on
     from public.employee_location_affiliations a join public.employee_access_directory d on d.id = a.employee_id
    where d.external_employee_id = $1 order by a.woven_location_id`, [id]);

// ---- run 1: lock + initial load ----
const c1 = await claim();
ok(c1.status === "claimed" && c1.runId, "first claim succeeds");
ok((await claim()).status === "busy", "second concurrent claim is refused (one live run)");
ok((await one(`select source_mode from public.employee_sync_runs where id=$1`, [c1.runId])).source_mode === "scheduled_poll", "a cron claim is recorded as scheduled_poll");

const r1 = await commit(c1.runId, [emp("100"), emp("200", { email_address: "Mixed.Case@SunTanCity.test" })], [
  { external_employee_id: "100", change_kind: "new_employee", classification: "initial_load", effective_date: "2024-01-15", from_value: null, to_value: { a: 1 }, details: {} },
  { external_employee_id: "200", change_kind: "new_employee", classification: "initial_load", effective_date: "2024-01-15", from_value: null, to_value: { a: 1 }, details: {} },
]);
ok(r1.status === "committed" && r1.created === 2 && r1.updated === 0 && r1.missing === 0 && r1.changes === 2, `run 1 commit counts ${JSON.stringify(r1)}`);
const row100 = await one(`select woven_location_ids, affiliations_verified_at, employee_login_id, external_hris_id, start_date::text as sd, employment_status_code, has_multiple_location_access, woven_login_allowed from public.employee_access_directory where external_employee_id='100'`);
ok(row100.woven_location_ids.join(",") === "LOC-A,LOC-B" && row100.affiliations_verified_at !== null, "filter array derived from the affiliation table, verified_at set");
ok(row100.employee_login_id === "L-100" && row100.external_hris_id === "H100" && row100.sd === "2024-01-20" && row100.employment_status_code === 1 && row100.has_multiple_location_access && row100.woven_login_allowed, "new allowlisted columns stored");
const a100 = await affOf("100");
ok(a100.length === 2 && a100[0].is_primary && a100[1].access_type === "temporary_or_expiring_access" && a100[1].expires_on === "2026-12-31", "affiliation rows: one primary, one expiring with its date");
ok((await one(`select email_address from public.employee_access_directory where external_employee_id='200'`)).email_address === "Mixed.Case@SunTanCity.test", "EmailAddress stored as Woven provides it");
const run1 = await one(`select status, finished_at, requests_made, issue_counts, employees_created, unmapped_positions from public.employee_sync_runs where id=$1`, [c1.runId]);
ok(run1.status === "succeeded" && run1.finished_at && run1.requests_made === 5 && run1.issue_counts.x === 1 && run1.employees_created === 2 && run1.unmapped_positions === 1, "run 1 closed with stats");
ok((await commit(c1.runId, [emp("300")], [])).status === "not_running", "a closed run cannot be committed twice");

// ---- location catalog and suggestions ----
const la = await one(`select m.status, s.salon_number as suggested, m.woven_district_name from public.woven_location_map m left join public.salons s on s.id = m.suggested_salon_id where woven_location_id='LOC-A'`);
ok(la.status === "unmapped" && la.suggested === "0306" && la.woven_district_name === "North", "exact Number match is SUGGESTED, status stays unmapped");
ok((await one(`select suggested_salon_id from public.woven_location_map where woven_location_id='LOC-B'`)).suggested_salon_id === null, "'144' is not suggested for salon '0144' (no numeric coercion)");

// ---- position queue and review ----
const p1 = await one(`select status, woven_position_name, is_confirmed from public.woven_position_map where woven_position_id='P1'`);
ok(p1.status === "unmapped" && p1.woven_position_name === "Consultant" && !p1.is_confirmed, "positions queued as unmapped, unconfirmed");
ok((await one(`select public.woven_position_map_review('P1','mapped',null,null,10::smallint,'admin:x') as r`)).r.status === "role_and_scope_required", "mapping a position needs a role and a scope");
ok((await one(`select public.woven_position_map_review('P1','mapped','employee','salon',10::smallint,'') as r`)).r.status === "reviewer_required", "a position reviewer is required");
ok(await raises(() => db.query(`update public.woven_position_map set status='mapped' where woven_position_id='P1'`)), "mapped without role/scope is refused by constraint");

// ---- run 2: 200 missing, 100 partial read with a new position ----
const c2 = await claim("admin:someone@suntancity.test");
ok((await one(`select source_mode from public.employee_sync_runs where id=$1`, [c2.runId])).source_mode === "manual_poll", "an admin claim is recorded as manual_poll");
const r2 = await commit(c2.runId, [emp("100", { affiliations: null, record_hash: hash("b"), position_id: "P2", position_name: "Salon Director" })], [
  { external_employee_id: "100", change_kind: "position_changed", field_name: "position_id", classification: "unclassified", from_value: { positionId: "P1" }, to_value: { positionId: "P2" }, details: {} },
]);
ok(r2.created === 0 && r2.updated === 1 && r2.unchanged === 0 && r2.missing === 1 && r2.changes === 1, `run 2 counts ${JSON.stringify(r2)}`);
const r200 = await one(`select missing_sync_count, employment_status, last_synced_at > last_seen_at as synced_after_seen from public.employee_access_directory where external_employee_id='200'`);
ok(r200.missing_sync_count === 1 && r200.employment_status === "active" && r200.synced_after_seen, "absent employee kept, status untouched, last_synced_at moves but last_seen_at does not");
const a100b = await affOf("100");
ok(a100b.length === 2 && a100b.every((a) => a.active), "a partial read deactivates no affiliation");
ok((await one(`select count(*)::int as n from public.woven_position_map`)).n === 2, "new position P2 queued");

// ---- run 3: identical re-run, 200 reappears ----
const c3 = await claim();
const r3 = await commit(c3.runId, [emp("100", { affiliations: null, record_hash: hash("b"), position_id: "P2", position_name: "Salon Director" }), emp("200", { email_address: "Mixed.Case@SunTanCity.test" })], []);
ok(r3.created === 0 && r3.updated === 0 && r3.unchanged === 2 && r3.missing === 0 && r3.changes === 0, `identical re-run: no inserts, no content updates, no changes ${JSON.stringify(r3)}`);
ok((await one(`select count(*)::int as n from public.employee_access_directory`)).n === 2, "no duplicate employees after three runs");
ok((await one(`select count(*)::int as n from public.employee_location_affiliations`)).n === 4, "no duplicate affiliations after three runs");
ok((await one(`select missing_sync_count from public.employee_access_directory where external_employee_id='200'`)).missing_sync_count === 0, "reappearing employee's miss count resets");

// ---- run 4: full read — transfer to LOC-B, LOC-A dropped, LOC-C added ----
const c4 = await claim();
await commit(c4.runId, [
  emp("100", { primary_woven_location_id: "LOC-B", primary_location_name: "B", record_hash: hash("c"), position_id: "P2",
    affiliations: [aff("LOC-B", "primary"), aff("LOC-C", "additional")] }),
  emp("200", { email_address: "Mixed.Case@SunTanCity.test" }),
], [
  { external_employee_id: "100", change_kind: "primary_location_changed", field_name: "primary_woven_location_id", classification: "transfer", from_value: { id: "LOC-A" }, to_value: { id: "LOC-B" } },
  { external_employee_id: "100", change_kind: "location_access_removed", field_name: "location:LOC-A", classification: "removed", from_value: { id: "LOC-A" }, to_value: null },
  { external_employee_id: "100", change_kind: "location_access_added", field_name: "location:LOC-C", classification: "additional", from_value: null, to_value: { id: "LOC-C" } },
], [...LOCS, { woven_location_id: "LOC-C", woven_location_name: "C", is_non_location: true }]);
const a100c = await affOf("100");
const byLoc = Object.fromEntries(a100c.map((a) => [a.loc, a]));
ok(byLoc["LOC-B"].is_primary && byLoc["LOC-B"].access_type === "primary" && byLoc["LOC-B"].expires_on === null, "transfer: new primary row, expiry cleared");
ok(!byLoc["LOC-A"].active && !byLoc["LOC-A"].is_primary, "a full read ends the dropped location (row kept, inactive)");
ok(byLoc["LOC-C"].active && byLoc["LOC-C"].access_type === "additional", "a full read adds the new location");
ok((await one(`select woven_location_ids from public.employee_access_directory where external_employee_id='100'`)).woven_location_ids.join(",") === "LOC-B,LOC-C", "filter array follows: primary first, inactive excluded");

// ---- run 5: partial read after a primary change asserts the new primary safely ----
const c5 = await claim();
await commit(c5.runId, [
  emp("100", { primary_woven_location_id: "LOC-C", primary_location_name: "C", affiliations: null, record_hash: hash("d"), position_id: "P2" }),
  emp("200", { email_address: "Mixed.Case@SunTanCity.test" }),
], []);
const a100d = Object.fromEntries((await affOf("100")).map((a) => [a.loc, a]));
ok(a100d["LOC-C"].is_primary && a100d["LOC-B"].active && !a100d["LOC-B"].is_primary && a100d["LOC-B"].access_type === "additional", "partial read: new primary asserted, old primary steps down but is not ended");
ok((await one(`select count(*)::int as n from public.employee_location_affiliations where is_primary and active group by employee_id order by 1 desc limit 1`)).n === 1, "never two active primaries");

// ---- atomicity ----
const c6 = await claim();
const before = JSON.stringify(await q(`select * from public.employee_access_directory order by external_employee_id`));
ok(await raises(() => commit(c6.runId, [emp("100", { first_name: "CHANGED", record_hash: hash("e") })], [
  { external_employee_id: "999", change_kind: "terminated", from_value: null, to_value: null, details: {} },
])), "commit with an orphan change raises");
ok(before === JSON.stringify(await q(`select * from public.employee_access_directory order by external_employee_id`)), "…and the directory is exactly as before (atomic)");
ok(await raises(() => commit(c6.runId, [emp("100")], [
  { external_employee_id: "100", change_kind: "email_changed", field_name: "email_address", from_value: "a", to_value: "b" },
  { external_employee_id: "100", change_kind: "email_changed", field_name: "email_address", from_value: "a", to_value: "b" },
])), "the same change twice in one run is refused (unique key)");
ok(await raises(() => commit(c6.runId, [emp("100")], [
  { external_employee_id: "100", change_kind: "work_email_changed", from_value: "a", to_value: "b" },
])), "the old name work_email_changed is no longer accepted");
ok((await one(`select status from public.employee_sync_runs where id=$1`, [c6.runId])).status === "running", "…and the run is still open for the caller to abandon");
const ab = (await one(`select public.employee_sync_abandon_run($1, 'failed', 'store_unavailable', 'x', '{"requests_made": 9}'::jsonb) as r`, [c6.runId])).r;
const run6 = await one(`select status, error_code, requests_made from public.employee_sync_runs where id=$1`, [c6.runId]);
ok(ab.status === "closed" && run6.status === "failed" && run6.error_code === "store_unavailable" && run6.requests_made === 9, "abandon closes the run as failed with its code");
ok(await raises(() => one(`select public.employee_sync_abandon_run($1, 'succeeded', 'x', null) as r`, [c6.runId])), "abandon refuses a non-failure status");

// ---- append-only history ----
const change = await one(`select id from public.employee_directory_changes limit 1`);
ok(await raises(() => db.query(`update public.employee_directory_changes set classification = 'promotion_confirmed' where id=$1`, [change.id])), "a classification cannot be rewritten after the fact");
ok(await raises(() => db.query(`update public.employee_directory_changes set effective_date = '2020-01-01' where id=$1`, [change.id])), "an effective date cannot be rewritten");
ok(await raises(() => db.query(`delete from public.employee_directory_changes where id=$1`, [change.id])), "change history cannot be deleted");
await db.query(`update public.employee_directory_changes set review_status='acknowledged', reviewed_by='admin:x', reviewed_at=now() where id=$1`, [change.id]);
ok((await one(`select review_status from public.employee_directory_changes where id=$1`, [change.id])).review_status === "acknowledged", "review fields remain editable");

// ---- location map: reviewed by a person, never overwritten ----
ok((await one(`select public.woven_location_map_review('LOC-A','mapped','9999','admin:x') as r`)).r.status === "unknown_salon", "mapping to an unknown salon number is refused");
ok((await one(`select public.woven_location_map_review('LOC-A','mapped','0306','') as r`)).r.status === "reviewer_required", "a reviewer is required");
ok((await one(`select public.woven_location_map_review('LOC-C','mapped','0306','admin:x') as r`)).r.status === "reviewed", "mapping by salon number succeeds");
const c7 = await claim();
await commit(c7.runId, [emp("100", { primary_woven_location_id: "LOC-C", affiliations: null, record_hash: hash("d"), position_id: "P2" }), emp("200", { email_address: "Mixed.Case@SunTanCity.test" })], [], [{ woven_location_id: "LOC-C", woven_location_name: "Renamed C", woven_location_number: "0144" }]);
const locC = await one(`select m.status, s.salon_number, m.woven_location_name, ss.salon_number as suggested from public.woven_location_map m left join public.salons s on s.id = m.salon_id left join public.salons ss on ss.id = m.suggested_salon_id where woven_location_id='LOC-C'`);
ok(locC.status === "mapped" && locC.salon_number === "0306" && locC.woven_location_name === "Renamed C" && locC.suggested === "0144", "a later sync refreshes the catalog and suggestion but never overwrites a mapping");
ok(await raises(() => db.query(`update public.woven_location_map set status='mapped', salon_id=null where woven_location_id='LOC-B'`)), "mapped without a salon is refused by constraint");
ok((await one(`select public.woven_position_map_review('P2','mapped','salon_director','salon',30::smallint,'admin:x') as r`)).r.status === "reviewed", "position mapped by a person");
ok((await one(`select is_confirmed from public.woven_position_map where woven_position_id='P2'`)).is_confirmed === true, "is_confirmed is generated from status + reviewer");
// A later sync never overwrites a position mapping.
const c8 = await claim();
await commit(c8.runId, [emp("100", { primary_woven_location_id: "LOC-C", affiliations: null, record_hash: hash("d"), position_id: "P2", position_name: "Salon Dir." }), emp("200", { email_address: "Mixed.Case@SunTanCity.test" })], []);
const p2 = await one(`select status, ask_sunny_role, woven_position_name from public.woven_position_map where woven_position_id='P2'`);
ok(p2.status === "mapped" && p2.ask_sunny_role === "salon_director" && p2.woven_position_name === "Salon Dir.", "a later sync refreshes the name but never the mapping");

// ---- stale lock reaping ----
const c9 = await claim();
await db.query(`update public.employee_sync_runs set started_at = now() - interval '20 minutes' where id=$1`, [c9.runId]);
const c10 = await claim();
ok(c10.status === "claimed", "a run left running over 15 minutes is reaped by the next claim");
ok((await one(`select status, error_code from public.employee_sync_runs where id=$1`, [c9.runId])).error_code === "stale_run", "…and recorded as failed/stale_run, not deleted");
await db.query(`select public.employee_sync_abandon_run($1, 'rejected', 'unexpectedly_small', 'test') `, [c10.runId]);

// ---- views ----
const status = await one(`select * from public.employee_sync_status`);
ok(status.last_run_status === "rejected" && status.last_success_run_id === c8.runId && Number(status.total_active) === 2 && Number(status.unmapped_positions) === 1 && Number(status.unmapped_locations) === 2,
  `status view ${JSON.stringify({ last: status.last_run_status, active: status.total_active, uloc: status.unmapped_locations, upos: status.unmapped_positions })}`);
const sum4 = await one(`select transfers, location_access_changes, position_changes, new_employees, error_count from public.employee_sync_run_summary where id=$1`, [c4.runId]);
ok(Number(sum4.transfers) === 1 && Number(sum4.location_access_changes) === 2 && Number(sum4.position_changes) === 0 && Number(sum4.error_count) === 0, `run summary counts by type ${JSON.stringify(sum4)}`);
ok(Number((await one(`select error_count from public.employee_sync_run_summary where id=$1`, [c10.runId])).error_count) === 1, "a refused run counts as an error");
const dv = await one(`select position_mapping_status, primary_salon_number, active_location_count, has_unmapped_location, last_change_kind, changes_last_30_days from public.employee_directory_view where external_employee_id='100'`);
ok(dv.position_mapping_status === "mapped" && dv.primary_salon_number === "0306" && Number(dv.active_location_count) === 2 && dv.has_unmapped_location === true && dv.changes_last_30_days.includes("primary_location_changed"),
  `directory view ${JSON.stringify(dv)}`);

// Login match and access preview, case-insensitively, granting nothing.
const c11 = await claim();
await commit(c11.runId, [
  emp("100", { email_address: "SAM.smith@suntancity.test", primary_woven_location_id: "LOC-C", affiliations: null, record_hash: hash("f"), position_id: "P2" }),
  emp("200", { email_address: "gone@SunTanCity.test", employment_status: "terminated", termination_date: "2026-09-26" }),
], []);
const matches = await q(`select external_employee_id from public.employee_directory_login_matches order by 1`);
ok(matches.length === 2 && matches[0].external_employee_id === "100", "login-match view matches case-insensitively");
const pv = Object.fromEntries((await q(`select * from public.employee_access_preview`)).map((r) => [r.external_employee_id, r]));
ok(pv["100"].role_differs === true && pv["100"].primary_salon_differs === true && pv["100"].would_deactivate_candidate === false, "preview: confirmed position and mapped salon differ from the login");
ok(pv["200"].would_deactivate_candidate === true, "preview: terminated in Woven, active login → deactivation candidate");
const dv200 = await one(`select employment_status from public.employee_directory_view where external_employee_id='200'`);
ok(dv200.employment_status === "terminated", "directory view shows a Woven-terminated employee as terminated");
const st = await one(`select total_terminated, total_active from public.employee_sync_status`);
ok(Number(st.total_terminated) === (await one(`select count(*)::int as n from public.employee_access_directory where employment_status='terminated'`)).n && Number(st.total_terminated) >= 1,
  `the Overview's terminated count counts them ${JSON.stringify(st)}`);

// ---- 20260930000100: protected role overrides, and the directory's change label ----
const overridesSql = readFileSync(OVERRIDES_MIGRATION, "utf8");
await db.exec(`begin;\n${overridesSql}\ncommit;`);
ok(true, "role-overrides migration applies in one transaction");
await db.exec(`begin;\n${overridesSql}\ncommit;`);
ok(true, "role-overrides migration re-applies cleanly");
for (const role of ["anon", "authenticated"]) {
  const r = await one(`select has_table_privilege($1, 'public.employee_role_overrides', 'select') as s, has_table_privilege($1, 'public.employee_role_overrides', 'insert') as i`, [role]);
  ok(!r.s && !r.i, `${role} has no select/insert on employee_role_overrides`);
  for (const view of ["employee_access_preview", "employee_directory_view"]) {
    const v = await one(`select has_table_privilege($1, 'public.${view}', 'select') as s`, [role]);
    ok(!v.s, `${role} still has no select on re-created ${view}`);
  }
}
const ovRls = await one(`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'employee_role_overrides'`);
ok(ovRls.relrowsecurity && ovRls.relforcerowsecurity, "RLS enabled and forced on employee_role_overrides");
ok((await one(`select count(*)::int as n from pg_policies where tablename = 'employee_role_overrides'`)).n === 0, "no RLS policy on employee_role_overrides");
const invoker = await q(`select relname, reloptions from pg_class where relname in ('employee_access_preview','employee_directory_view')`);
ok(invoker.length === 2 && invoker.every((r) => (r.reloptions ?? []).includes("security_invoker=true")), "re-created views keep security_invoker");
const dvLabel = await one(`select last_change_kind, last_change_classification from public.employee_directory_view where external_employee_id='100'`);
const latest100 = await one(`select c.change_kind, c.classification from public.employee_directory_changes c join public.employee_access_directory d on d.id = c.employee_id where d.external_employee_id='100' order by c.detected_at desc limit 1`);
ok(dvLabel.last_change_kind === latest100.change_kind && dvLabel.last_change_classification === latest100.classification, `directory view carries the last change's classification ${JSON.stringify(dvLabel)}`);

/* 700: the protected admin, whose Woven email does not match app_users.email. 701: same position, no override. 702: an "Operations" colleague. */
ok((await one(`select public.woven_position_map_review('P1','mapped','employee','salon',10::smallint,'admin:x') as r`)).r.status === "reviewed", "P1 mapped to employee");
const c13 = await claim();
await commit(c13.runId, [
  emp("700", { email_address: "owner.one@suntancity.test", position_id: "P1", record_hash: hash("7") }),
  emp("701", { email_address: "peer@suntancity.test", position_id: "P1", record_hash: hash("7") }),
  emp("702", { email_address: "ops@suntancity.test", position_id: "OPS", position_name: "Operations", record_hash: hash("7") }),
], []);
await db.query(`insert into public.employee_role_overrides (app_user_id, external_employee_id, locked_role, locked_scope_level, reason, set_by) values ($1, '700', 'admin', 'global', 'Protected administrator', 'admin:x')`, [PROTECTED_ADMIN]);
const pvOf = async () => Object.fromEntries((await q(`select * from public.employee_access_preview where external_employee_id in ('700','701','702')`)).map((r) => [r.external_employee_id, r]));
let po = await pvOf();
ok(po["700"].app_user_id === PROTECTED_ADMIN, "the override finds the account even though app_users.email is not the Woven email");
ok(po["700"].effective_role === "admin" && po["700"].effective_scope_level === "global" && po["700"].role_source === "override" && po["700"].role_override === "admin",
  `override wins over the position map ${JSON.stringify({ r: po["700"].effective_role, s: po["700"].role_source })}`);
ok(po["700"].role_differs === false && po["700"].primary_salon_differs === false, "a protected admin is never reported as 'should be' a lower role or another salon");
ok(po["701"].effective_role === "employee" && po["701"].role_source === "position" && po["701"].role_override === null, "a colleague in the same position gets the position's role, not admin");
ok(po["702"].effective_role === null && po["702"].role_source === "none", "an unmapped position (Operations) resolves to no role — never admin");
/* A later sync moves the protected admin to a mapped salon-director position: still admin. */
const c14 = await claim();
await commit(c14.runId, [
  emp("700", { email_address: "owner.one@suntancity.test", position_id: "P2", record_hash: hash("8") }),
  emp("701", { email_address: "peer@suntancity.test", position_id: "P1", record_hash: hash("7") }),
  emp("702", { email_address: "ops@suntancity.test", position_id: "OPS", position_name: "Operations", record_hash: hash("7") }),
], [{ external_employee_id: "700", change_kind: "position_changed", field_name: "position_id", from_value: { positionId: "P1" }, to_value: { positionId: "P2" }, classification: "unclassified", effective_date: null, details: {} }]);
po = await pvOf();
ok(po["700"].effective_role === "admin" && po["700"].role_differs === false, "after a later sync changes the position, the protected admin still resolves to admin");
ok((await one(`select role from public.app_users where id=$1`, [PROTECTED_ADMIN])).role === "admin", "the sync never touched the protected account's role");
/* Mutation check: without the override the same row resolves to the position's role. */
await db.query(`delete from public.employee_role_overrides where app_user_id=$1`, [PROTECTED_ADMIN]);
po = await pvOf();
ok(po["700"].role_source === "position" && po["700"].effective_role === "salon_director", "without the override the position decides (the override is what protects)");
await db.query(`insert into public.employee_role_overrides (app_user_id, external_employee_id, locked_role, locked_scope_level, reason, set_by) values ($1, '700', 'admin', 'global', 'Protected administrator', 'admin:x')`, [PROTECTED_ADMIN]);
ok(await raises(() => db.query(`insert into public.employee_role_overrides (app_user_id, external_employee_id, locked_role, locked_scope_level, reason, set_by) values (gen_random_uuid(), '701', 'admin', 'global', 'x', 'admin:x')`)), "an override must name an existing account");
ok(await raises(() => db.query(`insert into public.employee_role_overrides (app_user_id, external_employee_id, locked_role, locked_scope_level, reason, set_by) values ($1, '999', 'admin', 'global', '', 'admin:x')`, [PROTECTED_ADMIN])), "an override needs a reason (and one row per account)");

// ---- a deliberate non-salon location (Corporate, 'ignored') is never an unmapped-location problem; an unresolved one still is ----
const HQ_LOCS = [
  { woven_location_id: "LOC-HQ", woven_location_name: "Corporate", woven_location_number: null },
  { woven_location_id: "LOC-Q", woven_location_name: "Unresolved Q", woven_location_number: null },
  { woven_location_id: "LOC-C", woven_location_name: "Renamed C", woven_location_number: "0144" },
];
const c15 = await claim();
await commit(c15.runId, [
  emp("800", { primary_woven_location_id: "LOC-HQ", has_multiple_location_access: false, affiliations: [aff("LOC-HQ", "primary")], record_hash: hash("9") }),
  emp("801", { primary_woven_location_id: "LOC-HQ", has_all_location_access: true, affiliations: [aff("LOC-HQ", "primary"), aff("LOC-C", "additional"), aff("LOC-Q", "additional")], record_hash: hash("9") }),
  emp("802", { primary_woven_location_id: "LOC-C", has_multiple_location_access: false, affiliations: [aff("LOC-C", "primary")], record_hash: hash("9") }),
  emp("803", { primary_woven_location_id: "LOC-C", affiliations: [aff("LOC-C", "primary"), aff("LOC-Q", "additional")], record_hash: hash("9") }),
], [], HQ_LOCS);
ok((await one(`select public.woven_location_map_review('LOC-HQ','ignored',null,'admin:x') as r`)).r.status === "reviewed", "Corporate marked ignored (not a salon) by a person");
const unmappedOf = async () => Object.fromEntries((await q(`select external_employee_id, has_unmapped_location, primary_location_mapping_status from public.employee_directory_view where external_employee_id in ('800','801','802','803')`)).map((r) => [r.external_employee_id, r]));
let um = await unmappedOf();
ok(um["800"].has_unmapped_location === false && um["800"].primary_location_mapping_status === "ignored", "a Corporate-only employee is not an unmapped-location row");
ok(um["801"].has_unmapped_location === true, "a Corporate employee whose access includes an unresolved location is still counted");
ok(um["802"].has_unmapped_location === false, "a salon employee at a mapped salon is not flagged");
ok(um["803"].has_unmapped_location === true, "a salon employee with an unresolved additional location is still flagged");
/* Mutation check: were Corporate left unmapped, the Corporate-only employee would be flagged. */
await db.query(`select public.woven_location_map_review('LOC-HQ','unmapped',null,'admin:x')`);
um = await unmappedOf();
ok(um["800"].has_unmapped_location === true, "without the 'ignored' review, Corporate counts as unmapped (the review is what exempts it)");
await db.query(`select public.woven_location_map_review('LOC-HQ','ignored',null,'admin:x')`);
ok((await one(`select salon_id from public.woven_location_map where woven_location_id='LOC-HQ'`)).salon_id === null, "Corporate is never mapped to a salon");

// ---- data constraints ----
const c12 = await claim();
ok(await raises(() => commit(c12.runId, [emp("400", { email_address: " padded@x.test" })], [])), "an untrimmed email is refused by constraint");
ok(await raises(() => commit(c12.runId, [emp("bad id with spaces")], [])), "an employee id outside the pattern is refused");
ok(await raises(() => commit(c12.runId, [emp("500"), emp("500")], [])), "a payload repeating one employee is refused rather than half-applied");
ok(await raises(() => commit(c12.runId, [emp("600", { affiliations: [aff("LOC-A", "primary"), aff("LOC-B", "primary")] })], [])), "two primaries in one full read are refused");

// ---- app_users untouched throughout ----
ok(JSON.stringify(await q("select * from public.app_users order by id")) === appUsersBefore, "app_users is byte-for-byte unchanged");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
