import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  implicitRedirectTarget,
  implicitRedirectTargetFor,
  recoveryRedirectTarget,
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

  it("sends a RECOVERY link to a client page too, with NO query string", () => {
    /*
     * This used to return a route handler — first `/auth/callback?next=…`, then
     * `/auth/recovery`. Both can read the `?code=` a PKCE link carries, and
     * NEITHER can read the `#access_token=` an implicit one carries, because a
     * browser does not transmit fragments. Since this project issues both
     * shapes, every implicit reset link was answered with "this link is spent"
     * and bounced to `/login` — with the live session still in the fragment.
     *
     * The query string stays gone, which is the part of the earlier fix that
     * was right: a path with no `?` cannot be affected by redirect-matching
     * across one.
     */
    expect(recoveryRedirectTarget(request())).toBe(
      "https://preview.vercel.app/reset-password",
    );
    expect(recoveryRedirectTarget(request())).not.toContain("?");
  });

  it("NEVER points a recovery link at a route handler", () => {
    // The regression, stated as plainly as the invitation one below it.
    const target = recoveryRedirectTarget(request());
    expect(target).not.toContain("/auth/recovery");
    expect(target).not.toContain("/auth/callback");
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
    expect(source).not.toContain("recoveryRedirectTarget");
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

  it("the public Forgot Password request points at the recovery page, not accept", () => {
    /*
     * `/api/auth/forgot-password` asks Supabase server-side with an implicit
     * client, so its link returns to `/reset-password` as a fragment. It must
     * never point at `/auth/accept` (invitation wording) or a route handler.
     */
    const route = readFileSync("src/app/api/auth/forgot-password/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(route).toContain("redirectTo: recoveryRedirectTarget(request)");
    expect(route).not.toContain("implicitRedirectTarget");
    expect(route).not.toContain("/auth/accept");
    expect(route).not.toContain("/auth/callback");
  });
});
