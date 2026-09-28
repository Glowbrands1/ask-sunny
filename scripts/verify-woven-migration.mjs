// Verifies supabase/migrations/20260928002000_woven_employee_directory.sql against
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
const db = new PGlite();
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures += 1;
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const q = async (sql, params) => (await db.query(sql, params)).rows;

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
  create type public.app_user_role as enum ('employee','salon_director','admin');
  create type public.app_user_status as enum ('invited','active','disabled');
  create table public.app_users (id uuid primary key default gen_random_uuid(), email text not null, role public.app_user_role not null, status public.app_user_status not null);
  insert into public.app_users (email, role, status) values ('Sam.Smith@SunTanCity.test', 'salon_director', 'active');
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
for (const table of ["employee_sync_runs", "employee_access_directory", "employee_directory_changes", "woven_location_map", "employee_sync_status", "employee_directory_login_matches"]) {
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
  "employee_directory_changes_guard()",
]) {
  for (const role of ["public", "anon", "authenticated"]) {
    const r = role === "public"
      ? await one(`select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.${fn}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as x`)
      : await one(`select has_function_privilege($1, 'public.${fn}', 'execute') as x`, [role]);
    ok(!r.x, `${role} cannot execute ${fn}`);
  }
}
const rls = await q(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('employee_sync_runs','employee_access_directory','employee_directory_changes','woven_location_map')`);
ok(rls.length === 4 && rls.every((r) => r.relrowsecurity && r.relforcerowsecurity), "RLS enabled and forced on all four tables");

// ---- helpers ----
const hash = (c) => c.repeat(64);
const emp = (id, over = {}) => ({
  external_employee_id: id, first_name: "F" + id, last_name: "L" + id, preferred_name: null,
  work_email: `e${id}@suntancity.test`, employment_status: "active", hire_date: "2024-01-15", termination_date: null,
  position_id: "P1", position_name: "Consultant", primary_woven_location_id: "LOC-A", primary_location_name: "A",
  woven_location_ids: ["LOC-A", "LOC-B"],
  location_affiliations: [{ woven_location_id: "LOC-A", location_name: "A", kind: "primary", starts_on: null, expires_on: null },
                          { woven_location_id: "LOC-B", location_name: "B", kind: "temporary", starts_on: null, expires_on: "2026-12-31" }],
  affiliations_verified: true, source_updated_at: null, data_issues: [], record_hash: hash("a"), ...over,
});
const claim = async () => (await one(`select public.employee_sync_claim_run('cron') as r`)).r;
const commit = async (runId, employees, changes, locations = [{ woven_location_id: "LOC-A", woven_location_name: "A" }, { woven_location_id: "LOC-B", woven_location_name: "B" }], stats = { requests_made: 5, issue_counts: { x: 1 } }) =>
  (await one(`select public.employee_sync_commit_run($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb) as r`,
    [runId, JSON.stringify(employees), JSON.stringify(changes), JSON.stringify(locations), JSON.stringify(stats)])).r;

// ---- run 1: lock + initial load ----
const c1 = await claim();
ok(c1.status === "claimed" && c1.runId, "first claim succeeds");
const busy = await claim();
ok(busy.status === "busy", "second concurrent claim is refused (one live run)");

const r1 = await commit(c1.runId, [emp("100"), emp("200")], [
  { external_employee_id: "100", change_kind: "new_employee", from_value: null, to_value: { a: 1 }, details: { initialLoad: true } },
  { external_employee_id: "200", change_kind: "new_employee", from_value: null, to_value: { a: 1 }, details: { initialLoad: true } },
]);
ok(r1.status === "committed" && r1.created === 2 && r1.updated === 0 && r1.missing === 0 && r1.changes === 2, `run 1 commit counts ${JSON.stringify(r1)}`);
const row100 = await one(`select woven_location_ids, location_affiliations, affiliations_verified_at, missing_sync_count from public.employee_access_directory where external_employee_id='100'`);
ok(Array.isArray(row100.woven_location_ids) && row100.woven_location_ids.join(",") === "LOC-A,LOC-B", "JSON array → text[] conversion");
ok(row100.location_affiliations.length === 2 && row100.affiliations_verified_at !== null, "affiliations stored and verified_at set");
const run1 = await one(`select status, finished_at, requests_made, issue_counts, employees_created from public.employee_sync_runs where id=$1`, [c1.runId]);
ok(run1.status === "succeeded" && run1.finished_at && run1.requests_made === 5 && run1.issue_counts.x === 1 && run1.employees_created === 2, "run 1 closed with stats");
const again = await commit(c1.runId, [emp("300")], []);
ok(again.status === "not_running", "a closed run cannot be committed twice");

// ---- run 2: 200 missing, 100 unverified affiliations, change recorded ----
const c2 = await claim();
const r2 = await commit(c2.runId, [emp("100", { affiliations_verified: false, record_hash: hash("b"), position_id: "P2" })], [
  { external_employee_id: "100", change_kind: "position_changed", from_value: { positionId: "P1" }, to_value: { positionId: "P2" }, details: { direction: "unclassified" } },
]);
ok(r2.created === 0 && r2.updated === 1 && r2.missing === 1 && r2.changes === 1, `run 2 counts ${JSON.stringify(r2)}`);
const r200 = await one(`select missing_sync_count, employment_status from public.employee_access_directory where external_employee_id='200'`);
ok(r200.missing_sync_count === 1 && r200.employment_status === "active", "absent employee kept, status untouched, miss count 1");
const r100b = await one(`select affiliations_verified_at is not null as v, content_changed_at > first_seen_at as changed, position_id from public.employee_access_directory where external_employee_id='100'`);
ok(r100b.v && r100b.position_id === "P2", "unverified run keeps previous affiliations_verified_at");

// ---- run 3: identical re-run, then 200 reappears → miss count resets ----
const c3 = await claim();
const r3 = await commit(c3.runId, [emp("100", { affiliations_verified: false, record_hash: hash("b"), position_id: "P2" }), emp("200")], []);
ok(r3.created === 0 && r3.updated === 2 && r3.missing === 0 && r3.changes === 0, "identical re-run: no inserts, no changes");
const count = await one(`select count(*)::int as n from public.employee_access_directory`);
ok(count.n === 2, "no duplicate employees after three runs");
ok((await one(`select missing_sync_count from public.employee_access_directory where external_employee_id='200'`)).missing_sync_count === 0, "reappearing employee's miss count resets");

// ---- run 4: a change naming an unknown employee rolls EVERYTHING back ----
const c4 = await claim();
const before = JSON.stringify(await q(`select * from public.employee_access_directory order by external_employee_id`));
let threw = false;
try {
  await commit(c4.runId, [emp("100", { first_name: "CHANGED", record_hash: hash("c") })], [
    { external_employee_id: "999", change_kind: "terminated", from_value: null, to_value: null, details: {} },
  ]);
} catch { threw = true; }
ok(threw, "commit with an orphan change raises");
const after = JSON.stringify(await q(`select * from public.employee_access_directory order by external_employee_id`));
ok(before === after, "…and the directory is exactly as before (atomic)");
ok((await one(`select status from public.employee_sync_runs where id=$1`, [c4.runId])).status === "running", "…and the run is still open for the caller to abandon");
const ab = (await one(`select public.employee_sync_abandon_run($1, 'failed', 'store_unavailable', 'x', '{"requests_made": 9}'::jsonb) as r`, [c4.runId])).r;
const run4 = await one(`select status, error_code, requests_made from public.employee_sync_runs where id=$1`, [c4.runId]);
ok(ab.status === "closed" && run4.status === "failed" && run4.error_code === "store_unavailable" && run4.requests_made === 9, "abandon closes the run as failed with its code");
let refused = false;
try { await one(`select public.employee_sync_abandon_run($1, 'succeeded', 'x', null) as r`, [c4.runId]); } catch { refused = true; }
ok(refused, "abandon refuses a non-failure status");

// ---- append-only history ----
const change = await one(`select id from public.employee_directory_changes limit 1`);
let blockedUpdate = false, blockedDelete = false;
try { await db.query(`update public.employee_directory_changes set from_value = '{}' where id=$1`, [change.id]); } catch { blockedUpdate = true; }
try { await db.query(`delete from public.employee_directory_changes where id=$1`, [change.id]); } catch { blockedDelete = true; }
ok(blockedUpdate && blockedDelete, "change history cannot be rewritten or deleted");
await db.query(`update public.employee_directory_changes set review_status='acknowledged', reviewed_by='admin:x', reviewed_at=now() where id=$1`, [change.id]);
ok((await one(`select review_status from public.employee_directory_changes where id=$1`, [change.id])).review_status === "acknowledged", "review fields remain editable");

// ---- location map: queued unmapped, reviewed by a person, never overwritten ----
const locs = await q(`select woven_location_id, status from public.woven_location_map order by 1`);
ok(locs.length === 2 && locs.every((l) => l.status === "unmapped"), "new locations queued as unmapped");
ok((await one(`select public.woven_location_map_review('LOC-A','mapped','9999','admin:x') as r`)).r.status === "unknown_salon", "mapping to an unknown salon number is refused");
ok((await one(`select public.woven_location_map_review('LOC-A','mapped','0306','') as r`)).r.status === "reviewer_required", "a reviewer is required");
ok((await one(`select public.woven_location_map_review('LOC-A','mapped','0306','admin:x') as r`)).r.status === "reviewed", "mapping by salon number succeeds");
const c5 = await claim();
await commit(c5.runId, [emp("100", { affiliations_verified: false, record_hash: hash("b"), position_id: "P2" }), emp("200")], [], [{ woven_location_id: "LOC-A", woven_location_name: "Renamed A" }]);
const locA = await one(`select m.status, s.salon_number, m.woven_location_name from public.woven_location_map m left join public.salons s on s.id = m.salon_id where woven_location_id='LOC-A'`);
ok(locA.status === "mapped" && locA.salon_number === "0306" && locA.woven_location_name === "Renamed A", "a later sync never overwrites a mapping");
let badMap = false;
try { await db.query(`update public.woven_location_map set status='mapped', salon_id=null where woven_location_id='LOC-B'`); } catch { badMap = true; }
ok(badMap, "mapped without a salon is refused by constraint");

// ---- stale lock reaping ----
const c6 = await claim();
await db.query(`update public.employee_sync_runs set started_at = now() - interval '20 minutes' where id=$1`, [c6.runId]);
const c7 = await claim();
ok(c7.status === "claimed", "a run left running over 15 minutes is reaped by the next claim");
ok((await one(`select status, error_code from public.employee_sync_runs where id=$1`, [c6.runId])).error_code === "stale_run", "…and recorded as failed/stale_run, not deleted");
await db.query(`select public.employee_sync_abandon_run($1, 'rejected', 'unexpectedly_small', 'test') `, [c7.runId]);

// ---- views ----
const status = await one(`select * from public.employee_sync_status`);
ok(status.last_run_status === "rejected" && status.last_success_run_id === c5.runId && Number(status.unmapped_locations) === 1, `status view ${JSON.stringify({ last: status.last_run_status, unmapped: status.unmapped_locations })}`);
const c8 = await claim();
await commit(c8.runId, [emp("100", { work_email: "sam.smith@suntancity.test", affiliations_verified: false, record_hash: hash("d"), position_id: "P2" }), emp("200")], []);
const matches = await q(`select * from public.employee_directory_login_matches`);
ok(matches.length === 1 && matches[0].external_employee_id === "100", "login-match view matches case-insensitively");

// ---- data constraints ----
const c9 = await claim();
let badEmail = false;
try { await commit(c9.runId, [emp("400", { work_email: "Upper@Case.test" })], []); } catch { badEmail = true; }
ok(badEmail, "a non-lower-cased email is refused by constraint (rolled back)");
let badId = false;
try { await commit(c9.runId, [emp("bad id with spaces")], []); } catch { badId = true; }
ok(badId, "an employee id outside the pattern is refused");
let dupInPayload = false;
try { await commit(c9.runId, [emp("500"), emp("500")], []); } catch { dupInPayload = true; }
ok(dupInPayload, "a payload repeating one employee is refused rather than half-applied");

// ---- app_users untouched throughout ----
ok(JSON.stringify(await q("select * from public.app_users order by id")) === appUsersBefore, "app_users is byte-for-byte unchanged");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
