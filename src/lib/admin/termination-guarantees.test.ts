import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guarantees for DISABLE_TERMINATED, the one Woven apply action. Behaviour on
 * real Postgres and Supabase Auth is proven in termination.local-stack.test.ts;
 * these pin the shapes that keep it narrow, off by default, and non-destructive.
 */

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const EXECUTOR = strip(readFileSync("src/lib/admin/woven-termination.ts", "utf8"));
const HISTORY = strip(readFileSync("src/lib/admin/woven-apply-history.ts", "utf8"));
const CRON = strip(readFileSync("src/app/api/employees/woven/cron/route.ts", "utf8"));
const TEST_ROUTE = strip(readFileSync("src/app/api/admin/employees/woven/apply/test-termination/route.ts", "utf8"));
const MIGRATION = readFileSync("supabase/migrations/20261007001000_woven_disable_terminated_apply.sql", "utf8").replace(/--.*$/gm, "");

describe("the switch", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/supabase/server");
    delete process.env.WOVEN_APPLY_ACTIONS;
  });

  it("key 1 is an explicit allowlist: only DISABLE_TERMINATED, exactly", async () => {
    const { envAllowsDisableTerminated } = await import("./woven-termination");
    expect(envAllowsDisableTerminated({})).toBe(false);
    expect(envAllowsDisableTerminated({ WOVEN_APPLY_ACTIONS: "" })).toBe(false);
    expect(envAllowsDisableTerminated({ WOVEN_APPLY_ACTIONS: "true" })).toBe(false);
    expect(envAllowsDisableTerminated({ WOVEN_APPLY_ACTIONS: "apply" })).toBe(false);
    expect(envAllowsDisableTerminated({ WOVEN_APPLY_ACTIONS: "DISABLE_TERMINATE" })).toBe(false);
    expect(envAllowsDisableTerminated({ WOVEN_APPLY_ACTIONS: "DISABLE_TERMINATED" })).toBe(true);
    expect(envAllowsDisableTerminated({ WOVEN_APPLY_ACTIONS: " disable_terminated , OTHER" })).toBe(true);
  });

  it("with key 1 off, the scheduled run touches nothing — not even the database", async () => {
    const touched: string[] = [];
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      getSupabaseAdmin: () => {
        touched.push("db");
        throw new Error("must not be reached");
      },
    }));
    const { applyDisableTerminated } = await import("./woven-termination");
    expect(await applyDisableTerminated({ source: "cron" })).toEqual({ status: "off", reason: "env_switch_off" });
    expect(touched).toEqual([]);
  });

  it("with key 1 on and the owner's switch off, it reads the switch and stops", async () => {
    process.env.WOVEN_APPLY_ACTIONS = "DISABLE_TERMINATED";
    const tables: string[] = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { enabled: false, max_per_run: 3 }, error: null }),
    };
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      getSupabaseAdmin: () => ({
        from: (table: string) => {
          tables.push(table);
          return chain;
        },
        rpc: () => {
          throw new Error("must not be reached");
        },
      }),
    }));
    const { applyDisableTerminated } = await import("./woven-termination");
    expect(await applyDisableTerminated({ source: "cron" })).toEqual({ status: "off", reason: "control_off" });
    expect(tables).toEqual(["employee_access_controls"]);
  });
});

describe("the executor stays narrow", () => {
  it("revokes only through the hardened admin path, and only ever to disabled", () => {
    expect([...EXECUTOR.matchAll(/patchUser\(([^)]*)\)/g)].map((m) => m[1]!.replace(/\s+/g, " "))).toEqual([
      'row.appUserId!, { status: "disabled" }, WOVEN_TERMINATION_ACTOR',
    ]);
    expect(EXECUTOR).not.toMatch(/restoreAuthAccess|revokeAuthAccess|\.auth\s*\.|status:\s*"active"/);
  });

  it("deletes nothing, and writes only the link's revocation fields", () => {
    expect(EXECUTOR).not.toMatch(/\.delete\(|\.upsert\(|\.insert\(/);
    const updates = [...EXECUTOR.matchAll(/from\(\s*"([a-z_]+)"\s*\)\s*\.update\(\s*\{([^}]*)\}/g)];
    expect(updates.map((m) => m[1])).toEqual(["employee_account_links"]);
    expect(updates[0]![2]!.split(",").map((p) => p.split(":")[0]!.trim()).filter(Boolean).sort()).toEqual([
      "access_revoked_at",
      "revoked_woven_status",
      "terminated_at",
    ]);
    expect(EXECUTOR).toMatch(/\.is\("access_revoked_at", null\)/);
  });

  it("reads only what it needs and calls only its own database functions", () => {
    expect(new Set([...EXECUTOR.matchAll(/\.from\(\s*"([a-z_]+)"/g)].map((m) => m[1]))).toEqual(
      new Set(["employee_access_controls", "employee_access_accounts", "employee_access_directory", "employee_account_links"]),
    );
    expect(new Set([...EXECUTOR.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]))).toEqual(
      new Set(["employee_access_record_apply_run", "employee_access_claim_operation", "employee_access_finish_operation"]),
    );
  });

  it("the scheduled run checks BOTH keys before it plans anything", () => {
    const body = EXECUTOR.slice(EXECUTOR.indexOf("export async function applyDisableTerminated("));
    const plan = body.indexOf("loadAccessPlan(");
    expect(body.indexOf("envAllowsDisableTerminated()")).toBeGreaterThan(-1);
    expect(body.indexOf("envAllowsDisableTerminated()")).toBeLessThan(plan);
    expect(body.indexOf("control.enabled")).toBeLessThan(plan);
  });

  it("re-checks every account immediately before acting, and again while holding its claim", () => {
    const body = EXECUTOR.slice(EXECUTOR.indexOf("async function disableOne("));
    const checks = [...body.matchAll(/verifyStillTerminated\(row, latestRunId\)/g)].map((m) => m.index!);
    expect(checks).toHaveLength(2);
    expect(checks[0]!).toBeLessThan(body.indexOf("employee_access_claim_operation"));
    expect(checks[1]!).toBeGreaterThan(body.indexOf("employee_access_claim_operation"));
    expect(checks[1]!).toBeLessThan(body.indexOf("patchUser("));
  });

  it("the re-check refuses protected, unmanaged, already-revoked, and not-terminated-in-the-latest-read accounts", () => {
    const body = EXECUTOR.slice(EXECUTOR.indexOf("export async function verifyStillTerminated("), EXECUTOR.indexOf("async function recordRun("));
    for (const reason of [
      "not_linked_to_this_employee",
      "status_not_woven_managed",
      "protected_account",
      "access_already_revoked",
      "not_terminated_in_woven",
      "not_read_in_latest_run",
    ]) {
      expect(body, reason).toContain(`"${reason}"`);
    }
    expect(body).toMatch(/Number\(e\.missing_sync_count\) !== 0 \|\| e\.last_seen_run_id !== latestRunId/);
  });

  it("the test entry acts only on disposable test employees", () => {
    expect(EXECUTOR).toMatch(/TEST_EMPLOYEE_PREFIX = "ASK-SUNNY-TEST-"/);
    const body = EXECUTOR.slice(EXECUTOR.indexOf("export async function applyDisableTerminatedForTestAccount("));
    expect(body.indexOf("startsWith(TEST_EMPLOYEE_PREFIX)")).toBeLessThan(body.indexOf("applyDisableTerminated("));
  });

  it("the history reader only reads", () => {
    expect(HISTORY).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.upsert\(|\.rpc\(/);
  });
});

describe("routes", () => {
  it("the cron calls it only after a successful directory sync, and only as the scheduled source", () => {
    expect(CRON).toMatch(/outcome\.status === "succeeded" \? await applyDisableTerminated\(\{ source: "cron" \}\)/);
    expect([...CRON.matchAll(/applyDisableTerminated\(/g)]).toHaveLength(1);
  });

  it("the test route requires both permissions, live mode, the rate limit and an explicit confirmation", () => {
    expect(TEST_ROUTE).toMatch(/authorizeWovenPeopleRequest\(request\)/);
    expect(TEST_ROUTE).toMatch(/assertLiveMode\(\)/);
    expect(TEST_ROUTE).toMatch(/assertWithinRateLimit\(request, "mutate"\)/);
    expect(TEST_ROUTE).toMatch(/body\.confirm !== true/);
    expect(TEST_ROUTE).toMatch(/applyDisableTerminatedForTestAccount\(/);
    expect(TEST_ROUTE).not.toMatch(/applyDisableTerminated\(\{/);
  });
});

describe("migration 20261007001000", () => {
  it("seeds the switch OFF, and the server may only read it", () => {
    expect(MIGRATION).toMatch(/values \('DISABLE_TERMINATED', false, 3,/);
    expect(MIGRATION).toMatch(/grant select on public\.employee_access_controls to service_role;/);
    expect(MIGRATION).not.toMatch(/grant [^;]*(insert|update|delete|all)[^;]* on public\.employee_access_controls/i);
  });

  it("grants exactly: reads, the three functions, and UPDATE on the three revocation columns — nothing to a browser role", () => {
    const grants = [...MIGRATION.matchAll(/grant\s+([^;]+?)\s+to\s+([a-z_]+)\s*;/gi)].map((m) => `${m[1]!.replace(/\s+/g, " ").trim()} → ${m[2]}`);
    expect(grants.sort()).toEqual(
      [
        "select on public.employee_access_controls → service_role",
        "select on public.employee_access_control_changes → service_role",
        "select on public.employee_access_operations → service_role",
        "execute on function public.employee_access_claim_operation(text, uuid, text, text) → service_role",
        "execute on function public.employee_access_finish_operation(uuid, text, jsonb, text, text) → service_role",
        "update (terminated_at, access_revoked_at, revoked_woven_status) on public.employee_account_links → service_role",
        "execute on function public.employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb) → service_role",
      ].sort(),
    );
  });

  it("revocation fields are write-once, and the operations ledger allows one open attempt per account", () => {
    expect(MIGRATION).toMatch(/revocation fields are write-once/);
    expect(MIGRATION).toMatch(/create unique index if not exists employee_access_operations_one_open\s+on public\.employee_access_operations \(action, app_user_id\) where status = 'pending'/);
  });

  it("knows only DISABLE_TERMINATED, never writes app_users or auth, and never deletes", () => {
    expect(MIGRATION).toMatch(/check \(action in \('DISABLE_TERMINATED'\)\)/);
    expect(MIGRATION).not.toMatch(/(insert into|update|delete from)\s+(public\.)?app_users\b/i);
    expect(MIGRATION).not.toMatch(/(insert into|update|delete from)\s+auth\./i);
    expect(MIGRATION).not.toMatch(/\bdelete from\b/i);
  });

  it("a shadow run can hold only shadow results and an apply run never does", () => {
    expect(MIGRATION).toMatch(/if \(v_mode = 'shadow'\) <> \(new\.result = 'shadow'\) then/);
  });
});
