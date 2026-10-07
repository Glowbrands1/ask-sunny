import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * ============================================================================
 * STAGE 1 AGAINST REAL POSTGRES — links, the planner's view, shadow records
 * ============================================================================
 *
 * Runs only on the disposable local stack (`scripts/local-stack/up.sh`,
 * `ASK_SUNNY_LOCAL_STACK=1`), where every migration has been applied as the
 * non-superuser `postgres` role, exactly as in the Supabase project. Never
 * against the Ask Sunny project.
 *
 * Proves: the backfill links protected overrides with every managed flag off
 * and marks unmatched accounts not-Woven-managed; the link constraints refuse
 * ambiguity; the browser roles can read none of it; the shadow recorder
 * writes only its own two tables, atomically, under concurrency, and leaves
 * `app_users` and `auth.users` byte-for-byte unchanged.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const ANON = process.env.LOCAL_ANON_KEY ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";
const MIGRATION = "supabase/migrations/20261002002000_woven_account_links.sql";

const run = randomBytes(3).toString("hex");
const sql = (query: string) => execFileSync("psql", [PG, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const sqlFails = (query: string) => {
  try {
    sql(query);
    return null;
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
};
/**
 * A fingerprint of this suite's accounts — profile rows, auth rows, sessions:
 * nothing the planner or the shadow recorder does may change it. Scoped to the
 * suite's own users so another suite running alongside cannot disturb it.
 */
let suiteUserIds: string[] = [];
const fingerprint = () => {
  const list = suiteUserIds.map((id) => `'${id}'`).join(",");
  return createHash("sha256")
    .update(sql(`select coalesce(string_agg(to_jsonb(u)::text, '|' order by id), '') from public.app_users u where id in (${list})`))
    .update(sql(`select coalesce(string_agg(to_jsonb(u)::text, '|' order by id), '') from auth.users u where id in (${list})`))
    .digest("hex");
};

describe.skipIf(!ENABLED)("stage 1 on real Postgres (local stack)", { timeout: 60_000 }, () => {
  const ids = {
    protectedAdmin: "",
    candidate: "",
    unmatched: "",
    linkedSd: "",
    candidate2: "",
  };
  const employee = (suffix: string) => `LS-${run}-${suffix}`;

  beforeAll(async () => {
    expect(new URL(URL_).hostname).toBe("127.0.0.1");
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ANON;
    process.env.SUPABASE_SECRET_KEY = SERVICE;

    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const make = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) throw new Error(String(error?.message));
      return data.user.id;
    };
    ids.protectedAdmin = await make(`owner-${run}@local.test`);
    ids.candidate = await make(`candidate-${run}@gmail.test`);
    ids.unmatched = await make(`vendor-${run}@vendor.test`);
    ids.linkedSd = await make(`linked-${run}@gmail.test`);
    ids.candidate2 = await make(`candidate2-${run}@gmail.test`);
    suiteUserIds = Object.values(ids);

    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values
      ('${ids.protectedAdmin}', 'owner-${run}@local.test', 'Owner', 'admin', 'active', 'global', null),
      ('${ids.candidate}', 'candidate-${run}@gmail.test', 'Candidate', 'salon_director', 'active', 'salon', 'loc-0307'),
      ('${ids.unmatched}', 'vendor-${run}@vendor.test', 'Vendor', 'admin', 'active', 'global', null),
      ('${ids.linkedSd}', 'linked-${run}@gmail.test', 'Linked SD', 'salon_director', 'active', 'salon', 'loc-0307'),
      ('${ids.candidate2}', 'candidate2-${run}@gmail.test', 'Candidate Two', 'district_manager', 'active', 'global', null)`);

    sql(`insert into public.salons (salon_number, store_name) values ('0307', 'NE Grand Island'), ('0394', 'KC Liberty') on conflict do nothing`);
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
         select 'WL-GI-${run}', 'NE Grand Island', 'mapped', id, 'test', now() from public.salons where salon_number = '0307'`);
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
         select 'WL-LIB-${run}', 'KC Liberty', 'mapped', id, 'test', now() from public.salons where salon_number = '0394'`);
    sql(`insert into public.woven_position_map (woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, reviewed_by, reviewed_at)
         values ('WP-SD-${run}', 'Salon Director', 'mapped', 'salon_director', 'salon', 30, 'test', now()),
                ('WP-OWN-${run}', 'Owner', 'unmapped', null, null, null, null, null)`);

    const hash = "0".repeat(64);
    const row = (suffix: string, email: string, position: string, location: string, status = "active") =>
      `('woven', '${employee(suffix)}', '${email}', '${status}', 'WP-${position}-${run}', '${position}', 'WL-${location}-${run}', '${location}', '${hash}', 'Pat', 'Person-${suffix}')`;
    sql(`insert into public.employee_access_directory
         (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name)
         values
         ${row("OWNER", `owner-${run}@local.test`, "OWN", "GI")},
         ${row("CAND", `candidate-${run}@gmail.test`, "SD", "GI")},
         ${row("NEWSD", `new-sd-${run}@gmail.test`, "SD", "GI")},
         ${row("LINKED", `linked-${run}@gmail.test`, "SD", "LIB")},
         ${row("CAND2", `Candidate2-${run}@Gmail.test`, "SD", "GI")}`);
    sql(`insert into public.employee_role_overrides (app_user_id, external_employee_id, locked_role, locked_scope_level, reason, set_by)
         values ('${ids.protectedAdmin}', '${employee("OWNER")}', 'admin', 'global', 'Protected owner', 'test')`);
    sql(`insert into public.employee_sync_runs (requested_by, source_mode, status, employees_active, finished_at)
         values ('cron', 'scheduled_poll', 'succeeded', 4, now())`);
  });

  it("re-applying the migration is idempotent and backfills: override → linked (flags off); no-match → not Woven-managed; email match → unclassified", () => {
    /*
     * Re-apply this migration AND every later one, in order, twice: re-running
     * this one alone would also revoke the column grants later migrations add
     * (its explicit `revoke all ... from service_role`), which is not a state
     * the project is ever in. Doing it in order also proves the later
     * migrations are idempotent.
     */
    const later = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql") && name > MIGRATION.split("/").pop()!)
      .sort()
      .map((name) => `supabase/migrations/${name}`);
    for (let i = 0; i < 2; i += 1) {
      for (const file of [MIGRATION, ...later]) {
        execFileSync("psql", [PG.replace("supabase_admin@", "postgres:postgres@"), "-q", "-v", "ON_ERROR_STOP=1", "-1", "-f", file]);
      }
    }
    const link = (id: string) =>
      sql(`select management||','||coalesce(external_employee_id,'-')||','||link_method||','||managed_status||managed_location||managed_role from public.employee_account_links where app_user_id = '${id}'`);
    expect(link(ids.protectedAdmin)).toBe(`woven_linked,${employee("OWNER")},override_backfill,falsefalsefalse`);
    expect(link(ids.unmatched)).toBe("not_woven_managed,-,unmatched_backfill,falsefalsefalse");
    expect(link(ids.candidate)).toBe("");
    expect(link(ids.linkedSd)).toBe("");
    /* Re-running 20261007001000 logs no phantom switch change: its seed row is logged exactly once. */
    expect(sql(`select count(*) from public.employee_access_control_changes where changed_by = 'migration:20261007001000'`)).toBe("1");
  });

  it("the link constraints refuse ambiguity", () => {
    const linkedSdLink = `insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, managed_status, managed_location, managed_role, set_by)
      values ('${ids.linkedSd}', 'woven_linked', '${employee("LINKED")}', 'admin_confirmed_email', true, true, true, 'test')`;
    expect(sqlFails(linkedSdLink)).toBeNull();
    /* The same Woven employee can never be linked to a second account. */
    expect(sqlFails(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by)
      values ('${ids.candidate}', 'woven_linked', '${employee("LINKED")}', 'admin_manual', 'test')`)).toMatch(/one_account_per_employee/);
    /* Linked must name an employee; not-managed may manage nothing. */
    expect(sqlFails(`insert into public.employee_account_links (app_user_id, management, link_method, set_by)
      values ('${ids.candidate}', 'woven_linked', 'admin_manual', 'test')`)).toMatch(/linked_names_employee/);
    expect(sqlFails(`insert into public.employee_account_links (app_user_id, management, link_method, managed_status, set_by)
      values ('${ids.candidate}', 'not_woven_managed', 'admin_manual', true, 'test')`)).toMatch(/unmanaged_manages_nothing/);
    /* A linked account cannot be deleted out from under its history. */
    expect(sqlFails(`delete from public.app_users where id = '${ids.linkedSd}'`)).toMatch(/foreign key|violates/i);
  });

  it("the browser roles can read none of it, even signed in", async () => {
    const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
    for (const table of ["employee_account_links", "employee_access_accounts", "employee_access_runs", "employee_access_actions"]) {
      const { error } = await anon.from(table).select("*").limit(1);
      expect(error, table).not.toBeNull();
    }
    const asAnon = await anon.rpc("employee_access_record_shadow_run", {
      p_requested_by: "x", p_directory_run_id: null, p_policy_version: "x", p_guard_codes: [], p_counts: {}, p_actions: [],
    });
    expect(asAnon.error).not.toBeNull();
    for (const table of ["employee_account_links", "employee_access_accounts", "employee_access_runs", "employee_access_actions"]) {
      expect(sql(`select has_table_privilege('authenticated', 'public.${table}', 'SELECT')`), table).toBe("f");
    }
  });

  it("the planner plans from the real view: link review, create, location update, protected — and changes nothing", async () => {
    const before = fingerprint();
    const { loadAccessPlan } = await import("./load");
    const plan = await loadAccessPlan();
    const of = (suffix: string) => plan.rows.find((r) => r.externalEmployeeId === employee(suffix))!;
    expect(of("CAND").actions).toEqual(["FLAG_LINK_REVIEW"]);
    expect(of("NEWSD").actions).toEqual(["CREATE_USER"]);
    expect(of("LINKED").actions).toEqual(["UPDATE_PRIMARY_LOCATION"]);
    expect(of("LINKED").after).toEqual({ scope_primary_area_id: "loc-0394" });
    expect(of("OWNER").actions).toEqual(["FLAG_PROTECTED_ACCOUNT"]);
    expect(plan.rows.find((r) => r.appUserId === ids.unmatched)?.actions).toEqual(["FLAG_NOT_WOVEN_MANAGED"]);
    expect(fingerprint()).toBe(before);
  });

  it("shadow mode records one run and its actions, applies nothing, and is append-only", async () => {
    const before = fingerprint();
    const runsBefore = Number(sql("select count(*) from public.employee_access_runs"));
    const { recordAccessShadowRun } = await import("./shadow");

    process.env.WOVEN_ACCESS_MODE = "off";
    expect(await recordAccessShadowRun("test")).toEqual({ status: "off" });
    expect(Number(sql("select count(*) from public.employee_access_runs"))).toBe(runsBefore);

    process.env.WOVEN_ACCESS_MODE = "shadow";
    const outcome = await recordAccessShadowRun("test");
    expect(outcome.status).toBe("recorded");
    const runId = outcome.status === "recorded" ? outcome.accessRunId : "";
    expect(sql(`select mode||','||policy_version from public.employee_access_runs where id = '${runId}'`)).toBe("shadow,access-policy-1");
    expect(sql(`select string_agg(distinct result, ',') from public.employee_access_actions where access_run_id = '${runId}'`)).toBe("shadow");
    expect(Number(sql(`select count(*) from public.employee_access_actions where access_run_id = '${runId}' and action = 'CREATE_USER'`))).toBeGreaterThanOrEqual(1);
    expect(fingerprint()).toBe(before);

    expect(sqlFails(`update public.employee_access_actions set result = 'shadow' where access_run_id = '${runId}'`)).toMatch(/append-only/);
    expect(sqlFails(`delete from public.employee_access_runs where id = '${runId}'`)).toMatch(/append-only/);
    process.env.WOVEN_ACCESS_MODE = "off";
  });

  it("two concurrent shadow recordings both complete, separately, and still change no account", async () => {
    const before = fingerprint();
    process.env.WOVEN_ACCESS_MODE = "shadow";
    const { recordAccessShadowRun } = await import("./shadow");
    const [a, b] = await Promise.all([recordAccessShadowRun("one"), recordAccessShadowRun("two")]);
    expect([a.status, b.status]).toEqual(["recorded", "recorded"]);
    if (a.status === "recorded" && b.status === "recorded") {
      expect(a.accessRunId).not.toBe(b.accessRunId);
      const counts = sql(`select string_agg(n::text, ',') from (select count(*) n from public.employee_access_actions where access_run_id in ('${a.accessRunId}', '${b.accessRunId}') group by access_run_id) x`);
      const [x, y] = counts.split(",");
      expect(x).toBe(y);
    }
    expect(fingerprint()).toBe(before);
    process.env.WOVEN_ACCESS_MODE = "off";
  });

  it("25. a recording that fails midway leaves nothing behind — run and actions are one transaction", () => {
    const runs = Number(sql("select count(*) from public.employee_access_runs"));
    const actions = Number(sql("select count(*) from public.employee_access_actions"));
    const bad = JSON.stringify([
      { external_employee_id: "OK-1", action: "NO_CHANGE", is_primary: true, reason_codes: [] },
      { external_employee_id: "BAD-2", action: "DELETE_EVERYONE", is_primary: true, reason_codes: [] },
    ]).replace(/'/g, "''");
    expect(sqlFails(`select public.employee_access_record_shadow_run('test', null, 'access-policy-1', '{}', '{}'::jsonb, '${bad}'::jsonb)`)).toMatch(/check constraint/);
    expect(Number(sql("select count(*) from public.employee_access_runs"))).toBe(runs);
    expect(Number(sql("select count(*) from public.employee_access_actions"))).toBe(actions);
  });

  it("LINK REVIEW: confirming an exact-email match stores a durable link; the account is then found by EmployeeID, never by email", async () => {
    const before = fingerprint();
    const { recordLinkReview } = await import("./link-store");
    const { loadAccessPlan } = await import("./load");
    const { LinkReviewError } = await import("./link-review");

    const pendingBefore = (await loadAccessPlan()).rows.filter((r) => r.actions.includes("FLAG_LINK_REVIEW")).map((r) => r.externalEmployeeId);
    expect(pendingBefore).toEqual(expect.arrayContaining([employee("CAND"), employee("CAND2")]));

    const link = await recordLinkReview(
      { appUserId: ids.candidate, externalEmployeeId: employee("CAND"), decision: "confirm", managedStatus: true, managedLocation: true, managedRole: true },
      "admin:test",
    );
    expect(link).toMatchObject({ management: "woven_linked", link_method: "admin_confirmed_email", managed_status: true, managed_location: true, managed_role: true });
    expect(sql(`select management||','||external_employee_id||','||link_method||','||set_by from public.employee_account_links where app_user_id = '${ids.candidate}'`)).toBe(
      `woven_linked,${employee("CAND")},admin_confirmed_email,admin:test`,
    );

    const after = await loadAccessPlan();
    const cand = after.rows.find((r) => r.externalEmployeeId === employee("CAND"))!;
    expect(cand.account).toMatchObject({ appUserId: ids.candidate, via: "link" });
    expect(cand.actions).not.toContain("FLAG_LINK_REVIEW");

    /* The same review again is refused: it is no longer pending. */
    await expect(
      recordLinkReview({ appUserId: ids.candidate, externalEmployeeId: employee("CAND"), decision: "confirm", managedStatus: false, managedLocation: false, managedRole: false }, "admin:test"),
    ).rejects.toBeInstanceOf(LinkReviewError);
    /* Linking changed no account. */
    expect(fingerprint()).toBe(before);
  });

  it("LINK REVIEW: two admins confirming the same match at once — exactly one link is stored; a DM's location/role flags stay off", async () => {
    const { recordLinkReview } = await import("./link-store");
    const attempt = () =>
      recordLinkReview(
        { appUserId: ids.candidate2, externalEmployeeId: employee("CAND2"), decision: "confirm", managedStatus: false, managedLocation: true, managedRole: true },
        "admin:race",
      ).then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "error",
      );
    const results = (await Promise.all([attempt(), attempt()])).sort();
    expect(results[1]).toBe("ok");
    expect(["already_linked", "not_pending", "ok"]).toContain(results[0]);
    expect(Number(sql(`select count(*) from public.employee_account_links where app_user_id = '${ids.candidate2}'`))).toBe(1);
    expect(sql(`select managed_location::text||managed_role::text from public.employee_account_links where app_user_id = '${ids.candidate2}'`)).toBe("falsefalse");
  });

  it("PRIVILEGES ARE EXPLICIT: besides the owner, only service_role holds exactly what the server needs — nothing inherited", () => {
    const tableGrants = (relation: string) =>
      sql(`select coalesce(string_agg(g, ',' order by g), '') from (
             select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type as g
             from pg_class c, aclexplode(c.relacl) a
             where c.oid = 'public.${relation}'::regclass and a.grantee <> c.relowner) x`);
    const functionGrants = (signature: string) =>
      sql(`select coalesce(string_agg(g, ',' order by g), '') from (
             select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type as g
             from pg_proc p, aclexplode(p.proacl) a
             where p.oid = 'public.${signature}'::regprocedure and a.grantee <> p.proowner) x`);

    expect(tableGrants("employee_account_links")).toBe("service_role:INSERT,service_role:SELECT");
    expect(tableGrants("employee_access_runs")).toBe("service_role:INSERT,service_role:SELECT");
    expect(tableGrants("employee_access_actions")).toBe("service_role:INSERT,service_role:SELECT");
    expect(tableGrants("employee_access_accounts")).toBe("service_role:SELECT");
    expect(functionGrants("employee_access_record_shadow_run(text, uuid, text, text[], jsonb, jsonb)")).toBe("service_role:EXECUTE");
    expect(functionGrants("employee_access_actions_guard()")).toBe("");
    /* Migration 1's session function too. */
    expect(functionGrants("auth_revoke_user_sessions(uuid)")).toBe("service_role:EXECUTE");

    for (const relation of ["employee_account_links", "employee_access_runs", "employee_access_actions"]) {
      expect(sql(`select relrowsecurity::text || relforcerowsecurity::text from pg_class where oid = 'public.${relation}'::regclass`), relation).toBe("truetrue");
      expect(sql(`select count(*) from pg_policies where schemaname = 'public' and tablename = '${relation}'`), relation).toBe("0");
    }
  });

  it("service_role can do exactly that: no UPDATE, DELETE or TRUNCATE on links or the shadow record", async () => {
    const asService = (statement: string) => sqlFails(`begin; set local role service_role; ${statement}; rollback;`);
    expect(asService("select count(*) from public.employee_access_accounts")).toBeNull();
    expect(asService("select count(*) from public.employee_account_links")).toBeNull();
    expect(asService("select count(*) from public.employee_access_runs")).toBeNull();
    for (const statement of [
      "update public.employee_account_links set reason = 'x'",
      "delete from public.employee_account_links",
      "truncate public.employee_access_actions",
      "truncate public.employee_access_runs",
      "insert into public.employee_access_accounts (app_user_id) values (gen_random_uuid())",
    ]) {
      expect(asService(statement), statement).toMatch(/permission denied|cannot insert into view/);
    }
    /* And through the real API with the service key: a delete is refused. */
    const service = createClient(URL_, SERVICE, { auth: { persistSession: false } });
    const { error } = await service.from("employee_account_links").delete().eq("app_user_id", ids.protectedAdmin);
    expect(error?.message ?? "").toMatch(/permission denied/);
    expect(sql(`select count(*) from public.employee_account_links where app_user_id = '${ids.protectedAdmin}'`)).toBe("1");
  });

  it("the shadow recorder still records only shadow; apply runs exist only for DISABLE_TERMINATED (migration 20261007001000)", () => {
    /* Only the two modes exist. */
    expect(sqlFails(`insert into public.employee_access_runs (mode, requested_by, policy_version, status) values ('bulk', 'x', 'p', 'completed')`)).toMatch(
      /check constraint/,
    );
    /* The shadow recorder itself never writes anything but 'shadow'. */
    expect(readFileSync(MIGRATION, "utf8")).not.toMatch(/'applied'/);
    expect(sql(`select position('applied' in pg_get_functiondef('public.employee_access_record_shadow_run(text, uuid, text, text[], jsonb, jsonb)'::regprocedure))`)).toBe("0");
    /* The only apply action the database knows. */
    expect(sql(`select string_agg(action, ',') from public.employee_access_controls`)).toBe("DISABLE_TERMINATED");
    void randomUUID;
  });
});
