import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { allowedAuditActions } from "@/test/audit-actions";

/**
 * Source-level guarantees for adoption (managed flags) and credential reset.
 * Written against the shapes that would carry a value, as in
 * `user-directory.test.ts`, so they cannot pass vacuously and cannot be
 * satisfied by renaming a word.
 */

const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const FLAGS = strip(readFileSync("src/lib/admin/woven-managed-flags.ts", "utf8"));
const RESET = strip(readFileSync("src/lib/admin/credential-reset.ts", "utf8"));
const FLAGS_ROUTE = strip(readFileSync("src/app/api/admin/employees/woven/links/flags/route.ts", "utf8"));
const RESET_ROUTE = strip(readFileSync("src/app/api/admin/users/[id]/credentials/route.ts", "utf8"));
const MIGRATION = readFileSync("supabase/migrations/20261006001000_woven_adoption_and_credentials.sql", "utf8");
const MIGRATION_CODE = MIGRATION.replace(/--.*$/gm, "");

describe("adoption: what Woven may manage", () => {
  it("writes only the three managed flags on a link — no account, no auth, no other link column", () => {
    const writes = [...FLAGS.matchAll(/from\(\s*"([a-z_]+)"\s*\)\s*\.\s*(update|insert|upsert|delete)/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(writes).toEqual(["employee_account_links.update"]);
    const patch = FLAGS.match(/\.update\(\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(patch.split(",").map((p) => p.split(":")[0]!.trim()).filter(Boolean).sort()).toEqual(["managed_location", "managed_role", "managed_status"]);
    expect(FLAGS).not.toMatch(/\.auth\s*\.|from\(\s*"app_users"|rpc\(/);
  });

  it("enforces the policy on the server and refuses a concurrent change rather than overwriting it", () => {
    expect(FLAGS).toMatch(/allowedManagedFlags\(account, isProtectedAccount\(account\)\)/);
    expect(FLAGS).toMatch(/disallowedFlags\(/);
    for (const column of ["managed_status", "managed_location", "managed_role"]) {
      expect(FLAGS).toMatch(new RegExp(`\\.eq\\("${column}", before\\.`));
    }
  });

  it("the route requires manage_users AND manage_integrations, live mode and the rate limit", () => {
    expect(FLAGS_ROUTE).toMatch(/authorizeWovenPeopleRequest\(request\)/);
    expect(FLAGS_ROUTE).toMatch(/assertLiveMode\(\)/);
    expect(FLAGS_ROUTE).toMatch(/assertWithinRateLimit\(request, "mutate"\)/);
  });
});

describe("credential reset: the owner chooses their own password", () => {
  it("never sets, generates, reads or returns a password or a link", () => {
    for (const code of [RESET, RESET_ROUTE]) {
      expect(code).not.toMatch(/password\s*[:=]/i);
      expect(code).not.toMatch(/\.password\b/i);
      expect(code).not.toMatch(/updateUserById|updateUser\(|generateLink|action_link|actionLink/);
      expect(code).not.toMatch(/randomBytes|randomUUID|crypto\./);
      expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });

  it("clears credentials only through the server-only database function, then sends through the existing recovery path", () => {
    expect([...RESET.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1])).toEqual(["auth_clear_user_credentials"]);
    expect(RESET).toMatch(/sendRecovery\(account\.id, redirectTo, actor\)/);
    expect(RESET.indexOf('rpc("auth_clear_user_credentials"')).toBeLessThan(RESET.indexOf("sendRecovery(account.id"));
  });

  it("refuses your own account and a disabled one before touching anything", () => {
    const first = RESET.indexOf("rpc(");
    expect(RESET.indexOf("account.id === actor.id")).toBeLessThan(first);
    expect(RESET.indexOf('account.status === "disabled"')).toBeLessThan(first);
  });

  it("the route requires manage_users, live mode, the rate limit and an explicit confirm: true", () => {
    expect(RESET_ROUTE).toMatch(/authorizeRequest\(request, "manage_users"\)/);
    expect(RESET_ROUTE).toMatch(/assertWithinRateLimit\(request, "mutate"\)/);
    expect(RESET_ROUTE).toMatch(/body\?\.confirm !== true/);
  });
});

describe("audit vocabulary", () => {
  it("both modules emit only actions the newest CHECK constraint accepts, and the migration adds them", () => {
    const { file, actions } = allowedAuditActions();
    expect(file).toBe("20261006001000_woven_adoption_and_credentials.sql");
    for (const code of [FLAGS, RESET]) {
      for (const match of code.matchAll(/action:\s*"([a-z_]+)"/g)) expect(actions).toContain(match[1]);
    }
    expect(actions).toContain("managed_flags_changed");
    expect(actions).toContain("credentials_reset");
    /* Additive only: every earlier action is still accepted. */
    for (const kept of ["invited", "invite_resent", "invitation_accepted", "reset_requested", "role_changed", "status_changed", "scope_changed", "access_revoked", "access_restored", "access_revocation_incomplete"]) {
      expect(actions).toContain(kept);
    }
  });
});

describe("migration 20261006001000", () => {
  it("grants service_role UPDATE on exactly the three flag columns, and nothing table-wide", () => {
    const grants = [...MIGRATION_CODE.matchAll(/grant\s+([^;]+?)\s+to\s+([a-z_]+)\s*;/gi)].map((m) => `${m[1]!.replace(/\s+/g, " ").trim()} → ${m[2]}`);
    expect(grants).toEqual([
      "update (managed_status, managed_location, managed_role) on public.employee_account_links → service_role",
      "execute on function public.auth_clear_user_credentials(uuid) → service_role",
    ]);
  });

  it("the guard trigger refuses any change but the flags, and its function is granted to nobody", () => {
    expect(MIGRATION_CODE).toMatch(/to_jsonb\(new\) - array\['managed_status', 'managed_location', 'managed_role', 'updated_at'\]/);
    expect(MIGRATION_CODE).toMatch(/revoke all on function public\.employee_account_links_guard_update\(\) from public, anon, authenticated, service_role;/);
    expect(MIGRATION_CODE).toMatch(/before update on public\.employee_account_links/);
  });

  it("the credential function clears and ends sessions in one function, is SECURITY DEFINER with an empty search_path, and never deletes a user or sets a password", () => {
    const body = MIGRATION_CODE.slice(MIGRATION_CODE.indexOf("function public.auth_clear_user_credentials"));
    expect(body).toMatch(/security definer\s+set search_path = ''/);
    expect(body).toMatch(/set encrypted_password = ''/);
    expect(body).toMatch(/delete from auth\.refresh_tokens where user_id = p_user_id::text/);
    expect(body).toMatch(/delete from auth\.sessions where user_id = p_user_id/);
    expect(body).not.toMatch(/delete from auth\.users|crypt\(|gen_salt|delete from public\.app_users/i);
    expect(MIGRATION_CODE).toMatch(/revoke all on function public\.auth_clear_user_credentials\(uuid\) from public, anon, authenticated;/);
  });

  it("never writes app_users and never grants a browser role anything", () => {
    expect(MIGRATION_CODE).not.toMatch(/(insert into|update|delete from)\s+(public\.)?app_users\b/i);
    expect(MIGRATION_CODE).not.toMatch(/grant [^;]* to [^;]*(anon|authenticated)/i);
  });
});
