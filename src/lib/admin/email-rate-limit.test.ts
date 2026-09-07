import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * A SPENT EMAIL ALLOWANCE IS REPORTED AS ONE
 * ============================================================================
 *
 * THE INCIDENT THIS PINS. Two invitations in a row failed and the screen said
 * "The invitation could not be sent. Check the address and try again." The
 * addresses were fine. Supabase Auth had answered `429
 * over_email_send_rate_limit` — the project's hourly email allowance was spent
 * on invitations sent minutes before — and the administrator spent fifteen
 * minutes and five retries looking at the wrong thing.
 *
 * Two properties, and the second matters as much as the first:
 *
 *   A RATE LIMIT SAYS SO. It is a fact about Ask Sunny's own quota, identical
 *   for an address that exists, one that does not and one that is malformed, so
 *   naming it discloses nothing.
 *
 *   EVERY OTHER PROVIDER FAILURE STAYS VAGUE. For an address that already holds
 *   a credential the provider's own message says so, and repeating it would
 *   turn this into an account-existence oracle. Only the rate limit is
 *   separated out.
 */

const ORIGINAL = { ...process.env };

/** Supabase Auth's refusal when the project's hourly allowance is spent. */
function rateLimitError() {
  return {
    name: "AuthApiError",
    message: "email rate limit exceeded",
    status: 429,
    code: "over_email_send_rate_limit",
  };
}

/** An active account, for the recovery path to find. */
const EXISTING_ROW = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "marissa.lempka@glowbrands.com",
  display_name: "Marissa Lempka",
  role: "admin",
  status: "active",
  scope_level: "global",
  scope_primary_area_id: null,
  scope_also_covers_area_ids: [],
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

interface Trace {
  invited: string[];
  resets: string[];
  inserted: Record<string, unknown>[];
}

async function loadDirectory(
  options: {
    /** Returned by inviteUserByEmail / resetPasswordForEmail. */
    sendError?: unknown;
    /** Whether the account already confirmed, which picks invite vs reset. */
    confirmed?: boolean;
  } = {},
) {
  vi.resetModules();

  const trace: Trace = { invited: [], resets: [], inserted: [] };

  const sendResult = options.sendError
    ? { data: { user: null }, error: options.sendError }
    : { data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null };

  vi.doMock("@/lib/supabase/server", () => ({
    KNOWLEDGE_BUCKET: "knowledge-documents",
    getSupabaseAdmin: () => ({
      from: (table: string) => {
        /*
         * The two `app_users` reads are told apart by their FILTER, because
         * they need opposite answers: `inviteUser` looks the address up by
         * `ilike` and must find nobody, while `sendRecovery` looks the account
         * up by `eq("id", …)` and must find somebody.
         */
        let byId = false;
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        Object.assign(builder, {
          select: chain,
          eq: (column: string) => {
            if (column === "id") byId = true;
            return builder;
          },
          ilike: chain,
          order: chain,
          limit: chain,
          insert: (values: Record<string, unknown>) => {
            if (table === "app_users") trace.inserted.push(values);
            return builder;
          },
          update: chain,
          maybeSingle: async () => ({ data: byId ? EXISTING_ROW : null, error: null }),
          single: async () => ({ data: null, error: { message: "not reached" } }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
        });
        return builder;
      },
      auth: {
        admin: {
          inviteUserByEmail: async (email: string) => {
            trace.invited.push(email);
            return sendResult;
          },
          getUserById: async () => ({
            data: {
              user: {
                id: "22222222-2222-4222-8222-222222222222",
                email_confirmed_at: options.confirmed ? "2026-09-01T00:00:00Z" : null,
              },
            },
            error: null,
          }),
        },
        resetPasswordForEmail: async (email: string) => {
          trace.resets.push(email);
          return sendResult;
        },
      },
    }),
  }));

  const directory = await import("./user-directory");
  return { directory, trace };
}

const ACTOR = { id: "actor-1", email: "admin@glowbrands.com", role: "admin" as never };

function invitation() {
  return {
    email: "curt.bowen@suntancity.com",
    displayName: "Curt Bowen",
    role: "admin",
    scope: { level: "global" },
    redirectTo: "https://example.test/auth/accept",
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = ["sb", "secret", "TESTFIXTURE"].join("_");
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});

describe("inviting when the email allowance is spent", () => {
  it("says the send limit was hit, not that the address is wrong", async () => {
    const { directory } = await loadDirectory({ sendError: rateLimitError() });

    const error = await directory
      .inviteUser(invitation(), ACTOR)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(directory.DirectoryError);
    const message = (error as Error).message;
    expect(message).toContain("hourly send limit");
    // The sentence that sent an administrator hunting the wrong thing.
    expect(message).not.toContain("Check the address");
  });

  it("tells the administrator what to do about it", async () => {
    const { directory } = await loadDirectory({ sendError: rateLimitError() });
    const error = await directory.inviteUser(invitation(), ACTOR).catch((e: unknown) => e);

    expect((error as Error).message).toContain("custom SMTP");
  });

  it("carries its own code and a 429, not the generic provider failure", async () => {
    const { directory } = await loadDirectory({ sendError: rateLimitError() });
    const error = (await directory
      .inviteUser(invitation(), ACTOR)
      .catch((e: unknown) => e)) as InstanceType<typeof directory.DirectoryError>;

    expect(error.code).toBe("email_rate_limited");
    expect(error.status).toBe(429);
  });

  it("creates no account, so re-inviting later is clean", async () => {
    /*
     * The live incident left nothing behind — `auth.users` held no half-made
     * row for either person. That is because this throws before the profile
     * insert, and it must stay that way: a stranded row would make the retry
     * fail as a duplicate.
     */
    const { directory, trace } = await loadDirectory({ sendError: rateLimitError() });
    await directory.inviteUser(invitation(), ACTOR).catch(() => {});

    expect(trace.inserted).toEqual([]);
  });

  it("names no address, so the message discloses nothing", async () => {
    const { directory } = await loadDirectory({ sendError: rateLimitError() });
    const error = await directory.inviteUser(invitation(), ACTOR).catch((e: unknown) => e);

    expect((error as Error).message).not.toContain("curt.bowen@suntancity.com");
  });

  it("recognises the refusal by status alone if the code ever changes", async () => {
    const { directory } = await loadDirectory({
      sendError: { message: "email rate limit exceeded", status: 429 },
    });
    const error = (await directory
      .inviteUser(invitation(), ACTOR)
      .catch((e: unknown) => e)) as InstanceType<typeof directory.DirectoryError>;

    expect(error.code).toBe("email_rate_limited");
  });
});

describe("every other send failure stays vague", () => {
  /*
   * For an address that already holds a credential the provider's message says
   * so. Widening the specific wording beyond the rate limit would turn this
   * endpoint into an account-existence oracle for anyone who reaches it.
   */
  const OTHERS = [
    { name: "an existing credential", error: { message: "User already registered", status: 422 } },
    { name: "a provider outage", error: { message: "upstream unavailable", status: 500 } },
    { name: "an unrecognised shape", error: "something went wrong" },
  ];

  for (const { name, error: sendError } of OTHERS) {
    it(`keeps the generic message for ${name}`, async () => {
      const { directory } = await loadDirectory({ sendError });
      const error = (await directory
        .inviteUser(invitation(), ACTOR)
        .catch((e: unknown) => e)) as InstanceType<typeof directory.DirectoryError>;

      expect(error.code).toBe("provider_failed");
      expect(error.status).toBe(502);
      expect(error.message).toContain("Check the address");
      expect(error.message).not.toContain("hourly send limit");
      // And never the provider's own words, which name the account.
      expect(error.message).not.toContain("already registered");
    });
  }
});

describe("sending a sign-in link when the allowance is spent", () => {
  it("reports the limit rather than 'try again in a moment'", async () => {
    // "Try again in a moment" is wrong by roughly an hour.
    const { directory } = await loadDirectory({
      sendError: rateLimitError(),
      confirmed: true,
    });

    const error = (await directory
      .sendRecovery("22222222-2222-4222-8222-222222222222", "https://example.test", ACTOR)
      .catch((e: unknown) => e)) as InstanceType<typeof directory.DirectoryError>;

    expect(error.code).toBe("email_rate_limited");
    expect(error.status).toBe(429);
    expect(error.message).toContain("hourly send limit");
  });

  it("keeps the generic message for anything else", async () => {
    const { directory } = await loadDirectory({
      sendError: { message: "upstream unavailable", status: 500 },
      confirmed: true,
    });

    const error = (await directory
      .sendRecovery("22222222-2222-4222-8222-222222222222", "https://example.test", ACTOR)
      .catch((e: unknown) => e)) as InstanceType<typeof directory.DirectoryError>;

    expect(error.code).toBe("provider_failed");
    expect(error.message).toContain("Try again in a moment");
  });
});

describe("the public forgot-password screen still says nothing", () => {
  it("swallows the provider result rather than reporting a rate limit", async () => {
    /*
     * THE ONE PLACE THIS MUST NOT BE FIXED. That caller is unauthenticated, and
     * a rate-limit message that differs from the success message is exactly the
     * account-enumeration oracle the screen exists to avoid. The two admin call
     * sites are both behind `manage_users`; this one is behind nothing.
     */
    const form = readFileSync("src/features/auth/forgot-password-form.tsx", "utf8");

    expect(form).toMatch(/await getSupabaseBrowserClient\(\)\.auth\.resetPasswordForEmail/);
    expect(form).not.toContain("over_email_send_rate_limit");
    expect(form).not.toContain("hourly send limit");
  });
});
