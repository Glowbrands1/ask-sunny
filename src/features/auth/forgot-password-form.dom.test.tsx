// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * ============================================================================
 * ASKING FOR A RESET LINK.
 * ============================================================================
 *
 * Two things this screen has to get right, and they pull in opposite
 * directions.
 *
 * THE ANSWER IS THE SAME WHETHER THE ADDRESS EXISTS OR NOT. A form that says
 * "no account with that email" is an account-enumeration oracle: anyone can
 * submit addresses and learn which belong to real employees. Supabase's own
 * `resetPasswordForEmail` behaves the same way, so this is reporting the truth
 * rather than concealing it — and the provider's error is swallowed for the
 * same reason, since a rate-limit message differs from a success message and
 * the difference is itself the signal.
 *
 * AND THE LINK HAS TO COME BACK SOMEWHERE THAT CAN READ IT. `redirectTo` is
 * what decides that, and pointing it at a route handler is what broke password
 * recovery: a server cannot read the `#access_token=` fragment an implicit link
 * carries, so those links were answered with "this link is spent" and bounced
 * to the sign-in screen with a live session still in the URL.
 */

const supabase = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  getSupabaseBrowserClient: supabase.getClient,
}));

const EMAIL = "manager@suntancity.com";

beforeEach(() => {
  vi.clearAllMocks();
  supabase.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  supabase.getClient.mockReturnValue({
    auth: { resetPasswordForEmail: supabase.resetPasswordForEmail },
  } as never);
});

afterEach(cleanup);

/** Fills the address and submits. */
function request(email = EMAIL) {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: /Send reset link/i }));
}

describe("where the link is asked to come back to", () => {
  it("points at /reset-password — the page that can read either link shape", async () => {
    request();

    await waitFor(() => expect(supabase.resetPasswordForEmail).toHaveBeenCalled());
    const [, options] = supabase.resetPasswordForEmail.mock.calls[0]!;
    expect((options as { redirectTo: string }).redirectTo).toBe(
      "http://localhost:3000/reset-password",
    );
  });

  it("NEVER points at a route handler", async () => {
    /*
     * The regression. `/auth/recovery` and `/auth/callback` are route handlers:
     * they read `?code=` and can never see a fragment, so an implicit link
     * pointed at either is lost.
     */
    request();

    await waitFor(() => expect(supabase.resetPasswordForEmail).toHaveBeenCalled());
    const [, options] = supabase.resetPasswordForEmail.mock.calls[0]!;
    const target = (options as { redirectTo: string }).redirectTo;
    expect(target).not.toContain("/auth/recovery");
    expect(target).not.toContain("/auth/callback");
    expect(target).not.toContain("/auth/accept");
  });

  it("carries NO query string for Supabase's redirect matching to disagree about", async () => {
    request();

    await waitFor(() => expect(supabase.resetPasswordForEmail).toHaveBeenCalled());
    const [, options] = supabase.resetPasswordForEmail.mock.calls[0]!;
    expect((options as { redirectTo: string }).redirectTo).not.toContain("?");
  });

  it("uses THIS deployment's origin, so a preview link returns to that preview", async () => {
    /*
     * Every Vercel preview has its own hostname. A fixed origin would send
     * somebody clicking the link in their email to a different deployment than
     * the one they asked from, where the cookie they are handed is useless.
     */
    window.history.replaceState(null, "", "/forgot-password");
    request();

    await waitFor(() => expect(supabase.resetPasswordForEmail).toHaveBeenCalled());
    const [, options] = supabase.resetPasswordForEmail.mock.calls[0]!;
    expect((options as { redirectTo: string }).redirectTo).toBe(
      `${window.location.origin}/reset-password`,
    );
  });

  it("trims the address rather than sending a padded one", async () => {
    request(`  ${EMAIL}  `);

    await waitFor(() => expect(supabase.resetPasswordForEmail).toHaveBeenCalled());
    expect(supabase.resetPasswordForEmail.mock.calls[0]![0]).toBe(EMAIL);
  });
});

describe("the answer is the same whatever the address is", () => {
  it("confirms for an address that exists", async () => {
    request();
    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
  });

  it("confirms identically when the provider refused", async () => {
    /*
     * Unknown address, rate limit, anything. Distinguishing them here is the
     * disclosure this screen exists to avoid.
     */
    supabase.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: { message: "For security purposes, you can only request this once every 60 seconds" },
    });
    request("nobody@example.com");

    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
    expect(screen.queryByText(/60 seconds/)).toBeNull();
    expect(screen.queryByText(/no account/i)).toBeNull();
  });

  it("offers the way back to sign-in once sent", async () => {
    request();

    const back = await screen.findByRole("link", { name: /Back to sign in/i });
    expect(back.getAttribute("href")).toBe("/login");
  });
});

describe("while it is working, and when it cannot work at all", () => {
  it("shows a loading state and blocks a second submission", async () => {
    let release: (value: { data: unknown; error: unknown }) => void = () => {};
    supabase.resetPasswordForEmail.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    request();

    const sending = await screen.findByRole("button", { name: /Sending…/i });
    expect(sending.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText(/Work email/i).hasAttribute("disabled")).toBe(true);

    fireEvent.click(sending);
    expect(supabase.resetPasswordForEmail).toHaveBeenCalledTimes(1);

    release({ data: {}, error: null });
    await waitFor(() => expect(screen.getByText(/Check your email/i)).toBeTruthy());
  });

  it("names the missing variables when the build has no Supabase values", async () => {
    /*
     * A THROW is different from a failed request: the browser client could not
     * be built at all. Naming the variables is a diagnostic, not a disclosure —
     * unlike a rate-limit message it says nothing about whether the address
     * exists.
     */
    supabase.getClient.mockImplementation(() => {
      throw new Error(
        "Sign-in is not configured for this deployment. Missing: NEXT_PUBLIC_SUPABASE_URL.",
      );
    });
    request();

    await waitFor(() =>
      expect(screen.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeTruthy(),
    );
    expect(screen.queryByText(/Check your email/i)).toBeNull();
  });
});
