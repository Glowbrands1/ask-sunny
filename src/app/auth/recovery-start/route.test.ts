import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * /auth/recovery-start — A GET MUST NEVER SPEND THE RECOVERY TOKEN.
 * ============================================================================
 *
 * The production failure: a brand-new reset email arrived, and clicking it
 * reported the link as expired. Enterprise mail scanners GET every link in a
 * message before the recipient sees it, and Supabase's stock link verifies on
 * GET — so the scanner spent the single-use token.
 *
 * These cases prove the replacement cannot be spent by a GET of any kind
 * (scanner, prefetch, preview, repeat), and that only the Continue POST does.
 */

const TOKEN = "pkce_0123456789abcdef0123456789abcdef0123456789abcdef01234567";

const SESSION_COOKIES = [
  { name: "sb-project-auth-token", value: "session-value", options: { path: "/" } },
];

type Outcome = "verified" | "refused" | "retryable" | "throws";

async function loadRoute(
  options: { outcome?: Outcome; configured?: boolean; held?: string } = {},
) {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    options.configured === false ? "" : "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    options.configured === false ? "" : "sb_publishable_test";

  const seen = {
    clientsBuilt: 0,
    /** Every auth method called on any client, in order. */
    authCalls: [] as string[],
    verifyArgs: [] as unknown[],
  };

  const held = options.held;
  vi.doMock("next/headers", () => ({
    cookies: async () => ({
      getAll: () => (held ? [{ name: "sunny_recovery_token", value: held }] : []),
      get: (name: string) =>
        name === "sunny_recovery_token" && held ? { name, value: held } : undefined,
      set: () => {},
    }),
  }));

  vi.doMock("@/lib/supabase/auth-clients", () => ({
    getSupabaseSessionClientFor: (jar: {
      setAll: (entries: typeof SESSION_COOKIES) => void;
    }) => {
      seen.clientsBuilt += 1;
      /*
       * Any auth method at all is recorded, so a GET that touched
       * `exchangeCodeForSession`, `setSession`, `updateUser` or anything else
       * would show up here, not just `verifyOtp`.
       */
      const auth = new Proxy(
        {},
        {
          get: (_target, method: string) => async (args: unknown) => {
            seen.authCalls.push(method);
            if (method !== "verifyOtp") return { data: {}, error: null };
            seen.verifyArgs.push(args);
            switch (options.outcome ?? "verified") {
              case "verified":
                jar.setAll(SESSION_COOKIES);
                return { data: { session: { access_token: "a" } }, error: null };
              case "refused":
                return {
                  data: { session: null },
                  error: Object.assign(new Error(`Token ${TOKEN} has expired`), {
                    __isAuthError: true,
                    name: "AuthApiError",
                    status: 403,
                  }),
                };
              case "retryable": {
                const { AuthRetryableFetchError } = await import("@supabase/supabase-js");
                return {
                  data: { session: null },
                  error: new AuthRetryableFetchError("fetch failed", 0),
                };
              }
              case "throws":
                throw new Error("network down");
            }
          },
        },
      );
      return { auth };
    },
  }));

  const route = await import("./route");
  return { ...route, seen };
}

const ORIGIN = "https://ask-sunny.vercel.app";

function get(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/auth/recovery-start${query}`, { headers });
}

function post(headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}/auth/recovery-start`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: "",
  });
}

const LINK = `?token_hash=${TOKEN}&type=recovery`;

/** The raw Set-Cookie for the held token, or undefined. */
function heldCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((line) => line.startsWith("sunny_recovery_token="));
}

describe("GET — what a mail scanner, a prefetch, or the click itself does", () => {
  it("does NOT construct a Supabase client or call ANY auth method", async () => {
    const { GET, seen } = await loadRoute();
    await GET(get(LINK));

    expect(seen.clientsBuilt).toBe(0);
    expect(seen.authCalls).toEqual([]);
  });

  it("stays non-consuming however many times it is fetched, with any prefetch header", async () => {
    // Scanner, link-preview bot, Next prefetch, browser speculative load, then the person.
    const { GET, seen } = await loadRoute();
    await GET(get(LINK, { "user-agent": "Microsoft Defender SafeLinks" }));
    await GET(get(LINK, { purpose: "prefetch", "sec-purpose": "prefetch" }));
    await GET(get(LINK, { "next-router-prefetch": "1" }));
    await GET(get(LINK, { "x-middleware-prefetch": "1" }));
    await GET(get(LINK));

    expect(seen.clientsBuilt).toBe(0);
    expect(seen.authCalls).toEqual([]);
  });

  it("scrubs the token from the URL: 303 to the Continue page, no query", async () => {
    const { GET } = await loadRoute();
    const response = await GET(get(LINK));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/recovery-continue`);
    expect(response.headers.get("location")).not.toContain(TOKEN);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("holds the token in a short-lived HttpOnly, SameSite=Lax, Secure cookie scoped to /auth", async () => {
    const { GET } = await loadRoute();
    const cookie = heldCookie(await GET(get(LINK)));

    expect(cookie).toBeDefined();
    expect(cookie).toContain(`sunny_recovery_token=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/auth(;|$)/);
    expect(cookie).toMatch(/Max-Age=900/);
  });

  it("holds nothing for a link that is not type=recovery, or not token-shaped", async () => {
    const { GET, seen } = await loadRoute();

    for (const query of [
      `?token_hash=${TOKEN}`,
      `?token_hash=${TOKEN}&type=signup`,
      `?token_hash=${TOKEN}&type=magiclink`,
      `?token_hash=a;b=c&type=recovery`,
      `?token_hash=short&type=recovery`,
      "",
    ]) {
      const response = await GET(get(query));
      expect(heldCookie(response)).toBeUndefined();
      expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/recovery-continue`);
    }
    expect(seen.authCalls).toEqual([]);
  });

  it("ignores redirect parameters", async () => {
    const { GET } = await loadRoute();
    const response = await GET(get(`${LINK}&next=https://evil.example&redirect_to=//evil.example`));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/recovery-continue`);
  });
});

describe("POST — the explicit Continue action, and ONLY it, spends the token", () => {
  it("calls verifyOtp exactly once with the held token and type recovery", async () => {
    const { POST, seen } = await loadRoute({ held: TOKEN });
    await POST(post());

    expect(seen.authCalls).toEqual(["verifyOtp"]);
    expect(seen.verifyArgs).toEqual([{ token_hash: TOKEN, type: "recovery" }]);
  });

  it("writes the session cookies onto a 303 to /reset-password and releases the held token", async () => {
    const { POST } = await loadRoute({ held: TOKEN });
    const response = await POST(post());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/reset-password`);
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("session-value");
    expect(heldCookie(response)).toMatch(/Max-Age=0/);
  });

  it("reports EXPIRED only when Supabase actually refuses the token", async () => {
    const { POST } = await loadRoute({ held: TOKEN, outcome: "refused" });
    const response = await POST(post());

    expect(response.headers.get("location")).toBe(`${ORIGIN}/reset-password?link=expired`);
    expect(response.cookies.get("sb-project-auth-token")).toBeUndefined();
    expect(heldCookie(response)).toMatch(/Max-Age=0/);
    // The provider's text — which names the token — is not reflected anywhere.
    expect(JSON.stringify([...response.headers])).not.toContain(TOKEN);
  });

  it.each(["retryable", "throws"] as const)(
    "does NOT say expired when Supabase could not be reached (%s) — token still held for a retry",
    async (outcome) => {
      const { POST } = await loadRoute({ held: TOKEN, outcome });
      const response = await POST(post());

      expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/recovery-continue?retry=1`);
      expect(heldCookie(response)).toBeUndefined();
    },
  );

  it("with no held token, verifies nothing and returns to the Continue page (not 'expired')", async () => {
    const { POST, seen } = await loadRoute();
    const response = await POST(post());

    expect(seen.clientsBuilt).toBe(0);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/recovery-continue`);
  });

  it("refuses a cross-site POST before reading the token", async () => {
    const { POST, seen } = await loadRoute({ held: TOKEN });
    const response = await POST(post({ origin: "https://evil.example" }));

    expect(seen.authCalls).toEqual([]);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/auth/recovery-continue`);
  });

  it("accepts a same-origin POST that sends Origin: null", async () => {
    const { POST, seen } = await loadRoute({ held: TOKEN });
    await POST(post({ origin: "null" }));
    expect(seen.authCalls).toEqual(["verifyOtp"]);
  });
});

describe("unconfigured deployment", () => {
  it("GET and POST both go to sign-in without touching a token", async () => {
    const { GET, POST, seen } = await loadRoute({ configured: false, held: TOKEN });
    const got = await GET(get(LINK));
    const posted = await POST(post());

    expect(heldCookie(got)).toBeUndefined();
    expect(got.headers.get("location")).toMatch(/\/login\?notice=/);
    expect(posted.headers.get("location")).toMatch(/\/login\?notice=/);
    expect(seen.authCalls).toEqual([]);
  });
});

describe("the source, so a consuming call cannot be added to GET quietly", () => {
  const source = readFileSync("src/app/auth/recovery-start/route.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const getBody = code.slice(code.indexOf("export async function GET"), code.indexOf("export async function POST"));

  it("GET references no Supabase auth call and no verification helper", () => {
    expect(getBody.length).toBeGreaterThan(0);
    expect(getBody).not.toMatch(
      /verifyOtp|exchangeCodeForSession|setSession|updateUser|verifyRecoveryToken|getSupabase|exchangeCodeOnto/,
    );
  });

  it("only one place in the app calls verifyOtp for recovery", () => {
    const helper = readFileSync("src/lib/auth/recovery-token.ts", "utf8");
    expect(helper).toMatch(/verifyOtp\(\{\s*token_hash: tokenHash,\s*type: "recovery",?\s*\}\)/);
  });
});
