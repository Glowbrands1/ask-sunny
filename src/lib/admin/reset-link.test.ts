import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * ADMINISTRATOR-GENERATED RESET LINK — sends no email, keeps nothing.
 * ============================================================================
 *
 * The link this module returns is a working credential for somebody else's
 * account. These cases pin who may receive one, that it is made with
 * `generateLink` and never with an email-sending call, that it enters PR #33's
 * scanner-safe flow rather than Supabase's GET-spent `action_link`, and that
 * the token goes nowhere but the return value.
 */

const HASH = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c";
const ACTION_LINK = `https://project.supabase.co/auth/v1/verify?token=${HASH}&type=recovery`;

const EMPLOYEE_ROW = {
  id: "emp-1",
  email: "sam@suntancity.test",
  display_name: "Sam",
  role: "employee",
  status: "active",
  scope_level: "global",
  scope_primary_area_id: null,
  scope_also_covers_area_ids: [],
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
};

const actor = { id: "admin-1", email: "admin@suntancity.test", role: "admin" as const };

type LinkOutcome = "ok" | "error" | "rate_limited" | "wrong_user" | "wrong_type" | "no_hash";

function fakeAdmin(options: { row?: Record<string, unknown> | null; link?: LinkOutcome } = {}) {
  const audits: Record<string, unknown>[] = [];
  const writes: { table: string; op: string; value: unknown }[] = [];
  /** Every auth method called, admin or not, in order. */
  const authCalls: string[] = [];
  const generateArgs: unknown[] = [];

  const row = options.row === undefined ? EMPLOYEE_ROW : options.row;

  const generateLink = async (args: { email: string }) => {
    generateArgs.push(args);
    switch (options.link ?? "ok") {
      case "error":
        return { data: { properties: null, user: null }, error: { status: 500, message: `boom ${args.email}` } };
      case "rate_limited":
        return { data: { properties: null, user: null }, error: { status: 429, message: "slow down" } };
      default: {
        const outcome = options.link ?? "ok";
        return {
          data: {
            properties: {
              action_link: ACTION_LINK,
              email_otp: "123456",
              hashed_token: outcome === "no_hash" ? "" : HASH,
              redirect_to: "https://ask-sunny.vercel.app",
              verification_type: outcome === "wrong_type" ? "magiclink" : "recovery",
            },
            user: { id: outcome === "wrong_user" ? "someone-else" : (row?.id as string) },
          },
          error: null,
        };
      }
    }
  };

  /* Records ANY auth call, so an email-sending method would show up here. */
  const record = (prefix: string, impl: Record<string, unknown>) =>
    new Proxy(impl, {
      get: (target, key: string) => {
        if (key in target) {
          return async (...args: unknown[]) => {
            authCalls.push(`${prefix}${key}`);
            return (target[key] as (...a: unknown[]) => unknown)(...args);
          };
        }
        return async () => {
          authCalls.push(`${prefix}${key}`);
          return { data: {}, error: null };
        };
      },
    });

  const client = {
    from(table: string) {
      if (table === "app_user_audit") {
        return {
          insert: async (entry: Record<string, unknown>) => {
            audits.push(entry);
            writes.push({ table, op: "insert", value: entry });
            return { error: null };
          },
        };
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error: null }),
        update: (value: unknown) => {
          writes.push({ table, op: "update", value });
          return chain;
        },
        insert: (value: unknown) => {
          writes.push({ table, op: "insert", value });
          return chain;
        },
        upsert: (value: unknown) => {
          writes.push({ table, op: "upsert", value });
          return chain;
        },
      };
      return chain;
    },
    /* `auth.admin.*` and `auth.*` are both recorded. */
    auth: new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === "admin") return record("auth.admin.", { generateLink });
        return async () => {
          authCalls.push(`auth.${key}`);
          return { data: {}, error: null };
        };
      },
    },
    ),
  };

  return { client, audits, writes, authCalls, generateArgs };
}

async function loadWith(fake: ReturnType<typeof fakeAdmin>) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/server", () => ({
    getSupabaseAdmin: () => fake.client,
    KNOWLEDGE_BUCKET: "knowledge-documents",
  }));
  return import("./reset-link");
}

const toUrl = (hash: string) =>
  `https://ask-sunny.vercel.app/auth/recovery-start?token_hash=${hash}&type=recovery`;

describe("who may receive a reset link", () => {
  it("refuses an UNKNOWN user, without asking Supabase for anything", async () => {
    const fake = fakeAdmin({ row: null });
    const { generateResetLink } = await loadWith(fake);

    await expect(generateResetLink("nobody", toUrl, actor)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(fake.authCalls).toEqual([]);
    expect(fake.audits).toEqual([]);
  });

  it("refuses a DISABLED user", async () => {
    const fake = fakeAdmin({ row: { ...EMPLOYEE_ROW, status: "disabled" } });
    const { generateResetLink } = await loadWith(fake);

    await expect(generateResetLink("emp-1", toUrl, actor)).rejects.toThrow(/disabled/i);
    expect(fake.authCalls).toEqual([]);
  });

  it("refuses an INVITED user, who needs the invitation resent instead", async () => {
    const fake = fakeAdmin({ row: { ...EMPLOYEE_ROW, status: "invited" } });
    const { generateResetLink } = await loadWith(fake);

    await expect(generateResetLink("emp-1", toUrl, actor)).rejects.toThrow(/not accepted/i);
    expect(fake.authCalls).toEqual([]);
  });

  it.each(["admin", "owner", "developer"])(
    "refuses an ADMINISTRATIVE target (%s): the link would hand over their account",
    async (role) => {
      const fake = fakeAdmin({ row: { ...EMPLOYEE_ROW, role } });
      const { generateResetLink } = await loadWith(fake);

      await expect(generateResetLink("emp-1", toUrl, actor)).rejects.toMatchObject({
        code: "protected_account",
        status: 403,
      });
      expect(fake.authCalls).toEqual([]);
    },
  );
});

describe("a successful request", () => {
  it("calls generateLink({ type: 'recovery', email }) with the DIRECTORY's email, once", async () => {
    const fake = fakeAdmin();
    const { generateResetLink } = await loadWith(fake);

    await generateResetLink("emp-1", toUrl, actor);

    expect(fake.generateArgs).toEqual([{ type: "recovery", email: "sam@suntancity.test" }]);
  });

  it("calls NO email-sending method — generateLink is the only auth call", async () => {
    const fake = fakeAdmin();
    const { generateResetLink } = await loadWith(fake);

    await generateResetLink("emp-1", toUrl, actor);

    expect(fake.authCalls).toEqual(["auth.admin.generateLink"]);
  });

  it("returns the scanner-safe /auth/recovery-start URL with type=recovery — not the action_link", async () => {
    const fake = fakeAdmin();
    const { generateResetLink } = await loadWith(fake);

    const { url, email } = await generateResetLink("emp-1", toUrl, actor);
    const parsed = new URL(url);

    expect(email).toBe("sam@suntancity.test");
    expect(parsed.pathname).toBe("/auth/recovery-start");
    expect(parsed.searchParams.get("type")).toBe("recovery");
    expect(parsed.searchParams.get("token_hash")).toBe(HASH);
    expect(url).not.toContain("/auth/v1/verify");
    expect(url).not.toContain("123456");
  });

  it("writes ONE audit row, with an already-valid action and no token or link in it", async () => {
    const fake = fakeAdmin();
    const { generateResetLink, RESET_LINK_AUDIT_LABEL } = await loadWith(fake);

    await generateResetLink("emp-1", toUrl, actor);

    expect(fake.audits).toHaveLength(1);
    const entry = fake.audits[0];
    expect(entry).toMatchObject({
      action: "reset_requested",
      target_user_id: "emp-1",
      actor_user_id: "admin-1",
      to_value: RESET_LINK_AUDIT_LABEL,
    });
    expect(JSON.stringify(entry)).not.toContain(HASH);
    expect(JSON.stringify(entry)).not.toMatch(/recovery-start|verify|token/);
  });

  it("persists nothing else — no profile update, no token anywhere", async () => {
    const fake = fakeAdmin();
    const { generateResetLink } = await loadWith(fake);

    await generateResetLink("emp-1", toUrl, actor);

    expect(fake.writes.map((write) => `${write.table}.${write.op}`)).toEqual([
      "app_user_audit.insert",
    ]);
    expect(JSON.stringify(fake.writes)).not.toContain(HASH);
  });

  it("logs nothing, on success or failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    for (const link of ["ok", "error", "rate_limited", "wrong_user"] as const) {
      const fake = fakeAdmin({ link });
      const { generateResetLink } = await loadWith(fake);
      await generateResetLink("emp-1", toUrl, actor).catch(() => {});
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("what it will not hand over", () => {
  it.each(["wrong_user", "wrong_type", "no_hash"] as const)(
    "refuses a generated link that does not check out (%s), and audits nothing",
    async (link) => {
      const fake = fakeAdmin({ link });
      const { generateResetLink } = await loadWith(fake);

      await expect(generateResetLink("emp-1", toUrl, actor)).rejects.toMatchObject({
        code: "provider_failed",
      });
      expect(fake.audits).toEqual([]);
    },
  );

  it("does not pass the provider's error text on", async () => {
    const fake = fakeAdmin({ link: "error" });
    const { generateResetLink } = await loadWith(fake);

    const failure = await generateResetLink("emp-1", toUrl, actor).catch((e: Error) => e);
    expect((failure as Error).message).not.toContain("sam@suntancity.test");
    expect((failure as Error).message).not.toContain("boom");
  });

  it("reports Supabase's 429 as a wait, not a failure", async () => {
    const fake = fakeAdmin({ link: "rate_limited" });
    const { generateResetLink } = await loadWith(fake);

    await expect(generateResetLink("emp-1", toUrl, actor)).rejects.toMatchObject({ status: 429 });
  });

  it("refuses a URL that /auth/recovery-start would not accept", async () => {
    const fake = fakeAdmin();
    const { generateResetLink } = await loadWith(fake);
    const broken = (hash: string) => `https://ask-sunny.vercel.app/auth/recovery-start?token_hash=${hash}`;

    await expect(generateResetLink("emp-1", broken, actor)).rejects.toMatchObject({
      code: "provider_failed",
    });
    expect(fake.audits).toEqual([]);
  });
});

describe("the source", () => {
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const CODE = strip(readFileSync("src/lib/admin/reset-link.ts", "utf8"));

  it("never sends email, never sets a password, never reads the action_link", () => {
    expect(CODE).not.toMatch(/resetPasswordForEmail|inviteUserByEmail|signInWithOtp/);
    expect(CODE).not.toMatch(/updateUserById|updateUser\(|password\s*[:=]/);
    expect(CODE).not.toMatch(/action_link|email_otp/);
    expect(CODE).not.toMatch(/console\./);
    expect(CODE).toMatch(/generateLink\(\{\s*type: "recovery",\s*email: user\.email,?\s*\}\)/);
  });

  it("is the ONLY application file that calls generateLink", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk("src");
    const callers = files.filter((file) => /\.generateLink\(/.test(strip(readFileSync(file, "utf8"))));
    expect(callers).toEqual([join("src", "lib", "admin", "reset-link.ts")]);
  });

  it("uses an audit action the database's CHECK constraint accepts", () => {
    const migration = readFileSync(
      "supabase/migrations/20260905001100_audit_action_vocabulary.sql",
      "utf8",
    );
    const actions = [...CODE.matchAll(/action: "([a-z_]+)"/g)].map((match) => match[1]);
    expect(actions).toEqual(["reset_requested"]);
    for (const action of actions) expect(migration).toContain(`'${action}'`);
  });
});
