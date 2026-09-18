import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EXPIRED_MARKER, EXPIRED_QUERY, readRecoveryLink } from "./recovery-link";

/**
 * ============================================================================
 * THE TWO SHAPES A RECOVERY LINK COMES BACK IN. THE BUG THIS FILE EXISTS FOR.
 * ============================================================================
 *
 * Supabase returns a recovery session either as `?code=` (PKCE) or as
 * `#access_token=` (implicit), decided by the client that asked for the link
 * rather than by any project setting. Both reach this project: the browser's
 * `resetPasswordForEmail` sends a PKCE challenge, and every link sent from the
 * server is implicit.
 *
 * Recovery used to land on a ROUTE HANDLER, which can only ever see the first —
 * a browser does not transmit a fragment. So an implicit link looked like an
 * empty request, the handler concluded it was spent and redirected to `/login`,
 * and the browser re-attached the fragment to that redirect. The person landed
 * on the sign-in screen holding a live recovery session nothing would read.
 *
 * These cases are what stops that coming back.
 */

/** A realistic implicit fragment, in the order Supabase writes it. */
const IMPLICIT =
  "#access_token=eyJhbGciOiJIUzI1NiJ9.fake-access&expires_at=1789999999&expires_in=3600" +
  "&refresh_token=fake-refresh-token&token_type=bearer&type=recovery";

const PKCE = "?code=one-time-pkce-code-abc123";

describe("an implicit recovery link", () => {
  it("is read from the fragment", () => {
    expect(readRecoveryLink("", IMPLICIT)).toEqual({
      kind: "implicit",
      accessToken: "eyJhbGciOiJIUzI1NiJ9.fake-access",
      refreshToken: "fake-refresh-token",
    });
  });

  it("is read even with no leading hash, as a caller might pass it", () => {
    expect(readRecoveryLink("", IMPLICIT.slice(1)).kind).toBe("implicit");
  });

  it("needs BOTH tokens — half a session is not a session", () => {
    expect(readRecoveryLink("", "#access_token=only-this").kind).toBe("none");
    expect(readRecoveryLink("", "#refresh_token=only-this").kind).toBe("none");
  });

  it("is accepted whatever `type` says", () => {
    /*
     * Invitations and administrator-sent sign-in links arrive in the same shape
     * and legitimately end at this screen. The token is validated by Supabase
     * either way, so refusing on a label would reject real links to enforce
     * something the label cannot prove.
     */
    const invite = IMPLICIT.replace("type=recovery", "type=invite");
    expect(readRecoveryLink("", invite).kind).toBe("implicit");
  });
});

describe("a PKCE recovery link", () => {
  it("is read from the query string", () => {
    expect(readRecoveryLink(PKCE, "")).toEqual({
      kind: "pkce",
      code: "one-time-pkce-code-abc123",
    });
  });

  it("is read with no leading question mark", () => {
    expect(readRecoveryLink(PKCE.slice(1), "").kind).toBe("pkce");
  });

  it("loses to a fragment when somehow both are present", () => {
    /*
     * The fragment already contains a session, so preferring it avoids an
     * exchange round trip — and a stale `?code=` from an earlier navigation
     * cannot override a session that is actually in hand.
     */
    expect(readRecoveryLink(PKCE, IMPLICIT).kind).toBe("implicit");
  });
});

describe("a link the provider refused", () => {
  it("is recognised in the fragment", () => {
    const spent =
      "#error=access_denied&error_code=otp_expired" +
      "&error_description=Email+link+is+invalid+or+has+expired";
    expect(readRecoveryLink("", spent)).toEqual({ kind: "rejected" });
  });

  it("is recognised in the query string", () => {
    expect(
      readRecoveryLink("?error=access_denied&error_code=otp_expired", ""),
    ).toEqual({ kind: "rejected" });
  });

  it("is recognised from our own marker, set by the legacy route", () => {
    expect(readRecoveryLink(EXPIRED_QUERY, "")).toEqual({ kind: "rejected" });
  });

  it("NEVER carries the provider's text out with it", () => {
    /*
     * `error_description` is attacker-influencable text that would be rendered
     * on a page, and it says nothing a person can act on beyond "the link did
     * not work". The outcome is the whole result.
     */
    const result = readRecoveryLink(
      "?error_description=Email+link+is+invalid",
      "#error=access_denied&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(JSON.stringify(result)).not.toContain("invalid or has expired");
    expect(JSON.stringify(result)).not.toContain("Email");
    expect(Object.keys(result)).toEqual(["kind"]);
  });

  it("prefers a real session over an error sitting in the other half", () => {
    // A spent `?code=` alongside a working fragment must not blank the session.
    expect(readRecoveryLink("?error=access_denied", IMPLICIT).kind).toBe("implicit");
  });
});

describe("no recovery material at all", () => {
  it.each([
    ["a direct visit", "", ""],
    ["a bare hash", "", "#"],
    ["a bare question mark", "?", ""],
    ["an unrelated parameter", "?utm_source=email", "#section"],
  ])("%s reads as none", (_label, search, hash) => {
    expect(readRecoveryLink(search, hash)).toEqual({ kind: "none" });
  });

  it("does not treat an empty code as a code", () => {
    expect(readRecoveryLink("?code=", "").kind).toBe("none");
  });
});

describe("the source itself", () => {
  const source = readFileSync("src/lib/auth/recovery-link.ts", "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("logs nothing — it handles session tokens", () => {
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("reads nothing from `window`, so it is testable and reusable", () => {
    expect(code).not.toMatch(/\bwindow\b|\bdocument\b|\blocation\b/);
  });

  it("keeps the marker name in one place", () => {
    // The route writes it and the parser reads it; a literal in either would
    // let them drift apart silently.
    expect(EXPIRED_QUERY).toBe(`?${EXPIRED_MARKER}=expired`);
  });
});
