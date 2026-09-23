// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * ============================================================================
 * ASKING FOR A RESET LINK.
 * ============================================================================
 *
 * THE REQUEST IS MADE BY THE SERVER NOW. This form used to call
 * `resetPasswordForEmail` from the browser, whose client uses PKCE — so the
 * link could only be completed in the browser that asked for it. It now posts
 * the address to `/api/auth/forgot-password`, which asks Supabase with an
 * implicit-flow client. The browser Supabase client is not involved at all,
 * and a test below fails if it ever is.
 *
 * THE ANSWER IS THE SAME WHETHER THE ADDRESS EXISTS OR NOT. The server answers
 * every well-formed request identically; this screen shows the same
 * "If this address has an Ask Sunny account…" confirmation for all of them.
 */

const browserSupabase = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  getSupabaseBrowserClient: browserSupabase.getClient,
}));

const EMAIL = "manager@suntancity.com";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  browserSupabase.getClient.mockReturnValue({
    auth: { resetPasswordForEmail: browserSupabase.resetPasswordForEmail },
  } as never);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Fills the address and submits. */
function request(email = EMAIL) {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /Send reset link/i }));
}

describe("who makes the request", () => {
  it("posts the address to the Ask Sunny endpoint", async () => {
    request();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/auth/forgot-password");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ email: EMAIL });
  });

  it("sends ONLY the address — the server chooses where the link returns", async () => {
    request();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(Object.keys(body)).toEqual(["email"]);
  });

  it("NEVER calls resetPasswordForEmail from the browser", async () => {
    request();

    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
    expect(browserSupabase.getClient).not.toHaveBeenCalled();
    expect(browserSupabase.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("does not import the browser Supabase client at all", () => {
    const source = readFileSync("src/features/auth/forgot-password-form.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(source).not.toMatch(/browser-client|getSupabaseBrowserClient|resetPasswordForEmail/);
  });

  it("trims the address rather than sending a padded one", async () => {
    request(`  ${EMAIL}  `);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.email).toBe(EMAIL);
  });
});

describe("the answer is the same whatever the address is", () => {
  it("confirms with the existing wording", async () => {
    request();
    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
    expect(screen.getByText(/has an Ask Sunny account/i)).toBeTruthy();
  });

  it("confirms identically for an unknown address (the server says ok either way)", async () => {
    request("nobody@example.com");

    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
    expect(screen.queryByText(/no account/i)).toBeNull();
    expect(screen.queryByText(/60 seconds|rate limit/i)).toBeNull();
  });

  it("offers the way back to sign-in once sent", async () => {
    request();

    const back = await screen.findByRole("link", { name: /Back to sign in/i });
    expect(back.getAttribute("href")).toBe("/login");
  });
});

describe("while it is working, and when it cannot work at all", () => {
  it("shows a loading state and blocks a second submission", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    request();

    const sending = await screen.findByRole("button", { name: /Sending…/i });
    expect(sending.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText(/Work email/i).hasAttribute("disabled")).toBe(true);

    fireEvent.click(sending);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
  });

  it("names the missing variables when the deployment has no Supabase values (503)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Password reset is not configured for this deployment. Missing: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
        }),
        { status: 503 },
      ),
    );
    request();

    await waitFor(() => expect(screen.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeTruthy());
    expect(screen.queryByText(/Check your email/i)).toBeNull();
  });

  it("says so when the request could not be sent at all", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    request();

    await waitFor(() => expect(screen.getByText(/could not be reached/i)).toBeTruthy());
    expect(screen.queryByText(/Check your email/i)).toBeNull();
  });
});
