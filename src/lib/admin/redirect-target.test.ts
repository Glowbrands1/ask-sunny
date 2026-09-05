import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  implicitRedirectTarget,
  implicitRedirectTargetFor,
  pkceRedirectTarget,
} from "./redirect-target";

/**
 * ============================================================================
 * WHERE AN EMAILED LINK LANDS. THE BUG THIS FILE EXISTS FOR.
 * ============================================================================
 *
 * Supabase returns a session in one of two shapes, and which one is decided by
 * WHICH CLIENT asked for the link — not by any project setting:
 *
 *   `?code=…`          query string, readable by a server. Only the BROWSER
 *                      produces it, because PKCE needs a code verifier the
 *                      browser stores.
 *   `#access_token=…`  URL fragment, NEVER transmitted to a server. Everything
 *                      sent from the server produces this.
 *
 * The first real invitation pointed at `/auth/callback`, a route handler. The
 * fragment never reached it, so it saw a request with no `code`, concluded the
 * link was invalid, and sent the person back to sign-in. No amount of Site URL
 * configuration could have fixed that.
 */

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function request(url = "https://preview.vercel.app/api/admin/users"): Request {
  return new Request(url, { method: "POST" });
}

describe("the two link shapes get two destinations", () => {
  it("sends an IMPLICIT link to a client page, which can read a fragment", () => {
    expect(implicitRedirectTarget(request())).toBe(
      "https://preview.vercel.app/auth/accept",
    );
  });

  it("sends a PKCE link to the recovery route, with NO query string", () => {
    /*
     * This used to return `/auth/callback?next=%2Freset-password`. The browser
     * really did request that — `resetPasswordForEmail` transmits `redirectTo`
     * verbatim — and Supabase declined it anyway, falling back to the Site URL
     * root with `?code=`. Adding the exact query-string URL to the allowlist
     * did not change it, so the query string is gone and the destination is
     * fixed inside the route.
     */
    expect(pkceRedirectTarget(request())).toBe(
      "https://preview.vercel.app/auth/recovery",
    );
    expect(pkceRedirectTarget(request())).not.toContain("?");
  });

  it("NEVER points an implicit link at the PKCE callback", () => {
    // The regression, stated as plainly as it can be.
    expect(implicitRedirectTarget(request())).not.toContain("/auth/callback");
  });

  it("gives the implicit target no `next` parameter to be talked into", () => {
    /*
     * The destination after a fragment is consumed is always "set a password".
     * Making it configurable would put a redirect target into a URL that
     * arrives by email — an open redirect delivered by a message from a real
     * sender, which is worse than one delivered by a link.
     */
    const target = implicitRedirectTarget(request());
    expect(target).not.toContain("?");
    expect(target).not.toContain("next=");
  });
});

describe("which origin a link points back at", () => {
  it("uses the request's own origin, so a preview link returns to that preview", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(implicitRedirectTarget(request("https://pr-42.vercel.app/api/x"))).toBe(
      "https://pr-42.vercel.app/auth/accept",
    );
  });

  it("prefers a configured site URL when one is set", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ask-sunny.example/";
    expect(implicitRedirectTarget(request("https://pr-42.vercel.app/api/x"))).toBe(
      "https://ask-sunny.example/auth/accept",
    );
  });

  it("tolerates a trailing slash rather than producing a doubled one", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ask-sunny.example/";
    expect(implicitRedirectTarget(request())).not.toContain("//auth");
  });

  it("builds the same target from a bare origin, for callers with no request", () => {
    expect(implicitRedirectTargetFor("https://ask-sunny.example")).toBe(
      "https://ask-sunny.example/auth/accept",
    );
    expect(implicitRedirectTargetFor("https://ask-sunny.example/some/path")).toBe(
      "https://ask-sunny.example/auth/accept",
    );
  });
});

describe("every server-sent link uses the implicit destination", () => {
  /*
   * Read from the routes rather than asserted about them, so a fourth
   * server-sent email added later cannot quietly point at the callback again.
   */
  const SERVER_SENDERS = [
    "src/app/api/admin/users/route.ts",
    "src/app/api/admin/users/[id]/recovery/route.ts",
  ];

  it.each(SERVER_SENDERS)("%s asks for the implicit target", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("implicitRedirectTarget(request)");
    expect(source).not.toContain("pkceRedirectTarget");
  });

  it("the bootstrap script points at the acceptance page too", () => {
    /*
     * Comments stripped before matching: the script EXPLAINS why it does not
     * use `/auth/callback`, and that explanation is the one place the string is
     * supposed to appear.
     */
    const script = readFileSync("scripts/bootstrap-admin.mjs", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(script).toContain("/auth/accept");
    expect(script).not.toMatch(/auth\/callback/);
  });

  it("the BROWSER-initiated reset points at the recovery route, not accept", () => {
    /*
     * `/forgot-password` runs in the browser with `flowType: "pkce"`, so its
     * link really does come back as `?code=` and really does need a route
     * handler — just not one that depends on a query string. It must never
     * point at `/auth/accept`, which reads a fragment and would find none.
     */
    const form = readFileSync("src/features/auth/forgot-password-form.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(form).toMatch(/recoveryUrlFor/);
    expect(form).not.toContain("/auth/accept");
    expect(form).not.toContain("/auth/callback");
  });
});
