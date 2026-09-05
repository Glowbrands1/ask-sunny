// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { AcceptSessionForm } from "./accept-session-form";

/**
 * ============================================================================
 * ACCEPTING AN INVITATION DELIVERED IN A URL FRAGMENT.
 * ============================================================================
 *
 * The real Supabase invitation arrives as `#access_token=…&refresh_token=…`.
 * These tests use that exact shape, because the failure being fixed was
 * precisely a mismatch between the shape we assumed and the shape we got.
 *
 * Two properties matter beyond "does it work":
 *
 *   THE TOKEN GOES TO SUPABASE AND NOWHERE ELSE. Not to an Ask Sunny endpoint,
 *   not to a log, not into rendered output.
 *
 *   THE FRAGMENT LEAVES THE HISTORY ENTRY IMMEDIATELY, via `replaceState` —
 *   which rewrites the entry the browser is sitting on, so the token is out of
 *   the address bar AND out of the back button. Assigning `location.hash = ""`
 *   would not do that: it is a same-document navigation that pushes a new entry
 *   and leaves the token in the previous one.
 */

const ACCESS = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.FAKE-ACCESS.SIGNATURE";
const REFRESH = "FAKE-REFRESH-TOKEN-VALUE";

const supabase = vi.hoisted(() => ({
  setSession: vi.fn(async () => ({ data: {}, error: null as unknown })),
  getUser: vi.fn(async () => ({ data: { user: null as unknown }, error: null as unknown })),
  // A vi.fn(), so one case can make CONSTRUCTION itself throw — which is what a
  // build with no Supabase values actually does.
  getClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  getSupabaseBrowserClient: supabase.getClient,
}));

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

/** Every fetch this component makes. There must not be any. */
const fetchSpy = vi.fn();

function goTo(hash: string) {
  window.history.replaceState(null, "", `/auth/accept${hash}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase.setSession.mockResolvedValue({ data: {}, error: null });
  supabase.getUser.mockResolvedValue({ data: { user: null }, error: null });
  supabase.getClient.mockReturnValue({
    auth: { setSession: supabase.setSession, getUser: supabase.getUser },
  } as never);
  globalThis.fetch = fetchSpy as never;
  goTo("");
});

afterEach(cleanup);

describe("a real invitation fragment", () => {
  const REAL = `#access_token=${ACCESS}&expires_in=3600&refresh_token=${REFRESH}&token_type=bearer&type=invite`;

  it("hands the tokens to Supabase and establishes the session", async () => {
    goTo(REAL);
    render(<AcceptSessionForm />);

    await waitFor(() => expect(supabase.setSession).toHaveBeenCalledTimes(1));
    expect(supabase.setSession).toHaveBeenCalledWith({
      access_token: ACCESS,
      refresh_token: REFRESH,
    });
  });

  it("SCRUBS the fragment from the history entry before anything awaits", async () => {
    goTo(REAL);
    render(<AcceptSessionForm />);

    await waitFor(() => expect(supabase.setSession).toHaveBeenCalled());
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(ACCESS);
    expect(window.location.href).not.toContain(REFRESH);
    expect(window.location.pathname).toBe("/auth/accept");
  });

  it("sends the person on to set a password", async () => {
    goTo(REAL);
    render(<AcceptSessionForm />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/reset-password"));
    // Refresh first, or the server components rendered signed-out stay cached.
    expect(router.refresh).toHaveBeenCalled();
  });

  it("NEVER sends the token to an Ask Sunny endpoint", async () => {
    /*
     * The load-bearing one. `setSession` is Supabase's own client; a `fetch`
     * from this component would mean a raw credential crossing our own API,
     * where it would land in server logs.
     */
    goTo(REAL);
    render(<AcceptSessionForm />);

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never renders the token", async () => {
    goTo(REAL);
    const { container } = render(<AcceptSessionForm />);

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(container.innerHTML).not.toContain(ACCESS);
    expect(container.innerHTML).not.toContain(REFRESH);
  });

  it("handles a recovery fragment the same way", async () => {
    // An administrator-sent sign-in link is `type=recovery` and otherwise
    // identical. Same route, same handling, same destination.
    goTo(`#access_token=${ACCESS}&refresh_token=${REFRESH}&type=recovery`);
    render(<AcceptSessionForm />);

    await waitFor(() => expect(supabase.setSession).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith("/reset-password");
  });
});

describe("a link that no longer works", () => {
  it("reports a spent link without echoing the provider's text", async () => {
    goTo(
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    render(<AcceptSessionForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(supabase.setSession).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    // Provider text is attacker-influencable and says nothing actionable.
    expect(document.body.textContent).not.toContain("Email link is invalid");
  });

  it("scrubs an ERROR fragment too", async () => {
    goTo("#error=access_denied&error_code=otp_expired");
    render(<AcceptSessionForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(window.location.hash).toBe("");
  });

  it("reports a spent link when Supabase rejects the tokens", async () => {
    supabase.setSession.mockResolvedValue({
      data: {},
      error: { message: "Invalid Refresh Token: Already Used" },
    });
    goTo(`#access_token=${ACCESS}&refresh_token=${REFRESH}&type=invite`);
    render(<AcceptSessionForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    // Not the provider's message.
    expect(document.body.textContent).not.toContain("Already Used");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("arriving with no fragment", () => {
  it("continues when the client already consumed it", async () => {
    /*
     * `detectSessionInUrl` is on by default in the browser, so if the Supabase
     * client happened to be constructed first it would have taken the fragment
     * itself. Asking the auth server settles which happened, rather than
     * assuming an order.
     */
    supabase.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    render(<AcceptSessionForm />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/reset-password"));
    expect(supabase.setSession).not.toHaveBeenCalled();
  });

  it("reports a spent link when there is no session either", async () => {
    render(<AcceptSessionForm />);
    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
  });

  it("names the missing variables when the build is not configured", async () => {
    // A configuration failure is not a link failure, and the message an
    // operator needs is which variable is unset.
    supabase.getClient.mockImplementationOnce(() => {
      throw new Error("Sign-in is not configured. Missing: NEXT_PUBLIC_SUPABASE_URL.");
    });

    render(<AcceptSessionForm />);
    await waitFor(() =>
      expect(screen.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeTruthy(),
    );
  });
});

describe("the source itself", () => {
  const source = readFileSync("src/features/auth/accept-session-form.tsx", "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("logs nothing at all", () => {
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("uses replaceState, never a hash assignment", () => {
    /*
     * `location.hash = ""` is a NAVIGATION: it adds a history entry and leaves
     * the token sitting in the previous one, which is exactly what must not
     * happen.
     */
    expect(code).toMatch(/history\.replaceState/);
    expect(code).not.toMatch(/location\.hash\s*=/);
  });

  it("has no fetch of its own", () => {
    expect(code).not.toMatch(/\bfetch\(/);
  });
});
