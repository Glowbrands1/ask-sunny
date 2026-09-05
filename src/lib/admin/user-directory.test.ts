import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  DirectoryError,
  isRole,
  isStatus,
  normalizeEmail,
  normalizeScope,
} from "./user-directory";

/**
 * ============================================================================
 * THE USER DIRECTORY.
 * ============================================================================
 *
 * This is the only module holding both the privileged Supabase client and the
 * Auth Admin API, so the tests are about what it must refuse rather than what
 * it can do:
 *
 *   NO PASSWORD, ANYWHERE. Not generated, not stored, not hashed, not emailed,
 *   not returned. Asserted against the SOURCE, because this is the one
 *   guarantee a behavioural test cannot prove — a function that never returns a
 *   password looks identical to one that returns it under a condition the test
 *   did not think of.
 *
 *   NO SELF-ELEVATION and NO LAST-ADMIN LOCKOUT. Enforced here for a readable
 *   message and by database triggers regardless, so the rule holds for a caller
 *   that never came through this file.
 */

const SOURCE = readFileSync("src/lib/admin/user-directory.ts", "utf8");
/** Comments stripped — this file explains the rules it must not break. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("Ask Sunny never handles a password", () => {
  it("never handles a password VALUE", () => {
    /*
     * THE LOAD-BEARING ASSERTION OF THIS FILE. Every route below the directory
     * is authorized, so the risk is not somebody reaching it — it is this
     * module quietly growing a "set a temporary password for them" convenience.
     *
     * Written against the shapes that would CARRY a value rather than against
     * the word, because the word appears legitimately three times: in
     * `resetPasswordForEmail` (Supabase's own API, which sends an email and
     * returns nothing), in the `password_reset` label describing which email
     * went out, and in a sentence shown to an administrator. A blanket
     * `/password/i` ban failed on all three and would have to be relaxed —
     * ending up either deleted or weakened into something meaningless.
     */
    expect(CODE).not.toMatch(/password\s*[:=]/i);         // a field or assignment
    expect(CODE).not.toMatch(/\bpassword\b\s*[,)]/i);     // a parameter
    expect(CODE).not.toMatch(/\.password\b/i);            // reading one off an object
    expect(CODE).not.toMatch(/updateUserById|updateUser\(/); // the API that sets one
    expect(CODE).not.toMatch(/\bhash\b|bcrypt|scrypt|argon|pbkdf2/i);
  });

  it("never generates a secret of its own", () => {
    expect(CODE).not.toMatch(/randomBytes|randomUUID|generatePassword|crypto\./);
  });

  it("does not return or log a recovery link", () => {
    /*
     * The link Supabase mails is a single-use credential. Nothing here asks for
     * it back — `generateLink` is the API that would return one, and it is
     * absent on purpose; `inviteUserByEmail` and `resetPasswordForEmail` send
     * it and tell us only whether sending worked.
     */
    expect(CODE).not.toMatch(/generateLink/);
    expect(CODE).not.toMatch(/action_link|actionLink/);
    expect(CODE).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("uses Supabase Auth for credentials rather than a table of its own", () => {
    expect(CODE).toMatch(/auth\.admin\.inviteUserByEmail/);
    expect(CODE).toMatch(/auth\.resetPasswordForEmail/);
  });
});

describe("the actor is never taken from the request", () => {
  it("accepts the actor as an argument on every write", () => {
    /*
     * A body-supplied actor would let a caller attribute a role change to
     * somebody else AND defeat the self-change refusal, which works by
     * comparing the target to the actor. So the actor is a parameter, and
     * nothing here resolves one for itself.
     */
    for (const fn of ["inviteUser", "patchUser", "sendRecovery"]) {
      const signature = CODE.slice(CODE.indexOf(`export async function ${fn}`));
      expect(signature.slice(0, 400), fn).toMatch(/actor: DirectoryActor|actor:\s*DirectoryActor/);
    }
    // And no lookup of "who am I" exists in this module.
    expect(CODE).not.toMatch(/authorizeRequest|getAuthProvider|pageIdentity/);
  });
});

describe("email normalization", () => {
  it("lowercases, because the database's unique index is on lower(email)", () => {
    // Sending mixed case would let two rows that collide in the database be
    // accepted here and rejected there.
    expect(normalizeEmail("  Curt.Bowen@SunTanCity.com  ")).toBe(
      "curt.bowen@suntancity.com",
    );
  });

  it("refuses anything that is not shaped like an address", () => {
    for (const bad of ["", "   ", "nope", "a@b", "@b.com", "a b@c.com", 42, null, undefined]) {
      expect(() => normalizeEmail(bad), String(bad)).toThrow(DirectoryError);
    }
  });

  it("refuses an absurdly long address rather than truncating one", () => {
    // Truncating would silently invite a DIFFERENT person than was typed.
    expect(() => normalizeEmail(`${"a".repeat(250)}@example.com`)).toThrow(DirectoryError);
  });
});

describe("scope normalization fails closed", () => {
  it("narrows an unrecognised level to salon, the smallest", () => {
    const scope = normalizeScope({ level: "planet", primaryAreaId: "loc-1" });
    expect(scope.level).toBe("salon");
  });

  it("refuses a non-global scope with no area, matching the CHECK constraint", () => {
    /*
     * `app_users_scope_area_coherent` refuses this too. Stating it here turns a
     * constraint-violation error into a sentence an administrator can act on;
     * the database still has the final say.
     */
    for (const level of ["salon", "district", "region"]) {
      expect(() => normalizeScope({ level }), level).toThrow(/needs a primary area/);
    }
  });

  it("refuses a global scope that also names an area", () => {
    expect(() => normalizeScope({ level: "global", primaryAreaId: "loc-1" })).toThrow(
      /cannot also name a primary area/,
    );
  });

  it("drops non-string entries from the also-covers list", () => {
    const scope = normalizeScope({
      level: "district",
      primaryAreaId: "dist-1",
      alsoCoversAreaIds: ["dist-2", 7, null, "dist-3"],
    });
    expect(scope.alsoCoversAreaIds).toEqual(["dist-2", "dist-3"]);
  });

  it("caps the also-covers list rather than accepting an unbounded array", () => {
    const scope = normalizeScope({
      level: "region",
      primaryAreaId: "reg-1",
      alsoCoversAreaIds: Array.from({ length: 500 }, (_, index) => `reg-${index}`),
    });
    expect(scope.alsoCoversAreaIds.length).toBeLessThanOrEqual(60);
  });
});

describe("role and status are closed sets", () => {
  it("accepts only the declared roles", () => {
    expect(isRole("employee")).toBe(true);
    expect(isRole("admin")).toBe(true);
    for (const bad of ["Admin", "ADMIN", "superuser", "", null, 1, {}]) {
      expect(isRole(bad), String(bad)).toBe(false);
    }
  });

  it("accepts only the three account statuses", () => {
    for (const good of ["invited", "active", "disabled"]) expect(isStatus(good)).toBe(true);
    for (const bad of ["pending", "Active", "", null]) expect(isStatus(bad), String(bad)).toBe(false);
  });
});

describe("the audit trail actually records what it claims to", () => {
  /*
   * ============================================================================
   * A SILENT FAILURE, AND THE TEST THAT MAKES IT LOUD.
   * ============================================================================
   *
   * `app_user_audit.action` carries a CHECK constraint. This module was writing
   * 'invitation_resent' and 'password_reset_sent', and the constraint contained
   * neither — so every one of those inserts was REJECTED. Nobody noticed,
   * because `audit()` deliberately never reads the error it gets back: a failed
   * audit must not undo a completed change. That is the right call and it is
   * also what made this invisible for as long as it existed.
   *
   * So the check moves to build time. Every action string this module can emit
   * is read out of the source and matched against the constraint in the
   * migration — which means the two cannot drift apart again without a test
   * failing, and no runtime logging is needed to notice.
   */
  const MIGRATION = readFileSync(
    "supabase/migrations/20260905001100_audit_action_vocabulary.sql",
    "utf8",
  );

  /** The action values the CHECK constraint permits. */
  const allowed = new Set(
    [...MIGRATION.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
  );

  /** Every literal this module passes as an audit action. */
  const emitted = [...SOURCE.matchAll(/action:\s*(?:[^,\n]*\?\s*)?"([a-z_]+)"(?:\s*:\s*"([a-z_]+)")?/g)]
    .flatMap((match) => [match[1], match[2]])
    .filter((value): value is string => Boolean(value));

  it("finds the action strings at all, so the sweep cannot pass vacuously", () => {
    expect(emitted.length).toBeGreaterThanOrEqual(4);
    expect(allowed.size).toBeGreaterThanOrEqual(6);
  });

  it("emits only actions the database will accept", () => {
    for (const action of emitted) {
      expect(allowed, `"${action}" is not in the CHECK constraint`).toContain(action);
    }
  });

  it("no longer emits the two names that were being rejected", () => {
    expect(emitted).not.toContain("invitation_resent");
    expect(emitted).not.toContain("password_reset_sent");
  });

  it("includes the action the activation function writes", () => {
    // `accept_invitation()` writes this one. It was missing from the constraint
    // too, and would have failed on the very first real activation.
    expect(allowed).toContain("invitation_accepted");
  });
});

describe("which email a resend actually sends", () => {
  /*
   * Decided from the CREDENTIAL, not the profile's status — and that
   * distinction is the whole point.
   *
   * An invitation whose link has been FOLLOWED leaves a confirmed auth user
   * even if the acceptance then failed. Supabase refuses to invite an address
   * that already has one, so a rule keyed on `status === "invited"` would try
   * to re-invite and be rejected: a pending invitation that could never be
   * resent. Exactly the state the first real invitation left behind.
   */
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("asks the auth system whether the address is confirmed", () => {
    expect(code).toMatch(/auth\.admin\.getUserById/);
    expect(code).toMatch(/email_confirmed_at/);
  });

  it("does NOT decide from the profile status any more", () => {
    const send = code.slice(code.indexOf("export async function sendRecovery"));
    expect(send).not.toMatch(/status === "invited" \? "invitation"/);
    expect(send).toMatch(/confirmed \? "password_reset" : "invitation"/);
  });

  it("still refuses to send anything to a disabled account", () => {
    const send = code.slice(code.indexOf("export async function sendRecovery"));
    expect(send).toMatch(/status === "disabled"/);
  });
});

describe("the refusals, exercised against a fake database", () => {
  const ADMIN_ROW = {
    id: "admin-1",
    email: "admin@suntancity.test",
    display_name: "The Admin",
    role: "admin",
    status: "active",
    scope_level: "global",
    scope_primary_area_id: null,
    scope_also_covers_area_ids: [],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  };

  /**
   * A Supabase double covering exactly the calls the directory makes.
   *
   * `adminCount` is what the last-administrator check reads, so the two cases
   * that matter — one administrator left, and more than one — are set by
   * changing a number rather than by building a table.
   */
  function fakeAdmin(options: {
    row?: Record<string, unknown>;
    adminCount: number;
    /** Whether the auth CREDENTIAL has a confirmed email. Decides the email. */
    confirmed?: boolean;
  }) {
    const updates: Record<string, unknown>[] = [];
    const audits: Record<string, unknown>[] = [];
    const sent: string[] = [];

    const client = {
      from(table: string) {
        if (table === "app_user_audit") {
          return {
            insert: async (entry: Record<string, unknown>) => {
              audits.push(entry);
              return { error: null };
            },
          };
        }
        const chain: Record<string, unknown> = {
          select: (_columns?: string, opts?: { count?: string; head?: boolean }) =>
            opts?.head
              ? { in: () => ({ eq: async () => ({ count: options.adminCount, error: null }) }) }
              : chain,
          eq: () => chain,
          ilike: () => chain,
          order: async () => ({ data: [options.row ?? ADMIN_ROW], error: null }),
          maybeSingle: async () => ({ data: options.row ?? ADMIN_ROW, error: null }),
          single: async () => ({
            data: { ...(options.row ?? ADMIN_ROW), ...(updates.at(-1) ?? {}) },
            error: null,
          }),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return chain;
          },
          insert: () => chain,
        };
        return chain;
      },
      auth: {
        admin: {
          getUserById: async () => ({
            data: {
              user: {
                email_confirmed_at: options.confirmed === false ? null : "2026-09-01T00:00:00Z",
              },
            },
            error: null,
          }),
          inviteUserByEmail: async () => {
            sent.push("invitation");
            return { data: { user: { id: "x" } }, error: null };
          },
        },
        resetPasswordForEmail: async () => {
          sent.push("password_reset");
          return { error: null };
        },
      },
    };
    return { client, updates, audits, sent };
  }

  async function loadWith(fake: ReturnType<typeof fakeAdmin>) {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      getSupabaseAdmin: () => fake.client,
      KNOWLEDGE_BUCKET: "knowledge-documents",
    }));
    return import("./user-directory");
  }

  const actor = { id: "admin-1", email: "admin@suntancity.test", role: "admin" as const };

  it("REFUSES a change to your own role", async () => {
    const fake = fakeAdmin({ adminCount: 5 });
    const { patchUser } = await loadWith(fake);

    await expect(patchUser("admin-1", { role: "employee" }, actor)).rejects.toThrow(
      /cannot change your own role/i,
    );
    // Nothing was written.
    expect(fake.updates).toEqual([]);
  });

  it("REFUSES a change to your own status", async () => {
    const fake = fakeAdmin({ adminCount: 5 });
    const { patchUser } = await loadWith(fake);

    await expect(patchUser("admin-1", { status: "disabled" }, actor)).rejects.toThrow(
      /cannot change your own role or account status/i,
    );
  });

  it("ALLOWS a change to your own display name", async () => {
    // The refusal is about ROLE and STATUS. Renaming yourself is not elevation.
    const fake = fakeAdmin({ adminCount: 5 });
    const { patchUser } = await loadWith(fake);

    await patchUser("admin-1", { displayName: "The Admin, Renamed" }, actor);
    expect(fake.updates.at(-1)?.display_name).toBe("The Admin, Renamed");
  });

  it("REFUSES demoting the LAST active administrator", async () => {
    const fake = fakeAdmin({ adminCount: 1 });
    const { patchUser } = await loadWith(fake);
    const other = { id: "someone-else", email: "other@suntancity.test", role: "admin" as const };

    await expect(patchUser("admin-1", { role: "employee" }, other)).rejects.toThrow(
      /last active administrator/i,
    );
    expect(fake.updates).toEqual([]);
  });

  it("REFUSES disabling the last active administrator", async () => {
    const fake = fakeAdmin({ adminCount: 1 });
    const { patchUser } = await loadWith(fake);
    const other = { id: "someone-else", email: "other@suntancity.test", role: "admin" as const };

    await expect(patchUser("admin-1", { status: "disabled" }, other)).rejects.toThrow(
      /last active administrator/i,
    );
  });

  it("allows the demotion once somebody else is also an administrator", async () => {
    const fake = fakeAdmin({ adminCount: 2 });
    const { patchUser } = await loadWith(fake);
    const other = { id: "someone-else", email: "other@suntancity.test", role: "admin" as const };

    await patchUser("admin-1", { role: "salon_director" }, other);
    expect(fake.updates.at(-1)?.role).toBe("salon_director");
  });

  it("allows demoting a NON-administrator without counting anything", async () => {
    const employee = { ...ADMIN_ROW, id: "emp-1", role: "employee" };
    const fake = fakeAdmin({ row: employee, adminCount: 1 });
    const { patchUser } = await loadWith(fake);

    await patchUser("emp-1", { status: "disabled" }, actor);
    expect(fake.updates.at(-1)?.status).toBe("disabled");
  });

  it("REFUSES putting an account back to invited", async () => {
    /*
     * `invited` means "a credential exists and has never been used" — a fact
     * about the credential, not an administrator's choice. Setting it by hand
     * would claim somebody had not signed in when they had.
     */
    const fake = fakeAdmin({ adminCount: 5 });
    const { patchUser } = await loadWith(fake);
    const other = { id: "someone-else", email: "other@suntancity.test", role: "admin" as const };

    await expect(patchUser("admin-1", { status: "invited" }, other)).rejects.toThrow(
      /cannot be put back to invited/i,
    );
  });

  it("writes an audit row for a role change, naming the actor", async () => {
    const fake = fakeAdmin({ adminCount: 5 });
    const { patchUser } = await loadWith(fake);
    const other = { id: "someone-else", email: "other@suntancity.test", role: "admin" as const };

    await patchUser("admin-1", { role: "salon_director" }, other);

    const entry = fake.audits.at(-1)!;
    expect(entry.action).toBe("role_changed");
    expect(entry.from_value).toBe("admin");
    expect(entry.to_value).toBe("salon_director");
    expect(entry.actor_user_id).toBe("someone-else");
    expect(entry.target_user_id).toBe("admin-1");
  });

  it("sends a RESET when the credential is already confirmed", async () => {
    /*
     * Even though the PROFILE below is still 'invited'. This is the case that
     * was broken: an invitation whose link was followed leaves a confirmed auth
     * user, Supabase refuses to invite an address that already has one, and a
     * rule keyed on status would try to re-invite and be rejected — leaving a
     * pending invitation that could never be resent.
     */
    const fake = fakeAdmin({ adminCount: 5, confirmed: true });
    const { sendRecovery } = await loadWith(fake);

    const result = await sendRecovery("admin-1", "https://app.test/auth/accept", actor);

    expect(result.kind).toBe("password_reset");
    expect(fake.sent).toEqual(["password_reset"]);
    expect(fake.audits.at(-1)?.action).toBe("reset_requested");
  });

  it("sends an INVITATION when the credential was never confirmed", async () => {
    const fake = fakeAdmin({ adminCount: 5, confirmed: false });
    const { sendRecovery } = await loadWith(fake);

    const result = await sendRecovery("admin-1", "https://app.test/auth/accept", actor);

    expect(result.kind).toBe("invitation");
    expect(fake.sent).toEqual(["invitation"]);
    expect(fake.audits.at(-1)?.action).toBe("invite_resent");
  });

  it("never returns a link or a token, only which email went out", async () => {
    const fake = fakeAdmin({ adminCount: 5, confirmed: true });
    const { sendRecovery } = await loadWith(fake);

    const result = await sendRecovery("admin-1", "https://app.test/auth/accept", actor);
    expect(Object.keys(result).sort()).toEqual(["email", "kind"]);
  });

  it("refuses to send anything to a DISABLED account", async () => {
    const fake = fakeAdmin({ row: { ...ADMIN_ROW, status: "disabled" }, adminCount: 5 });
    const { sendRecovery } = await loadWith(fake);

    await expect(
      sendRecovery("admin-1", "https://app.test/auth/callback", actor),
    ).rejects.toThrow(/disabled/i);
  });
});
