import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THE PHASE-ONE BOUNDARY, ASSERTED AGAINST THE SOURCE
 * ============================================================================
 *
 * What the Woven integration must not do, checked where it would be done.
 * Comments are stripped before matching, because these files explain the
 * rules they must not break and the explanation would otherwise match.
 */

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATION = join(ROOT, "supabase", "migrations", "20260928002000_woven_employee_directory.sql");
const LIB = join(ROOT, "src", "lib", "employees", "woven");
const ADMIN_ROUTES = join(ROOT, "src", "app", "api", "admin", "employees", "woven");
const ROUTES = [
  join(ROOT, "src", "app", "api", "employees", "woven", "cron", "route.ts"),
  ...["sync", "validate", "locations", "positions", "directory", "changes", "runs", "eligibility"].map((r) => join(ADMIN_ROUTES, r, "route.ts")),
  join(ADMIN_ROUTES, "changes", "[id]", "route.ts"),
];
const FEATURE = join(ROOT, "src", "features", "admin", "woven");
const PEOPLE_ROUTES = ["locations", "positions", "directory", "changes", "eligibility"].map((r) => join(ADMIN_ROUTES, r, "route.ts")).concat(join(ADMIN_ROUTES, "changes", "[id]", "route.ts"));

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function stripTsComments(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const sql = stripSqlComments(readFileSync(MIGRATION, "utf8")).replace(/\s+/g, " ");

const productionSources = readdirSync(LIB)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-support.ts" && f !== "memory-store.ts")
  .map((f) => ({ file: f, text: stripTsComments(readFileSync(join(LIB, f), "utf8")) }))
  .concat(ROUTES.map((p) => ({ file: p, text: stripTsComments(readFileSync(p, "utf8")) })));

describe("the migration", () => {
  const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

  it("creates exactly the six planned tables", () => {
    expect(tables.sort()).toEqual(
      [
        "employee_access_directory",
        "employee_directory_changes",
        "employee_location_affiliations",
        "employee_sync_runs",
        "woven_location_map",
        "woven_position_map",
      ].sort(),
    );
  });

  it.each([
    "employee_access_directory",
    "employee_directory_changes",
    "employee_location_affiliations",
    "employee_sync_runs",
    "woven_location_map",
    "woven_position_map",
  ])(
    "%s has RLS enabled and forced, and nothing granted to anon or authenticated",
    (table) => {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`alter table public.${table} force row level security;`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`grant [^;]* on (table )?public\\.${table}`));
      expect(sql).not.toMatch(new RegExp(`create policy [^;]* on public\\.${table}`));
    },
  );

  it("revokes every function from public, anon AND authenticated", () => {
    const functions = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(functions.length).toBeGreaterThanOrEqual(5);
    for (const fn of functions) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });

  it("never writes to app_users, app_user_audit or auth.users, and alters no existing object", () => {
    expect(sql).not.toMatch(/(insert into|update|delete from|alter table|drop table|truncate) public\.app_users/);
    expect(sql).not.toMatch(/(insert into|update|delete from) public\.app_user_audit/);
    expect(sql).not.toMatch(/auth\.users/);
    expect(sql).not.toMatch(/alter table public\.(?!employee_|woven_)/);
    expect(sql).not.toMatch(/drop (table|function|view|type|policy|index) (?!if exists \w+_touch_updated_at|if exists employee_)/);
  });

  it("has no column for sensitive HR data", () => {
    /* `email_address` is Woven's EmailAddress, deliberately kept; no other "address" is. */
    const columns = sql.replace(/\bemail_address\b/g, "email");
    for (const word of ["salary", "pay_rate", "wage", "birth", "dob", "ssn", "phone", "address", "emergency", "i9", "background", "bank", "payroll", "medical", "leave_", "rehire", "termination_reason"]) {
      expect(columns).not.toMatch(new RegExp(`\\b\\w*${word}\\w* (text|date|jsonb|numeric|integer|boolean)`, "i"));
    }
  });
});

describe("the TypeScript", () => {
  it("never touches app_users, Supabase Auth administration, or a login's role/scope columns", () => {
    for (const { file, text } of productionSources) {
      expect(text, file).not.toMatch(/["'`]app_users["'`]/);
      expect(text, file).not.toMatch(/["'`]app_user_audit["'`]/);
      expect(text, file).not.toMatch(/auth\.admin/);
      /*
       * A BARE app_users column name. The Woven views expose prefixed copies
       * (`app_user_scope_level`, `mapped_scope_level`) and the position map has
       * `ask_sunny_scope_level`; those are read-only views and a label, and the
       * lookbehind lets them through while a real `scope_level` still fails.
       */
      expect(text, file).not.toMatch(/(?<![a-z_])(scope_primary_area_id|scope_also_covers_area_ids|scope_level)(?![a-z_])/);
    }
  });

  it("reads the access preview and login matches through views only, and writes no login", () => {
    for (const { file, text } of productionSources) {
      expect(text, file).not.toMatch(/\.from\(["'`]app_user/);
      expect(text, file).not.toMatch(/auth\.(signUp|admin|updateUser)/);
    }
  });

  it("names no Woven write endpoint anywhere in the integration", () => {
    for (const { file, text } of productionSources) {
      expect(text, file).not.toMatch(/companywebhooks|employees\/borrow|\/security\b|\/primary\b|\/availabilities|timeoffrequests|workorders/i);
    }
  });

  it("marks every module that can reach a credential or the secret key server-only", () => {
    for (const file of ["config.ts", "client.ts", "store.ts", "sync.ts", "status.ts", "locations.ts", "validate.ts", "directory.ts", "positions.ts", "access-preview.ts", "route-auth.ts"]) {
      expect(readFileSync(join(LIB, file), "utf8").startsWith('import "server-only";'), file).toBe(true);
    }
  });

  it("never exposes a Woven credential through a NEXT_PUBLIC_ variable", () => {
    for (const { file, text } of productionSources) {
      expect(text, file).not.toMatch(/NEXT_PUBLIC_WOVEN_(API|SUBSCRIPTION|USERNAME|PASSWORD|KEY|TOKEN)/);
    }
  });

  it("never logs from the integration", () => {
    for (const { file, text } of productionSources) {
      expect(text, file).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });
});

describe("who may see Woven employees", () => {
  it.each(PEOPLE_ROUTES)("%s requires manage_integrations AND manage_users", (route) => {
    const text = stripTsComments(readFileSync(route, "utf8"));
    expect(text).toContain("authorizeWovenPeopleRequest(request)");
    expect(text).not.toMatch(/authorizeRequest\(request, "manage_integrations"\)/);
  });

  it("the helper asks for both permissions", () => {
    const text = stripTsComments(readFileSync(join(LIB, "route-auth.ts"), "utf8"));
    expect(text).toContain('authorizeRequest(request, "manage_users")');
    expect(text).toContain('"manage_integrations"');
  });

  it("the tab pages guard people views with manage_users on the server", () => {
    const page = readFileSync(join(ROOT, "src", "app", "(app)", "admin", "integrations", "woven", "[view]", "page.tsx"), "utf8");
    expect(page).toContain('requirePagePermission("manage_integrations")');
    expect(page).toContain('requirePagePermission("manage_users")');
  });
});

describe("sample data", () => {
  it("reaches the screens only through the demo boundary, and never on Vercel Production", () => {
    const gate = stripTsComments(readFileSync(join(FEATURE, "sample.ts"), "utf8"));
    expect(gate).toContain("demoRuntime.loadWovenSample()");
    expect(gate).toContain("isProductionDeployment()");
    expect(gate).toContain('process.env.VERCEL_ENV === "production"');
    expect(gate).toContain("isDemoMode()");
    /* Production modules only: tests may import the sample set, exactly as production-demo-data.test.ts allows. */
    for (const file of readdirSync(FEATURE).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."))) {
      expect(stripTsComments(readFileSync(join(FEATURE, file), "utf8")), file).not.toMatch(/data\/demo/);
    }
  });
});

describe("the schedule", () => {
  it("is NOT enabled: vercel.json has no entry for the Woven employee cron route", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons?: { path: string }[] };
    /* The employee sync's own route. (The separate Woven KNOWLEDGE sync has its own daily check.) */
    expect((vercel.crons ?? []).some((c) => c.path.startsWith("/api/employees/"))).toBe(false);
  });
});
