// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ResetPasswordForm } from "./reset-password-form";

/**
 * ============================================================================
 * SETTING A PASSWORD, AND THE STEP THAT MUST FOLLOW IT.
 * ============================================================================
 *
 * Setting a password is not by itself enough to use Ask Sunny. An INVITED
 * profile is refused by the auth provider, so somebody who set a password and
 * stopped would hold a working credential the application still turns away —
 * the worst of both. Activation therefore happens here, where we know the
 * password actually took.
 *
 * The password itself goes to Supabase and nowhere else: no Ask Sunny endpoint
 * ever receives it, and the activation call that follows carries no body at all.
 */

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({
    data: { user: { id: "u1" } as { id: string } | null },
    error: null as unknown,
  })),
  updateUser: vi.fn(async () => ({ data: {}, error: null as unknown })),
  getClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  getSupabaseBrowserClient: supabase.getClient,
}));

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchSpy = vi.fn();

const PASSWORD = "correct-horse-battery";

beforeEach(() => {
  vi.clearAllMocks();
  supabase.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  supabase.updateUser.mockResolvedValue({ data: {}, error: null });
  supabase.getClient.mockReturnValue({
    auth: { getUser: supabase.getUser, updateUser: supabase.updateUser },
  } as never);

  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ activated: true, landing: "/" }),
  });
  globalThis.fetch = fetchSpy as never;
});

afterEach(cleanup);

/** Fills both fields and submits, once the session check has settled. */
async function setPassword(value = PASSWORD, confirm = value) {
  render(<ResetPasswordForm />);
  await waitFor(() => expect(screen.getByLabelText(/^New password$/i)).toBeTruthy());

  fireEvent.change(screen.getByLabelText(/^New password$/i), { target: { value } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: /Set password and continue/i }));
}

describe("the password itself", () => {
  it("goes to Supabase and to no Ask Sunny endpoint", async () => {
    await setPassword();
    await waitFor(() => expect(supabase.updateUser).toHaveBeenCalledWith({ password: PASSWORD }));

    // Every fetch this component makes, checked for the value.
    for (const [, init] of fetchSpy.mock.calls) {
      expect(JSON.stringify(init ?? {})).not.toContain(PASSWORD);
    }
  });

  it("refuses a password that is too short, without calling anything", async () => {
    /*
     * Scoped to the ERROR notice. The form also carries a standing hint saying
     * "At least 12 characters", so a bare text match finds two elements and
     * would pass even if the refusal never appeared.
     */
    await setPassword("short");
    await waitFor(() =>
      expect(screen.getByText(/Could not set your password/i)).toBeTruthy(),
    );
    expect(screen.getByText(/Use at least 12 characters\./)).toBeTruthy();
    expect(supabase.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a mismatched confirmation", async () => {
    await setPassword(PASSWORD, "something-else-entirely");
    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeTruthy());
    expect(supabase.updateUser).not.toHaveBeenCalled();
  });
});

describe("activation, once the password is set", () => {
  it("asks the server to activate, with NO body", async () => {
    await setPassword();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/auth/accept-invitation");
    expect((init as RequestInit).method).toBe("POST");
    // Nothing to trust: no id, no role, no status, no token.
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("goes to the landing page the SERVER chose", async () => {
    /*
     * An Employee cannot open the Overview, so navigating to "/" would greet
     * them with a denial notice as the first thing they ever see. The server
     * knows the now-active role; only a path comes back.
     */
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ activated: true, landing: "/chat" }),
    });
    await setPassword();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/chat"));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("REFUSES to follow a landing path that is not same-site", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ activated: true, landing: "https://evil.example/steal" }),
    });
    await setPassword();

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("refuses a protocol-relative //host too", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ activated: true, landing: "//evil.example" }),
    });
    await setPassword();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("SAYS SO when the password changed but activation was refused", async () => {
    /*
     * The distinction that matters to the person: their password IS now
     * different. Navigating into the app and bouncing them at the door reads as
     * the new password not having worked.
     */
    fetchSpy.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This account is disabled." }),
    });
    await setPassword();

    await waitFor(() => expect(screen.getByText(/This account is disabled\./)).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("still signs somebody in when the activation call cannot be reached", async () => {
    /*
     * The password change already succeeded. If the profile is still invited
     * the page guard returns them to sign-in, which is recoverable; refusing to
     * navigate would strand them on a form that has nothing left to do.
     */
    fetchSpy.mockRejectedValue(new Error("network"));
    await setPassword();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
  });

  it("does not activate when the password change itself failed", async () => {
    supabase.updateUser.mockResolvedValue({
      data: {},
      error: { message: "Password should be at least 6 characters." },
    });
    await setPassword();

    await waitFor(() =>
      expect(screen.getByText(/Password should be at least 6 characters\./)).toBeTruthy(),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("a link that no longer works", () => {
  it("says so instead of showing a form that cannot succeed", async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    render(<ResetPasswordForm />);

    await waitFor(() =>
      expect(screen.getByText(/reset link is no longer valid/i)).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/^New password$/i)).toBeNull();
  });
});

describe("the source itself", () => {
  const code = readFileSync("src/features/auth/reset-password-form.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("logs nothing", () => {
    expect(code).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it("validates the session with getUser, not getSession", () => {
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).not.toMatch(/auth\.getSession\(\)/);
  });

  it("sends the password only to Supabase", () => {
    // The only place the password variable appears alongside a call is
    // `updateUser`. It is never serialised into a fetch body.
    expect(code).toMatch(/updateUser\(\{\s*password,?\s*\}\)/);
    expect(code).not.toMatch(/body:\s*JSON\.stringify\([^)]*password/);
  });
});
