import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  APP_USER_COLUMNS,
  getAppUser,
  profileDenialMessage,
  toAppUserProfile,
  type ProfileDenial,
} from "./app-user";

/**
 * ============================================================================
 * FAIL CLOSED. THIS IS THE FILE THAT SAYS SO.
 * ============================================================================
 *
 * A Supabase session proves somebody holds a credential. It proves nothing
 * about what they may do. Everything below is about the gap between those two
 * facts, and the rule is that the gap is never filled with a guess.
 *
 * The dangerous shape is a helpful default. "No profile? Treat them as an
 * Employee" sounds cautious and is not: it invents an authorization decision
 * out of an absence, and it means anyone who can create an auth user becomes a
 * user of this application. "No profile? Treat them as Admin" is the same
 * mistake with a worse blast radius. There is no role, so there is no access.
 */

/** A row shaped exactly as the database returns one. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "curt.bowen@suntancity.test",
    display_name: "Curt Bowen",
    role: "admin",
    status: "active",
    scope_level: "global",
    scope_primary_area_id: null,
    scope_also_covers_area_ids: [],
    created_at: "2026-09-04T12:00:00.000Z",
    updated_at: "2026-09-04T12:00:00.000Z",
    ...overrides,
  };
}

function denial(result: ReturnType<typeof toAppUserProfile>): ProfileDenial | null {
  return result.ok ? null : result.denial;
}

describe("a row that describes an active user", () => {
  it("becomes a profile carrying the role from the DATABASE", () => {
    const result = toAppUserProfile(row());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.profile.role).toBe("admin");
    expect(result.profile.email).toBe("curt.bowen@suntancity.test");
    expect(result.profile.displayName).toBe("Curt Bowen");
    expect(result.profile.scope.level).toBe("global");
  });

  it("falls back to the email when no display name was recorded", () => {
    for (const value of ["", "   ", null, undefined, 42]) {
      const result = toAppUserProfile(row({ display_name: value }));
      expect(result.ok, String(value)).toBe(true);
      if (result.ok) expect(result.profile.displayName).toBe(result.profile.email);
    }
  });

  it("keeps the also-covers list and drops anything that is not a string", () => {
    const result = toAppUserProfile(
      row({ scope_also_covers_area_ids: ["district-2", 7, null, "district-3"] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.scope.alsoCoversAreaIds).toEqual(["district-2", "district-3"]);
    }
  });
});

describe("every way a lookup can fail, and it denies in all of them", () => {
  it("DENIES when there is no profile row at all", () => {
    // The case most likely to be "helpfully" defaulted. It must not be.
    for (const value of [null, undefined, "", 0, false]) {
      expect(denial(toAppUserProfile(value)), String(value)).toBe("no_profile");
    }
  });

  it("DENIES a disabled profile without deleting the credential", () => {
    /*
     * Revoking access must not require deleting the auth user, because that
     * destroys the record of who did what. So `disabled` has to be a refusal
     * here rather than a row that simply stops existing.
     */
    expect(denial(toAppUserProfile(row({ status: "disabled" })))).toBe("disabled");
  });

  it("DENIES an invited profile that has not accepted", () => {
    expect(denial(toAppUserProfile(row({ status: "invited" })))).toBe("invited");
  });

  it("DENIES a role this build does not recognise", () => {
    /*
     * A database ahead of the deployed code. Note what the alternative looks
     * like: the permission matrix returns false for an unknown role, so the
     * person would appear to be a signed-in user who can do nothing — which
     * looks like a permissions bug and is really a version skew. Refusing is
     * both safer and more diagnosable.
     */
    for (const role of ["superuser", "Admin", "ADMIN", "", null, 1]) {
      expect(denial(toAppUserProfile(row({ role }))), String(role)).toBe("unknown_role");
    }
  });

  it("DENIES a status this build does not recognise", () => {
    for (const status of ["pending", "suspended", "", null]) {
      expect(denial(toAppUserProfile(row({ status }))), String(status)).toBe("no_profile");
    }
  });

  it("DENIES a row whose id or email is not a string", () => {
    expect(denial(toAppUserProfile(row({ id: null })))).toBe("no_profile");
    expect(denial(toAppUserProfile(row({ email: 42 })))).toBe("no_profile");
  });

  it("NEVER returns a profile for any malformed input", () => {
    /*
     * THE LOAD-BEARING TEST. Not a list of known-bad rows — a sweep asserting
     * that the ONLY thing that produces a profile is a row that is active with
     * a recognised role. Anything else, including shapes nobody has thought of,
     * denies.
     */
    const shapes: unknown[] = [
      null,
      undefined,
      0,
      "",
      "admin",
      [],
      [row()],
      {},
      { role: "admin" },
      { status: "active" },
      row({ role: "wizard" }),
      row({ status: "active", role: undefined }),
      row({ id: undefined }),
    ];
    for (const shape of shapes) {
      expect(toAppUserProfile(shape).ok, JSON.stringify(shape)).toBe(false);
    }
  });
});

describe("scope, which fails closed in the other direction", () => {
  it("narrows an unrecognised scope level to salon rather than refusing", () => {
    /*
     * Deliberately unlike the role checks, and the asymmetry is the point.
     * ROLE decides what somebody may DO, so a value we cannot read must refuse.
     * SCOPE decides how MUCH they see, so the fail-closed answer is the
     * smallest scope — refusing sign-in over an unreadable scope would lock a
     * real user out over a data-breadth question.
     */
    for (const level of ["planet", "", null, 3]) {
      const result = toAppUserProfile(row({ scope_level: level }));
      expect(result.ok, String(level)).toBe(true);
      if (result.ok) expect(result.profile.scope.level).toBe("salon");
    }
  });

  it("never widens scope on the way through", () => {
    const result = toAppUserProfile(
      row({ scope_level: "salon", scope_primary_area_id: "loc-1", scope_also_covers_area_ids: [] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.scope).toEqual({
        level: "salon",
        primaryAreaId: "loc-1",
        alsoCoversAreaIds: [],
      });
    }
  });
});

describe("the query getAppUser makes", () => {
  function fakeClient(answer: { data?: unknown; error?: unknown }) {
    const calls: { table?: string; columns?: string; eq?: [string, string] } = {};
    const chain = {
      select(columns: string) {
        calls.columns = columns;
        return chain;
      },
      eq(column: string, value: string) {
        calls.eq = [column, value];
        return chain;
      },
      maybeSingle: async () => answer,
    };
    const client = {
      from(table: string) {
        calls.table = table;
        return chain;
      },
    };
    return { client: client as never, calls };
  }

  it("reads one row of app_users, keyed on the subject", async () => {
    const { client, calls } = fakeClient({ data: row(), error: null });
    const result = await getAppUser(client, "11111111-1111-4111-8111-111111111111");

    expect(calls.table).toBe("app_users");
    expect(calls.eq).toEqual(["id", "11111111-1111-4111-8111-111111111111"]);
    // An explicit column list, not `select *`: a column added later must be
    // opted into rather than silently arriving in an authorization decision.
    expect(calls.columns).toBe(APP_USER_COLUMNS);
    expect(calls.columns).not.toContain("*");
    expect(result.ok).toBe(true);
  });

  it("DENIES when the query itself fails", async () => {
    /*
     * A database that cannot answer "who is this" has not answered "anyone".
     * Note also what is NOT surfaced: the Postgres message can quote row
     * contents, so the caller gets a code and an operator gets the detail from
     * Supabase's own logs.
     */
    const { client } = fakeClient({
      error: { message: 'permission denied for table app_users DETAIL: Key (email)=(x@y.z)' },
    });
    const result = await getAppUser(client, "someone");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denial).toBe("lookup_failed");
    expect(JSON.stringify(result)).not.toContain("x@y.z");
  });

  it("DENIES when no row comes back", async () => {
    const { client } = fakeClient({ data: null, error: null });
    const result = await getAppUser(client, "nobody");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.denial).toBe("no_profile");
  });
});

describe("what a denied person is told", () => {
  it("does not disclose whether an account exists", () => {
    /*
     * "Your account is disabled" and "you have no account" are both true and
     * both leak. The three profile-state denials share one sentence.
     */
    const shared = [
      profileDenialMessage("no_profile"),
      profileDenialMessage("disabled"),
      profileDenialMessage("invited"),
    ];
    expect(new Set(shared).size).toBe(1);
    expect(shared[0]).not.toMatch(/disabled|invited|does not exist|no account/i);
  });

  it("points at the administrator, who can actually fix it", () => {
    expect(profileDenialMessage("no_profile")).toMatch(/administrator/i);
  });

  it("distinguishes a transient failure from a refusal", () => {
    // Worth separating: "try again" is right for one and misleading for the
    // other, and a person who retries forever on a real denial gets nowhere.
    expect(profileDenialMessage("lookup_failed")).toMatch(/try again/i);
    expect(profileDenialMessage("unknown_role")).toMatch(/role/i);
  });
});

describe("the code cannot read a role from anywhere else", () => {
  /**
   * Strips comments before matching.
   *
   * Needed because these files EXPLAIN the things they must not do — the
   * provider carries a note about why a role is never read from
   * `user_metadata`, and another about why nothing here logs. Matching raw
   * text would fail on the documentation of the rule, which is the one place
   * the words are supposed to appear.
   */
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const source = code("src/lib/auth/app-user.ts");
  const provider = code("src/lib/auth/supabase-provider.ts");

  it("never reads user metadata, which the account holder can write", () => {
    /*
     * `supabase.auth.updateUser({ data: { role: "admin" } })` is a call the
     * signed-in person can make themselves. A role read from user_metadata is
     * therefore a self-service promotion, and these two files are where such a
     * read would go.
     */
    for (const file of [source, provider]) {
      expect(file).not.toMatch(/user_metadata/);
      expect(file).not.toMatch(/app_metadata/);
      expect(file).not.toMatch(/raw_user_meta_data/);
    }
  });

  it("has no branch on a specific email address", () => {
    /*
     * The bootstrap of the first administrator is DATA, not code. An
     * `if (email === "...") return "admin"` would be a permanent bypass that
     * survives every later change to the profile row.
     */
    for (const file of [source, provider]) {
      expect(file).not.toMatch(/suntancity\.com/i);
      expect(file).not.toMatch(/curt/i);
    }
  });

  it("logs nothing at all on the identification path", () => {
    // identify() runs on every protected request. One console.log here streams
    // access tokens at the rate of the entire application's traffic.
    for (const file of [source, provider]) {
      expect(file).not.toMatch(/console\.(log|info|warn|error|debug)/);
    }
  });
});
