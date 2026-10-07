import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WovenClient } from "./client";
import { readWovenConfig } from "./config";
import { statusResolver, parseEnums } from "./enums";
import { MemoryDirectoryStore } from "./memory-store";
import { normalizeEmployee } from "./normalize";
import type { CommitInput } from "./store";
import { runWovenEmployeeSync } from "./sync";
import { createFakeWoven, FAKE_CREDENTIALS, FAKE_ENUMS, wovenDetails, wovenEmployee, wovenLocation } from "./test-support";

/**
 * ============================================================================
 * THE PHASE-ONE GUARANTEES, PINNED BEFORE THE FIRST STORED SYNC
 * ============================================================================
 *
 * The second Production dry run found 16 employees Woven calls Active (Status
 * 1) with a past TerminationDate, TerminationType 0, no last day worked and no
 * rehire-shaped hire date. These tests pin what a stored sync does with that
 * shape — and with every termination field populated — end to end through the
 * real sync and client. The SQL side (mappings never overwritten, app_users
 * byte-for-byte unchanged) is `scripts/verify-woven-migration.mjs`.
 */

const CONFIG = readWovenConfig({
  WOVEN_SYNC_ENABLED: "true",
  WOVEN_SYNC_WRITES_ENABLED: "true",
  WOVEN_SUBSCRIPTION_KEY: FAKE_CREDENTIALS.subscriptionKey,
  WOVEN_USERNAME: FAKE_CREDENTIALS.username,
  WOVEN_PASSWORD: FAKE_CREDENTIALS.password,
});
const NOW = () => new Date("2026-09-29T12:00:00Z");

/** The live EmployeeStatus enum (1 Active, 2 Terminated, 10 Vendor, 100 Active Hidden) plus the fixture's TerminationType. */
const LIVE_ENUMS = [
  { EnumerationName: "EmployeeStatus", PropertyName: "Active", PropertyDisplayName: "Active", PropertyValue: 1 },
  { EnumerationName: "EmployeeStatus", PropertyName: "Terminated", PropertyDisplayName: "Terminated", PropertyValue: 2 },
  { EnumerationName: "EmployeeStatus", PropertyName: "Vendor", PropertyDisplayName: "Vendor", PropertyValue: 10 },
  { EnumerationName: "EmployeeStatus", PropertyName: "ActiveHidden", PropertyDisplayName: "Active Hidden", PropertyValue: 100 },
  ...FAKE_ENUMS.filter((e) => e.EnumerationName !== "EmployeeStatus"),
];

/** A store that records every call and every commit payload. */
class RecordingStore extends MemoryDirectoryStore {
  readonly calls: string[] = [];
  readonly commits: CommitInput[] = [];
  override async claimRun(requestedBy: string) {
    this.calls.push("claimRun");
    return super.claimRun(requestedBy);
  }
  override async loadDirectory() {
    this.calls.push("loadDirectory");
    return super.loadDirectory();
  }
  override async loadLocationMap() {
    this.calls.push("loadLocationMap");
    return super.loadLocationMap();
  }
  override async loadPositionMap() {
    this.calls.push("loadPositionMap");
    return super.loadPositionMap();
  }
  override async commitRun(input: CommitInput) {
    this.calls.push("commitRun");
    this.commits.push(structuredClone(input));
    return super.commitRun(input);
  }
  override async abandonRun(input: Parameters<MemoryDirectoryStore["abandonRun"]>[0]) {
    this.calls.push("abandonRun");
    return super.abandonRun(input);
  }
}

/** The Production conflict shape: Active, past TerminationDate, TerminationType 0, no last day, hired long before. */
const conflict = (id: string) =>
  wovenEmployee(id, { status: 1, hireDate: "2021-04-05T00:00:00", startDate: null, terminationDate: "2024-08-01T00:00:00", terminationType: 0 });
/** Every termination field populated, Status still Active. */
const everyTerminationField = (id: string) =>
  wovenEmployee(id, { status: 1, terminationDate: "2026-09-01T00:00:00", lastDayWorked: "2026-08-31T00:00:00", terminationType: 2 });

function setup(employees: Record<string, unknown>[], details: Record<string, Record<string, unknown>> = {}) {
  const fake = createFakeWoven({
    employees,
    details,
    enums: LIVE_ENUMS,
    locations: [wovenLocation("WL-0306"), wovenLocation("WL-0144")],
    tokenLifetimeSeconds: 3600,
  });
  const store = new RecordingStore();
  const run = () =>
    runWovenEmployeeSync({
      requestedBy: "admin:owner@example.test",
      config: CONFIG,
      store,
      now: NOW,
      client: new WovenClient({ baseUrl: CONFIG.baseUrl, credentials: FAKE_CREDENTIALS, fetch: fake.fetch, sleep: async () => {} }),
    });
  return { fake, store, run };
}

async function stored(run: () => ReturnType<typeof runWovenEmployeeSync>) {
  const outcome = await run();
  if (outcome.status !== "succeeded") throw new Error(`expected success, got ${JSON.stringify(outcome)}`);
  return outcome.summary;
}

describe("1. terminated only when Woven's Status resolves to Terminated", () => {
  const statuses = statusResolver(parseEnums(LIVE_ENUMS));
  const today = "2026-09-29";

  it("resolves only the exact Terminated label to terminated; Vendor, Active Hidden, absent and unlisted are unknown", () => {
    expect(statuses.resolve(1)).toBe("active");
    expect(statuses.resolve(2)).toBe("terminated");
    expect(statuses.resolve(10)).toBe("unknown");
    expect(statuses.resolve(100)).toBe("unknown");
    expect(statuses.resolve(null)).toBe("unknown");
    expect(statuses.resolve(999)).toBe("unknown");
  });

  it("Status 1 with every termination field populated is still active", () => {
    const result = normalizeEmployee(everyTerminationField("2001"), { statuses, today });
    if (!result.ok) throw new Error("rejected");
    expect(result.employee.employmentStatus).toBe("active");
    expect(result.employee.issues).toContain("status_termination_conflict");
  });

  it("Status 2 with no termination fields at all is terminated", () => {
    const result = normalizeEmployee(wovenEmployee("2002", { status: 2 }), { statuses, today });
    if (!result.ok) throw new Error("rejected");
    expect(result.employee.employmentStatus).toBe("terminated");
  });
});

describe("2 and 3. termination fields alone never terminate, and the conflict is stored as Active with its flag", () => {
  it("stores the Production conflict shape as Active, keeps the flag, and records no termination — on two runs", async () => {
    const { store, run } = setup([conflict("3001"), everyTerminationField("3002"), wovenEmployee("3003")]);

    const first = await stored(run);
    expect(first.employeesActive).toBe(3);
    expect(first.employeesTerminated).toBe(0);
    expect(first.issueCounts.status_termination_conflict).toBe(2);
    expect(first.changesByKind.terminated).toBe(0);

    for (const id of ["3001", "3002"]) {
      expect(store.rows.get(id)!.employmentStatus).toBe("active");
      const write = store.commits[0]!.employees.find((w) => w.externalEmployeeId === id)!;
      expect(write.employmentStatus).toBe("active");
      expect(write.issues).toContain("status_termination_conflict");
    }
    expect(store.rows.get("3001")!.terminationTypeCode).toBe(0);
    expect(store.changes.every((c) => c.kind === "new_employee" && c.classification === "initial_load")).toBe(true);

    /* The same read again: nothing recorded, still Active, flag still sent. */
    const second = await stored(run);
    expect(Object.values(second.changesByKind).reduce((a, b) => a + b, 0)).toBe(0);
    expect(store.rows.get("3001")!.employmentStatus).toBe("active");
    expect(store.commits[1]!.employees.find((w) => w.externalEmployeeId === "3001")!.issues).toContain(
      "status_termination_conflict",
    );
    expect(store.changes.filter((c) => c.kind === "terminated")).toHaveLength(0);
  });

  it("an employee already on file who GAINS termination fields while Active records no termination", async () => {
    const employees = [wovenEmployee("3101")];
    const { store, run } = setup(employees);
    await stored(run);

    /* The fake Woven serves this same array, so the next read sees the new record. */
    employees[0] = everyTerminationField("3101");
    const later = await stored(run);
    expect(later.changesByKind.terminated).toBe(0);
    expect(store.rows.get("3101")!.employmentStatus).toBe("active");
    expect(store.changes.filter((c) => c.kind === "terminated")).toHaveLength(0);
  });

  it("only a Status change to Terminated records a termination", async () => {
    const employees = [wovenEmployee("3201")];
    const { store, run } = setup(employees);
    await stored(run);

    employees[0] = wovenEmployee("3201", { status: 2, terminationDate: "2026-09-20T00:00:00" });
    const later = await stored(run);
    expect(later.changesByKind.terminated).toBe(1);
    const change = store.changes.find((c) => c.kind === "terminated")!;
    /* Recorded only: the change itself says no access changed. */
    expect(change.details).toMatchObject({ accessChanged: false });
  });
});

describe("4. a stored sync writes only directory, history and mapping data", () => {
  it("calls nothing but the directory store: claim, three reads, one commit", async () => {
    const { store, run } = setup([conflict("4001"), wovenEmployee("4002", { hasMultipleLocationAccess: true })]);
    await stored(run);
    expect(store.calls).toEqual(["claimRun", "loadDirectory", "loadLocationMap", "loadPositionMap", "commitRun"]);
  });

  it("every Woven request is a GET, apart from the token request", async () => {
    const { fake, run } = setup([conflict("4101")]);
    await stored(run);
    const writes = fake.calls.filter((c) => c.method !== "GET" && !c.path.startsWith("/tokens"));
    expect(writes).toEqual([]);
  });

  it("the directory store has no method that reaches app_users, auth, roles, scope, salon access or login state", () => {
    const methods = Object.getOwnPropertyNames(MemoryDirectoryStore.prototype).filter((m) => m !== "constructor");
    for (const method of methods) expect(method).not.toMatch(/user|auth|role|scope|login|access|salon|invite|disable/i);
  });
});

describe("5 and 6. every location and position stays unmapped until a person reviews it", () => {
  it("queues the catalog, off-catalog affiliation locations and every position as unmapped, with no salon", async () => {
    const { store, run } = setup(
      [
        wovenEmployee("5001", { positionId: "POS-A" }),
        wovenEmployee("5002", { positionId: "POS-B", hasMultipleLocationAccess: true }),
        /* PositionName without a PositionID, as in Production. */
        wovenEmployee("5003", { positionId: null, positionName: "Floater" }),
      ],
      /* An affiliation location the catalog does not list, like `NE Omaha Q`. */
      { "5002": wovenDetails("5002", [{ id: "WL-0306" }, { id: "WL-OFFCAT", name: "Off-catalog location" }]) },
    );
    await stored(run);
    await stored(run);

    expect([...store.locationMap.keys()].sort()).toEqual(["WL-0144", "WL-0306", "WL-OFFCAT"]);
    for (const entry of store.locationMap.values()) {
      expect(entry.status).toBe("unmapped");
      expect(entry.salonId).toBeNull();
    }
    expect([...store.positionMap.keys()].sort()).toEqual(["POS-A", "POS-B"]);
    for (const entry of store.positionMap.values()) {
      expect(entry.status).toBe("unmapped");
      expect(entry.isConfirmed).toBe(false);
    }
    /* No position guessed from the PositionName. */
    expect(store.rows.get("5003")!.positionId).toBeNull();
    expect(store.changes.filter((c) => c.kind === "position_changed")).toHaveLength(0);
  });
});

describe("7. no employee-sync UI, route or library code can reach app_users, auth, roles, scope or salon access", () => {
  const ROOTS = [
    "src/lib/employees/woven",
    "src/app/api/admin/employees/woven",
    "src/app/api/employees/woven",
    "src/features/admin/woven",
    "src/app/(app)/admin/integrations/woven",
  ];
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
    });
  }
  const repo = join(__dirname, "..", "..", "..", "..");
  const files = ROOTS.flatMap((root) => sources(join(repo, root)));
  const code = (file: string) =>
    readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  /* The six sync tables, their five read-only views, and `salons` (read, to name a mapped location). */
  const TABLES = new Set([
    "employee_sync_runs", "employee_access_directory", "employee_location_affiliations",
    "employee_directory_changes", "woven_location_map", "woven_position_map",
    "employee_sync_status", "employee_sync_run_summary", "employee_directory_view",
    "employee_directory_login_matches", "employee_access_preview", "salons",
    /* The access planner (stage 1): accounts through a read-only VIEW, the links, and the shadow record. */
    "employee_access_accounts", "employee_account_links", "employee_access_runs", "employee_access_actions",
  ]);
  const RPCS = new Set([
    "employee_sync_claim_run", "employee_sync_commit_run", "employee_sync_abandon_run",
    "woven_location_map_review", "woven_position_map_review",
    /* Writes ONLY employee_access_runs / employee_access_actions, mode shadow (asserted below against the SQL). */
    "employee_access_record_shadow_run",
    /* The account lifecycle (stage 5, `access/apply.ts`): each re-checks its own facts; asserted in section 9. */
    "employee_access_begin_apply_run", "employee_access_finish_apply_run", "employee_access_record_apply_actions",
    "employee_access_auth_user_by_email", "employee_access_auth_only_accounts", "employee_access_provision_account", "employee_access_link_existing",
    "employee_access_record_invite", "employee_access_disable_terminated", "employee_access_record_revocation",
  ]);
  /* The only two files that may reach the Auth Admin API: the lifecycle engine and its real wiring. Section 9 bounds them. */
  const LIFECYCLE_FILES = [join("access", "apply.ts"), join("access", "apply-run.ts")];
  const isLifecycleFile = (file: string) => LIFECYCLE_FILES.some((f) => file.endsWith(f));

  it("covers the whole employee-sync surface", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.endsWith(join("sync", "route.ts")))).toBe(true);
    expect(files.some((f) => f.endsWith("sync-panel.tsx"))).toBe(true);
  });

  it("every table read or written is an employee-sync table or view (or a read of salons)", () => {
    for (const file of files) {
      for (const [, table] of code(file).matchAll(/\.from\(\s*["'`]([^"'`]+)["'`]/g)) expect(TABLES, `${file}: ${table}`).toContain(table);
    }
  });

  it("every database function called is an employee-sync function", () => {
    for (const file of files) {
      for (const [, fn] of code(file).matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g)) expect(RPCS, `${file}: ${fn}`).toContain(fn);
    }
  });

  it("no auth client outside the lifecycle engine, and the only direct write is a person's change review", () => {
    const writers: string[] = [];
    for (const file of files) {
      const c = code(file);
      expect(c, file).not.toMatch(/app_user_audit|from\(\s*["'`]app_users/);
      if (!isLifecycleFile(file)) expect(c, file).not.toMatch(/\.auth\s*\.|auth\.admin/);
      /* A Supabase write verb on a query chain (not crypto's hash.update). */
      for (const m of c.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\)\s*\.(insert|update|upsert|delete)\(/g)) writers.push(`${m[1]}.${m[2]}`);
    }
    /* A person's change review, and a person's link review (stage 2) — nothing else. */
    expect(writers.sort()).toEqual(["employee_account_links.insert", "employee_directory_changes.update"]);
  });

  it("salons is only ever read", () => {
    for (const file of files) {
      for (const m of code(file).matchAll(/\.from\(\s*["'`]salons["'`]\)\s*\.(\w+)\(/g)) expect(m[1], file).toBe("select");
    }
  });
});

describe("8. the access planner (stage 1) applies nothing — only the lifecycle engine (section 9) acts", () => {
  const repo = join(__dirname, "..", "..", "..", "..");
  const SQL = readFileSync(join(repo, "supabase/migrations/20261002002000_woven_account_links.sql"), "utf8");
  const fn = SQL.slice(SQL.indexOf("create or replace function public.employee_access_record_shadow_run"));
  const body = fn.slice(0, fn.indexOf("$$;"));

  it("the shadow recorder writes only the two access-record tables, and records only shadow", () => {
    const writes = [...body.matchAll(/\b(insert into|update|delete from)\s+public\.([a-z_]+)/gi)].map((m) => m[2]);
    expect([...new Set(writes)].sort()).toEqual(["employee_access_actions", "employee_access_runs"]);
    expect(body).not.toMatch(/app_users|auth\.|employee_account_links|app_user_audit/);
    expect(body).toMatch(/'shadow'/);
    expect(SQL).toMatch(/mode\s+text not null check \(mode in \('shadow'\)\)/);
    expect(SQL).toMatch(/result\s+text not null check \(result in \('shadow'\)\)/);
  });

  it("the migration never writes app_users or auth, and its only data change is the link backfill", () => {
    const code = SQL.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/(insert into|update|delete from)\s+(public\.)?app_users\b/i);
    expect(code).not.toMatch(/(insert into|update|delete from)\s+auth\./i);
    const inserts = [...code.matchAll(/insert into public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(inserts.filter((t) => t !== "employee_access_runs" && t !== "employee_access_actions")).toEqual([
      "employee_account_links",
      "employee_account_links",
    ]);
  });

  it("the backfill links only protected overrides (every managed flag off) and marks only unmatched accounts not-Woven-managed", () => {
    const backfill = SQL.slice(SQL.indexOf("-- -------------------------------------------------------------- backfill ---"));
    expect(backfill).toMatch(/'woven_linked', o\.external_employee_id, 'override_backfill'/);
    expect(backfill).not.toMatch(/managed_(status|location|role)/);
    expect(backfill).toMatch(/'not_woven_managed', 'unmatched_backfill'/);
    expect(backfill).toMatch(/not exists \(\s*select 1 from public\.employee_access_directory d/);
  });

  it("no access-planner module calls the auth API or names app_users; only link-store.ts writes, and only a link", () => {
    const dir = join(repo, "src/lib/employees/woven/access");
    for (const name of readdirSync(dir).filter((n) => /\.ts$/.test(n) && !/\.test\./.test(n) && n !== "apply.ts" && n !== "apply-run.ts")) {
      const code = readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, name).not.toMatch(/\.auth\s*\.|auth\.admin|from\(\s*["'`]app_users|revokeAuthAccess|restoreAuthAccess/);
      /* The one write: link-store.ts records a person's link review. */
      const writes = [...code.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\)\s*\.(insert|update|upsert|delete)\(/g)].map((m) => `${m[1]}.${m[2]}`);
      expect(writes, name).toEqual(name === "link-store.ts" ? ["employee_account_links.insert"] : []);
    }
  });

  it("every new object revokes ALL from service_role too, then grants it exactly what the server needs — no inherited default privileges", () => {
    const code = SQL.replace(/--.*$/gm, "");
    for (const relation of ["employee_account_links", "employee_access_runs", "employee_access_actions", "employee_access_accounts"]) {
      expect(code, relation).toMatch(new RegExp(`revoke all on public\\.${relation} from public, anon, authenticated, service_role;`));
    }
    const grants = [...code.matchAll(/grant ([a-z, ]+) on (?:function )?public\.([a-z_]+)[^;]* to ([a-z_, ]+);/g)].map((m) => `${m[2]}:${m[1]}:${m[3]}`);
    expect(grants.sort()).toEqual([
      "employee_access_accounts:select:service_role",
      "employee_access_actions:select, insert:service_role",
      "employee_access_record_shadow_run:execute:service_role",
      "employee_access_runs:select, insert:service_role",
      "employee_account_links:select, insert:service_role",
    ]);
    expect(code).not.toMatch(/grant [^;]*(update|delete|truncate|all)[^;]* to/i);
    expect(code).toMatch(/revoke all on function public\.employee_access_actions_guard\(\) from public, anon, authenticated, service_role;/);
  });

  it("the access mode's only applying value is bounded to the three lifecycle actions", () => {
    const config = readFileSync(join(repo, "src/lib/employees/woven/access/config.ts"), "utf8");
    expect(config).toMatch(/export type WovenAccessMode = "off" \| "shadow" \| "apply";/);
    const types = readFileSync(join(repo, "src/lib/employees/woven/access/types.ts"), "utf8");
    expect(types).toMatch(/export const LIFECYCLE_ACTIONS = \["CREATE_USER", "LINK_EXISTING", "DISABLE_TERMINATED"\] as const/);
  });
});

describe("9. the account lifecycle (stage 5): create + invite, link, revoke — and nothing else", () => {
  const repo = join(__dirname, "..", "..", "..", "..");
  const SQL = readFileSync(join(repo, "supabase/migrations/20261006002000_woven_account_lifecycle.sql"), "utf8");
  const sqlCode = SQL.replace(/--.*$/gm, "");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const apply = strip(readFileSync(join(repo, "src/lib/employees/woven/access/apply.ts"), "utf8"));
  const applyRun = strip(readFileSync(join(repo, "src/lib/employees/woven/access/apply-run.ts"), "utf8"));
  const fnBody = (name: string) => {
    const from = sqlCode.indexOf(`create or replace function public.${name}(`);
    expect(from, name).toBeGreaterThan(-1);
    const body = sqlCode.slice(from);
    return body.slice(0, body.indexOf("$$;"));
  };

  it("no password is ever set, read, stored or emailed by the lifecycle code", () => {
    for (const c of [apply, applyRun]) {
      expect(c).not.toMatch(/password/i);
      expect(c).not.toMatch(/generateLink|deleteUser|updateUserById|resetPasswordForEmail/);
    }
    /* The three Auth Admin calls it may make, and createUser always unconfirmed. */
    const calls = [...applyRun.matchAll(/admin\.auth\.admin\.([a-zA-Z]+)\(/g)].map((m) => m[1]).sort();
    expect(calls).toEqual(["createUser", "getUserById", "inviteUserByEmail"]);
    expect(apply).toMatch(/email_confirm: false/);
  });

  it("the engine dispatches only lifecycle actions; role and salon changes are recorded as skipped", () => {
    expect(apply).toMatch(/if \(!isLifecycleAction\(primary\)\) \{[\s\S]*?"not_a_lifecycle_action"/);
    expect(apply).not.toMatch(/scope_primary_area_id"?\s*:\s*row\.after|p_role[^,]*row\.account/);
  });

  it("neither the scheduled sync nor the apply engine can reach the managed-flag writer (role/location can never be switched on by cron or apply)", () => {
    const cron = strip(readFileSync(join(repo, "src/app/api/employees/woven/cron/route.ts"), "utf8"));
    for (const [name, c] of [["apply.ts", apply], ["apply-run.ts", applyRun], ["cron/route.ts", cron]] as const) {
      expect(c, name).not.toMatch(/woven-managed-flags|managed-flags|links\/flags|managed_(role|location)\s*:\s*true/);
      expect(c, name).not.toMatch(/\.from\(\s*["'`]employee_account_links/);
    }
  });

  it("nothing in the migration deletes a row or writes auth", () => {
    expect(sqlCode).not.toMatch(/delete\s+from/i);
    expect(sqlCode).not.toMatch(/(insert into|update)\s+auth\./i);
    expect(sqlCode).not.toMatch(/truncate/i);
  });

  it("role and location are never managed: no function sets managed_role or managed_location true", () => {
    for (const fn of ["employee_access_provision_account", "employee_access_link_existing"]) {
      const body = fnBody(fn);
      expect(body, fn).toMatch(/managed_status, managed_location, managed_role/);
      /* Values follow the column list: status (true or computed), then false, false. */
      expect(body, fn).toMatch(/(true|v_managed), false, false/);
    }
    expect(sqlCode).not.toMatch(/managed_(role|location)\s*=\s*true/);
  });

  it("only an EXISTING account is disabled, never one created or changed in role, scope or salon", () => {
    const disable = fnBody("employee_access_disable_terminated");
    expect(disable).toMatch(/update public\.app_users set status = 'disabled', updated_by = null where id = p_app_user_id/);
    expect(disable).not.toMatch(/role\s*=|scope_level\s*=|scope_primary_area_id\s*=/);
    expect(disable).toMatch(/employee_access_observed_status\(p_external_employee_id\) <> 'terminated'/);
    expect(disable).toMatch(/if not v_link\.managed_status/);
    expect(disable).toMatch(/employee_access_is_protected/);
    const link = fnBody("employee_access_link_existing");
    expect(link).not.toMatch(/update public\.app_users/);
  });

  it("every new function is SECURITY DEFINER with an empty search_path, and only service_role may execute the entry points", () => {
    const definers = [...sqlCode.matchAll(/create or replace function public\.([a-z_]+)\([\s\S]*?\$\$/g)];
    expect(definers.length).toBeGreaterThan(10);
    for (const m of definers) expect(m[0], m[1]).toMatch(/set search_path = ''/);
    const grants = [...sqlCode.matchAll(/grant ([a-z, ]+) on (?:function )?public\.([a-z_]+)[^;]* to ([a-z_, ]+);/g)].map((m) => `${m[2]}:${m[1]}:${m[3]}`);
    expect(grants.sort()).toEqual(
      [
        "accept_invitation:execute:authenticated",
        "employee_access_accounts:select:service_role",
        "employee_access_auth_only_accounts:execute:service_role",
        "employee_access_auth_user_by_email:execute:service_role",
        "employee_access_begin_apply_run:execute:service_role",
        "employee_access_disable_terminated:execute:service_role",
        "employee_access_finish_apply_run:execute:service_role",
        "employee_access_link_existing:execute:service_role",
        "employee_access_provision_account:execute:service_role",
        "employee_access_record_apply_actions:execute:service_role",
        "employee_access_record_invite:execute:service_role",
        "employee_access_record_revocation:execute:service_role",
      ].sort(),
    );
    expect(sqlCode).not.toMatch(/grant [^;]*(update|delete|truncate|all)[^;]* to/i);
  });

  it("accept_invitation still takes no arguments and changes status only; the one addition stamps invite_accepted_at", () => {
    const accept = fnBody("accept_invitation");
    expect(sqlCode).toMatch(/create or replace function public\.accept_invitation\(\)\s+returns jsonb/);
    expect(accept).toMatch(/set status = 'active'\s+where id = v_uid\s+and status = 'invited'/);
    expect(accept).toMatch(/update public\.employee_account_links\s+set invite_accepted_at = now\(\)/);
    expect(accept).not.toMatch(/role\s*=|scope_level\s*=|email\s*=\s*[^v]/);
  });
});
