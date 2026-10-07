import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * ONE LIFECYCLE, ONE TERMINATION EXECUTOR — after 20261007002000
 * ============================================================================
 *
 * Production received PR #89's `20261007001000_woven_disable_terminated_apply`
 * (never merged) next to main's lifecycle. `20261007002000_woven_retire_
 * competing_disable_terminated` retires it. This suite runs on the disposable
 * local stack built either way:
 *
 *   fresh      every migration on main, in order (no #89 ever)
 *   prod-like  main through 20261006001000, then #89 (twice), then
 *              20261006002000, then 20261007002000 — Production's path
 *
 * and asserts the SAME end state: main's objects only, main's grants, nothing
 * for the browser roles. The lifecycle suites run against the same database.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const PG = process.env.LOCAL_STACK_PG ?? "";
const FILE = "supabase/migrations/20261007002000_woven_retire_competing_disable_terminated.sql";
const sql = (query: string) => execFileSync("psql", [PG, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
/** Runs SQL then the reconcile file in ONE transaction; returns the error, or null. On error everything rolls back. */
function reconcileAfter(prelude: string, as = PG): string | null {
  const dir = mkdtempSync(join(tmpdir(), "reconcile-"));
  const path = join(dir, "run.sql");
  writeFileSync(path, `${prelude}\n${readFileSync(FILE, "utf8")}`);
  try {
    execFileSync("psql", [as, "-q", "-v", "ON_ERROR_STOP=1", "-1", "-f", path], { encoding: "utf8", stdio: "pipe" });
    return null;
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
}
/** A fingerprint of everything the lifecycle schema is made of. */
const fingerprint = () =>
  sql(`select md5(string_agg(x, E'\\n' order by x)) from (
         select 'fn ' || p.oid::regprocedure::text || ' ' || md5(p.prosrc) || ' ' || p.prosecdef || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || coalesce(array_to_string(p.proacl, ','), '')
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'employee_acc%'
         union all select 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid::regclass::text like 'employee_acc%'
         union all select 'trg ' || tgrelid::regclass::text || ' ' || tgname || ' ' || tgenabled::text from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'employee_acc%'
         union all select 'acl ' || c.relname || ' ' || coalesce(array_to_string(c.relacl, ','), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'employee_acc%'
         union all select 'col ' || table_name || ' ' || column_name || ' ' || grantee || ' ' || privilege_type from information_schema.column_privileges where table_schema = 'public' and table_name like 'employee_acc%' and grantee in ('service_role', 'anon', 'authenticated')
       ) s(x)`);

describe.skipIf(!ENABLED)("reconciled: main's lifecycle only, no competing executor (local stack)", { timeout: 60_000 }, () => {
  it("nothing of PR #89 remains: no switch, change log or operations ledger; no claim/finish/record-apply-run; no match-run trigger", () => {
    for (const table of ["employee_access_controls", "employee_access_control_changes", "employee_access_operations"]) {
      expect(sql(`select coalesce(to_regclass('public.${table}')::text, 'none')`), table).toBe("none");
    }
    for (const fn of [
      "employee_access_controls_log_change()",
      "employee_access_claim_operation(text, uuid, text, text)",
      "employee_access_finish_operation(uuid, text, jsonb, text, text)",
      "employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb)",
      "employee_access_actions_match_run()",
    ]) {
      expect(sql(`select coalesce(to_regprocedure('public.${fn}')::text, 'none')`), fn).toBe("none");
    }
    expect(sql(`select count(*) from pg_trigger where tgname = 'employee_access_actions_match_run'`)).toBe("0");
  });

  it("exactly main's functions: one run record, one termination path (disable_terminated + record_revocation)", () => {
    expect(
      sql(`select string_agg(p.oid::regprocedure::text, ' ' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'employee_access%' or p.proname like 'employee_account_links%')`).split(" "),
    ).toEqual([
      "employee_access_actions_guard()",
      "employee_access_auth_only_accounts()",
      "employee_access_auth_user_by_email(text)",
      "employee_access_begin_apply_run(text,uuid,text)",
      "employee_access_directory_is_current()",
      "employee_access_disable_terminated(uuid,text,text)",
      "employee_access_finish_apply_run(uuid,text,text[],jsonb)",
      "employee_access_is_protected(uuid)",
      "employee_access_link_existing(uuid,text,text)",
      "employee_access_observed_status(text)",
      "employee_access_provision_account(uuid,text,text,text,text,text,text)",
      "employee_access_record_apply_actions(uuid,jsonb)",
      "employee_access_record_invite(uuid,text,text,text)",
      "employee_access_record_revocation(uuid,boolean,text,text)",
      "employee_access_record_shadow_run(text,uuid,text,text[],jsonb,jsonb)",
      "employee_access_runs_guard()",
      "employee_account_links_guard_update()",
    ]);
    expect(
      sql(`select string_agg(tgrelid::regclass::text || '.' || tgname, ' ' order by tgrelid::regclass::text || '.' || tgname) from pg_trigger where not tgisinternal and tgrelid::regclass::text like 'employee_acc%'`).split(" "),
    ).toEqual([
      "employee_access_actions.employee_access_actions_append_only",
      "employee_access_directory.employee_access_directory_touch_updated_at",
      "employee_access_runs.employee_access_runs_append_only",
      "employee_account_links.employee_account_links_guard_update",
      "employee_account_links.employee_account_links_touch_updated_at",
    ]);
  });

  it("main's vocabulary and guard: results shadow/planned/skipped/applied/failed (no 'blocked'); runs shadow|apply; the lifecycle guard, not the write-once one", () => {
    expect(sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'employee_access_actions_result_check'`)).toBe(
      "CHECK ((result = ANY (ARRAY['shadow'::text, 'planned'::text, 'skipped'::text, 'applied'::text, 'failed'::text])))",
    );
    expect(sql(`select pg_get_constraintdef(oid) from pg_constraint where conname = 'employee_access_runs_mode_check'`)).toBe(
      "CHECK ((mode = ANY (ARRAY['shadow'::text, 'apply'::text])))",
    );
    const guard = sql(`select prosrc from pg_proc where oid = 'public.employee_account_links_guard_update()'::regprocedure`);
    expect(guard).toContain("invite_delivery_status");
    expect(guard).not.toContain("write-once");
  });

  it("service_role may UPDATE exactly the three managed flags on a link — the revocation columns only through main's functions; no table-wide UPDATE, DELETE or TRUNCATE", () => {
    expect(
      sql(`select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'employee_account_links' and grantee = 'service_role' and privilege_type = 'UPDATE'`),
    ).toBe("managed_location,managed_role,managed_status");
    for (const table of ["employee_account_links", "employee_access_runs", "employee_access_actions"]) {
      expect(sql(`select has_table_privilege('service_role', 'public.${table}', 'UPDATE, DELETE, TRUNCATE')::text`), table).toBe("false");
    }
  });

  it("the browser roles hold nothing: no table, view or column privilege, and no lifecycle function", () => {
    expect(
      sql(`select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'employee_acc%' and grantee in ('anon', 'authenticated', 'PUBLIC')`),
    ).toBe("0");
    expect(
      sql(`select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name like 'employee_acc%' and grantee in ('anon', 'authenticated', 'PUBLIC')`),
    ).toBe("0");
    expect(
      sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ('anon'), ('authenticated')) r(role)
           where n.nspname = 'public' and (p.proname like 'employee_access%' or p.proname like 'employee_account_links%') and has_function_privilege(r.role, p.oid, 'EXECUTE')`),
    ).toBe("0");
  });

  it("running the reconcile again changes nothing", () => {
    const before = fingerprint();
    expect(reconcileAfter("", PG.replace("supabase_admin@", "postgres:postgres@"))).toBeNull();
    expect(fingerprint()).toBe(before);
  });

  it("refuses — and changes nothing — when #89's ledger holds an operation, or its switch was turned on, or before 20261006002000", () => {
    const before = fingerprint();
    expect(reconcileAfter(`create table public.employee_access_operations (id integer); insert into public.employee_access_operations values (1);`)).toMatch(
      /holds operations; .* nothing changed/,
    );
    expect(
      reconcileAfter(`create table public.employee_access_controls (action text, enabled boolean, changed_by text); insert into public.employee_access_controls values ('DISABLE_TERMINATED', true, 'owner');`),
    ).toMatch(/turned on or changed by a person; nothing changed/);
    expect(
      reconcileAfter(`create table public.employee_access_control_changes (enabled_to boolean, changed_by text); insert into public.employee_access_control_changes values (false, 'someone@example.test');`),
    ).toMatch(/records a change by a person; nothing changed/);
    expect(reconcileAfter(`alter function public.employee_access_begin_apply_run(text, uuid, text) rename to employee_access_begin_apply_run_hidden;`)).toMatch(
      /apply 20261006002000_woven_account_lifecycle\.sql first; nothing changed/,
    );
    expect(sql(`select coalesce(to_regclass('public.employee_access_operations')::text, 'none')`)).toBe("none");
    expect(fingerprint()).toBe(before);
  });
});
