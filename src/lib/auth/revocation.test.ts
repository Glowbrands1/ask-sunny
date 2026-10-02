import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PERMANENT_BAN_DURATION, restoreAuthAccess, revokeAuthAccess, type RevocationClient } from "./revocation";

/**
 * ============================================================================
 * THE AUTHENTICATION-LAYER HALF OF A REVOCATION
 * ============================================================================
 *
 * Behaviour against a double here; behaviour against a REAL Supabase Auth
 * server (ban refuses sign-in, refresh and recovery; revoked sessions cannot
 * refresh) is proven by `scripts/verify-auth-revocation-local.mjs` on a
 * disposable local stack.
 */

const USER = "4b0e7c52-8d0a-4e0e-9d1c-2f6a1a0c9e11";

function fake(options: { banFails?: boolean; banThrows?: boolean; rpcFails?: boolean; sessions?: number } = {}) {
  const calls: { kind: string; id?: string; attributes?: unknown; args?: unknown }[] = [];
  const admin: RevocationClient = {
    auth: {
      admin: {
        updateUserById: async (id, attributes) => {
          calls.push({ kind: "update", id, attributes });
          if (options.banThrows) throw new Error("network");
          return { error: options.banFails ? { message: "nope" } : null };
        },
      },
    },
    rpc: (fn, args) => {
      calls.push({ kind: `rpc:${fn}`, args });
      return Promise.resolve(options.rpcFails ? { data: null, error: { message: "nope" } } : { data: options.sessions ?? 2, error: null });
    },
  };
  return { admin, calls };
}

describe("revokeAuthAccess", () => {
  it("bans the auth user AND revokes every session", async () => {
    const { admin, calls } = fake({ sessions: 3 });
    const result = await revokeAuthAccess(USER, admin);
    expect(result).toEqual({ ok: true, banned: true, sessionsRevoked: 3, failed: [] });
    expect(calls).toEqual([
      { kind: "update", id: USER, attributes: { ban_duration: PERMANENT_BAN_DURATION } },
      { kind: "rpc:auth_revoke_user_sessions", args: { p_user_id: USER } },
    ]);
  });

  it("still revokes sessions when the ban fails, and says the ban failed", async () => {
    const { admin, calls } = fake({ banFails: true });
    const result = await revokeAuthAccess(USER, admin);
    expect(result).toMatchObject({ ok: false, banned: false, failed: ["ban"] });
    expect(calls.map((c) => c.kind)).toEqual(["update", "rpc:auth_revoke_user_sessions"]);
  });

  it("reports a thrown ban and a failed session revocation, never throws", async () => {
    const { admin } = fake({ banThrows: true, rpcFails: true });
    await expect(revokeAuthAccess(USER, admin)).resolves.toEqual({ ok: false, banned: false, sessionsRevoked: null, failed: ["ban", "sessions"] });
  });

  it("refuses anything that is not a user id, without calling the provider", async () => {
    const { admin, calls } = fake();
    expect((await revokeAuthAccess("'; drop table app_users; --", admin)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("is idempotent: revoking twice succeeds twice", async () => {
    const { admin } = fake({ sessions: 0 });
    expect((await revokeAuthAccess(USER, admin)).ok).toBe(true);
    expect((await revokeAuthAccess(USER, admin)).ok).toBe(true);
  });
});

describe("restoreAuthAccess", () => {
  it("lifts the ban and does nothing else", async () => {
    const { admin, calls } = fake();
    expect(await restoreAuthAccess(USER, admin)).toEqual({ ok: true });
    expect(calls).toEqual([{ kind: "update", id: USER, attributes: { ban_duration: "none" } }]);
  });

  it("reports a failure", async () => {
    expect(await restoreAuthAccess(USER, fake({ banFails: true }).admin)).toEqual({ ok: false });
    expect(await restoreAuthAccess(USER, fake({ banThrows: true }).admin)).toEqual({ ok: false });
  });
});

describe("what this module can never do — asserted against the source", () => {
  const CODE = readFileSync("src/lib/auth/revocation.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("is server-only", () => {
    expect(CODE).toMatch(/^import "server-only";/m);
  });

  it("passes ONLY ban_duration to the Auth Admin API — never a password, email or metadata", () => {
    const attributeObjects = [...CODE.matchAll(/updateUserById\(\s*userId\s*,\s*\{([^}]*)\}/g)].map((m) => m[1]!.trim());
    expect(attributeObjects.length).toBe(2);
    for (const attributes of attributeObjects) expect(attributes).toMatch(/^ban_duration:\s*[A-Z_]+$/);
    expect(CODE).not.toMatch(/password|email|user_metadata|app_metadata|phone/i);
  });

  it("never deletes a user or calls any other Auth Admin method", () => {
    expect(CODE).not.toMatch(/deleteUser|inviteUserByEmail|createUser|generateLink|signOut/);
    const adminMethods = new Set([...CODE.matchAll(/auth\.admin\.([a-zA-Z]+)/g)].map((m) => m[1]));
    expect([...adminMethods]).toEqual(["updateUserById"]);
  });

  it("calls exactly one database function, the server-only session revocation", () => {
    expect([...CODE.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1])).toEqual(["auth_revoke_user_sessions"]);
  });
});

describe("the migration behind it", () => {
  const SQL = readFileSync("supabase/migrations/20261002001000_auth_revocation_hardening.sql", "utf8");

  it("the session function is SECURITY DEFINER with an empty search_path, and only service_role may run it", () => {
    expect(SQL).toMatch(/function public\.auth_revoke_user_sessions\(p_user_id uuid\)[\s\S]*security definer[\s\S]*set search_path = ''/);
    expect(SQL).toMatch(/revoke all on function public\.auth_revoke_user_sessions\(uuid\) from public;/);
    expect(SQL).toMatch(/revoke all on function public\.auth_revoke_user_sessions\(uuid\) from anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.auth_revoke_user_sessions\(uuid\) to service_role;/);
  });

  it("deletes sessions and refresh tokens, and never a user", () => {
    expect(SQL).toMatch(/delete from auth\.refresh_tokens where user_id = p_user_id::text/);
    expect(SQL).toMatch(/delete from auth\.sessions where user_id = p_user_id/);
    expect(SQL).not.toMatch(/delete from auth\.users|delete from public\.app_users/i);
  });

  it("both knowledge read policies require an ACTIVE Ask Sunny user", () => {
    for (const policy of ["knowledge_documents_read_authenticated", "knowledge_chunks_read_authenticated"]) {
      const body = SQL.slice(SQL.indexOf(`create policy ${policy}`));
      const using = body.slice(0, body.indexOf(";"));
      expect(using).toMatch(/u\.id = \(select auth\.uid\(\)\) and u\.status = 'active'/);
    }
  });
});
