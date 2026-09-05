import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * INVITED BECOMES ACTIVE.
 * ============================================================================
 *
 * The gap this closes: `status` starts at 'invited', the auth provider REFUSES
 * an invited profile, and nothing moved a profile out of that state except
 * `patchUser` — which needs `manage_users` and refuses a change to your own
 * account. On a fresh deployment that is a closed loop with nobody inside it:
 * the first administrator is invited, cannot sign in, and is the only person
 * who could activate themselves.
 *
 * The transition is enforced by `public.accept_invitation()`, and the tests
 * below split accordingly. WHAT THIS ROUTE SENDS is asserted against a fake
 * client; WHAT THE DATABASE GUARANTEES is asserted against the migration SQL,
 * because no fake can prove a trigger — and the guarantees were separately
 * exercised against the live database before shipping.
 */

const MIGRATION = readFileSync(
  "supabase/migrations/20260905001000_accept_invitation.sql",
  "utf8",
);

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
  process.env.ANTHROPIC_API_KEY = "test";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/supabase/auth-clients");
  vi.doUnmock("@/lib/auth/app-user");
});

interface FakeOptions {
  user?: { id: string } | null;
  rpcError?: { message: string } | null;
  role?: string;
}

async function loadRoute(options: FakeOptions = {}) {
  /*
   * Reset PER CALL, not per test. `vi.doMock` re-registers freely, but the
   * module CACHE does not clear itself — so a test calling this twice was
   * getting the first call's fakes back on the second, and the loop over the
   * refusal messages was silently asserting the same one three times.
   */
  vi.resetModules();
  const calls: { rpc: string[]; args: unknown[] } = { rpc: [], args: [] };

  vi.doMock("@/lib/supabase/auth-clients", () => ({
    getSupabaseSessionClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: options.user === undefined ? { id: "user-1" } : options.user },
          error: options.user === null ? { message: "no session" } : null,
        }),
      },
      rpc: async (name: string, args?: unknown) => {
        calls.rpc.push(name);
        calls.args.push(args);
        return { data: null, error: options.rpcError ?? null };
      },
    }),
  }));

  vi.doMock("@/lib/auth/app-user", () => ({
    getAppUser: async () => ({
      ok: true,
      profile: { id: "user-1", role: options.role ?? "admin" },
    }),
    APP_USER_COLUMNS: "id",
  }));

  const { POST } = await import("./route");
  return { POST, calls };
}

describe("what this route sends", () => {
  it("calls accept_invitation with NO arguments at all", async () => {
    /*
     * THE LOAD-BEARING ASSERTION. The function takes no parameters, so there is
     * no id, role, status or email a caller could supply — the subject is
     * `auth.uid()` from the JWT PostgREST verified. A route that passed an id
     * would be letting the browser choose whose profile changes.
     */
    const { POST, calls } = await loadRoute();
    const response = await POST();

    expect(response.status).toBe(200);
    expect(calls.rpc).toEqual(["accept_invitation"]);
    expect(calls.args[0]).toBeUndefined();
  });

  it("reads nothing from the request", async () => {
    // It takes no Request parameter at all, so there is no body to trust.
    const { POST } = await loadRoute();
    expect(POST.length).toBe(0);
  });

  it("returns the landing page for the now-active role, never the role", async () => {
    const { POST } = await loadRoute({ role: "employee" });
    const body = await (await POST()).json();

    expect(body.activated).toBe(true);
    expect(body.landing).toBe("/chat");
    expect(JSON.stringify(body)).not.toContain("employee");
  });

  it("sends an Admin to the Overview", async () => {
    const { POST } = await loadRoute({ role: "admin" });
    expect((await (await POST()).json()).landing).toBe("/");
  });
});

describe("what it refuses", () => {
  it("401s with no session, before touching the database", async () => {
    const { POST, calls } = await loadRoute({ user: null });
    const response = await POST();

    expect(response.status).toBe(401);
    expect(calls.rpc).toEqual([]);
  });

  it("passes on the refusals the database wrote, and only those", async () => {
    for (const message of [
      "This account is disabled.",
      "No Ask Sunny profile exists for this account.",
      "This account has not confirmed its email address.",
    ]) {
      const { POST } = await loadRoute({ rpcError: { message } });
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe(message);
    }
  });

  it("does NOT reflect a message we did not write", async () => {
    /*
     * A Postgres error can quote row contents. Only the sentences this
     * application authored are passed through; anything else becomes a generic
     * refusal.
     */
    const { POST } = await loadRoute({
      rpcError: { message: 'duplicate key value ... DETAIL: Key (email)=(a@b.c) exists.' },
    });
    const body = await (await POST()).json();

    expect(body.error).not.toContain("a@b.c");
    expect(body.error).toMatch(/could not be activated/i);
  });
});

describe("what the DATABASE guarantees, asserted against the migration", () => {
  it("takes no arguments, so the caller cannot name a profile", () => {
    expect(MIGRATION).toMatch(/create or replace function public\.accept_invitation\(\)/);
  });

  it("takes its subject from auth.uid(), not from a parameter", () => {
    expect(MIGRATION).toMatch(/v_uid\s+uuid\s*:=\s*auth\.uid\(\)/);
    expect(MIGRATION).toMatch(/if v_uid is null then/);
  });

  it("writes ONLY status, so role and scope cannot change", () => {
    /*
     * Read out of the UPDATE statement itself rather than trusted. If `role`
     * or `scope_level` ever appeared in this statement, activation would become
     * a privilege-escalation primitive.
     */
    const update = MIGRATION.slice(
      MIGRATION.indexOf("update public.app_users"),
      MIGRATION.indexOf("insert into public.app_user_audit"),
    );
    expect(update).toMatch(/set status = 'active'/);
    expect(update).not.toMatch(/\brole\b/);
    expect(update).not.toMatch(/scope_/);
    expect(update).not.toMatch(/\bemail\b/);
    // And only the caller's own invited row.
    expect(update).toMatch(/where id = v_uid/);
    expect(update).toMatch(/and status = 'invited'/);
  });

  it("refuses a disabled profile", () => {
    expect(MIGRATION).toMatch(/if v_status = 'disabled' then/);
    expect(MIGRATION).toContain("This account is disabled.");
  });

  it("is idempotent for an already-active profile", () => {
    expect(MIGRATION).toMatch(/if v_status = 'active' then/);
    expect(MIGRATION).toMatch(/'changed', false/);
  });

  it("requires a confirmed email, not merely a session", () => {
    expect(MIGRATION).toMatch(/email_confirmed_at is not null/);
  });

  it("is callable by a signed-in person and by nobody else", () => {
    expect(MIGRATION).toMatch(
      /revoke execute on function public\.accept_invitation\(\) from public;/,
    );
    expect(MIGRATION).toMatch(
      /revoke execute on function public\.accept_invitation\(\) from anon;/,
    );
    expect(MIGRATION).toMatch(
      /grant execute on function public\.accept_invitation\(\) to authenticated;/,
    );
  });

  it("carves EXACTLY ONE exception out of the self-change rule", () => {
    /*
     * The trigger still refuses every self-change of role, and every
     * self-change of status EXCEPT invited -> active. The directionality is the
     * point: a disabled account must not be able to re-enable itself.
     */
    const guard = MIGRATION.slice(MIGRATION.indexOf("app_users_guard_self_elevation"));
    expect(guard).toMatch(/if not \(old\.status = 'invited' and new\.status = 'active'\) then/);
    expect(guard).toContain("A user cannot change their own role.");
    expect(guard).toContain("A user cannot change their own status.");
  });

  it("takes write privileges away from the browser roles as well", () => {
    /*
     * Defence in depth for the carve-out above. RLS already stops a browser
     * writing to app_users, but RLS was then the ONLY thing standing in front
     * of a self-transition — one careless policy would have opened it.
     */
    expect(MIGRATION).toMatch(
      /revoke insert, update, delete, truncate, references on public\.app_users from anon;/,
    );
    expect(MIGRATION).toMatch(
      /revoke insert, update, delete, truncate, references on public\.app_users from authenticated;/,
    );
  });
});

describe("the route's own source", () => {
  const code = readFileSync("src/app/api/auth/accept-invitation/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("uses the SESSION client, never the privileged one", () => {
    /*
     * The admin client acts as `service_role`, for which `auth.uid()` is null —
     * the function would refuse, and if it did not it would be activating
     * whoever the caller named rather than whoever the caller IS.
     */
    expect(code).toMatch(/getSupabaseSessionClient/);
    expect(code).not.toMatch(/getSupabaseAdmin|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  });

  it("never parses a body", () => {
    expect(code).not.toMatch(/request\.json|await req|\.body\b/);
  });

  it("logs nothing", () => {
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });
});
