// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  DEFAULT_PERMISSION_MATRIX,
  hasPermission,
} from "@/lib/permissions";
import { defaultLandingForRole } from "@/lib/auth/page";
import type { Role } from "@/types";

import { SignInForm } from "./sign-in-form";

/**
 * ============================================================================
 * SIGNING IN HAS TO ACTUALLY LET YOU IN.
 * ============================================================================
 *
 * The bug: authentication succeeded, the cookie was written, and the person sat
 * on "Signing in…" until they refreshed the browser by hand. Three things
 * combined, and all three are pinned below:
 *
 *   The login screen is rendered INLINE by `AppShell` when signed out, so
 *   somebody signing in at `/` is already on `/`. `router.replace("/")` from
 *   `/` is a no-op — there is no navigation to perform.
 *
 *   That left `router.refresh()` as the only thing that could swap the tree,
 *   issued synchronously alongside the `replace` it raced with.
 *
 *   Nothing set `busy` back to false on success, so when neither took effect
 *   there was no recovery and no message.
 *
 * The fix is a real document navigation, which is what the manual refresh was
 * doing: the browser sends the cookie the Supabase client already wrote, so the
 * server resolves the identity on the first render.
 */

const supabase = vi.hoisted(() => ({
  signInWithPassword: vi.fn(async () => ({ data: {}, error: null as unknown })),
  getClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  getSupabaseBrowserClient: supabase.getClient,
}));

/**
 * The router is mocked so a leftover call would be VISIBLE rather than merely
 * ineffective — the point is that the fix no longer relies on it.
 */
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(""),
}));

/** Stands in for `window.location.replace`, which jsdom will not perform. */
const locationReplace = vi.fn();

const EMAIL = "paulyne.camacho@glowbrands.test";
const PASSWORD = "a-correct-horse-battery";

beforeEach(() => {
  vi.clearAllMocks();
  supabase.signInWithPassword.mockResolvedValue({ data: {}, error: null });
  supabase.getClient.mockReturnValue({
    auth: { signInWithPassword: supabase.signInWithPassword },
  } as never);

  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "https://ask-sunny.preview.test",
      href: "https://ask-sunny.preview.test/",
      pathname: "/",
      replace: locationReplace,
      assign: vi.fn(),
    },
  });
});

afterEach(cleanup);

async function signIn(props: { redirectTo?: string } = {}) {
  render(<SignInForm {...props} />);
  fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: EMAIL } });
  fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));
}

describe("a successful sign-in enters the application", () => {
  it("performs a REAL DOCUMENT NAVIGATION, not a client transition", async () => {
    /*
     * The load-bearing assertion. A full document request is what carries the
     * session cookie to the server on the first render — the same thing the
     * manual refresh was doing by hand.
     */
    await signIn();

    await waitFor(() => expect(locationReplace).toHaveBeenCalledTimes(1));
    expect(locationReplace).toHaveBeenCalledWith("https://ask-sunny.preview.test/");
  });

  it("no longer relies on the router for the post-login transition", async () => {
    /*
     * `router.replace("/")` from `/` is a no-op, and `router.refresh()` raced
     * with it. Neither is called any more, so neither can race.
     */
    await signIn();

    await waitFor(() => expect(locationReplace).toHaveBeenCalled());
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("replaces rather than pushes, so Back does not return to the login form", async () => {
    await signIn();
    await waitFor(() => expect(locationReplace).toHaveBeenCalled());
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("does not leave the form waiting on a transition that never comes", async () => {
    /*
     * THE OBSERVED SYMPTOM. The button stayed "Signing in…" forever because
     * nothing cleared `busy` and nothing navigated. Navigation is now
     * unconditional on the success path, so the stuck state has no way to
     * occur — asserted as "we got here having navigated exactly once".
     */
    await signIn();

    await waitFor(() => expect(locationReplace).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Could not sign in/i)).toBeNull();
  });

  it("clears the password only AFTER authentication succeeds", async () => {
    await signIn();
    await waitFor(() => expect(locationReplace).toHaveBeenCalled());

    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
    });
    expect((screen.getByLabelText(/^Password$/i) as HTMLInputElement).value).toBe("");
  });
});

describe("failed credentials stay on the form", () => {
  it("shows the generic message and does NOT navigate", async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    await signIn();

    await waitFor(() => expect(screen.getByText(/Could not sign in/i)).toBeTruthy());
    expect(locationReplace).not.toHaveBeenCalled();
    // The provider's wording is not surfaced — it distinguishes "no such user"
    // from "wrong password", which would make this an enumeration oracle.
    expect(document.body.textContent).not.toContain("Invalid login credentials");
  });

  it("KEEPS the password so a typo can be corrected, and re-enables the button", async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    await signIn();

    await waitFor(() => expect(screen.getByText(/Could not sign in/i)).toBeTruthy());
    expect((screen.getByLabelText(/^Password$/i) as HTMLInputElement).value).toBe(PASSWORD);
    expect(screen.getByRole("button", { name: /^Sign in$/i }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("reports a configuration failure by variable name, without navigating", async () => {
    supabase.getClient.mockImplementation(() => {
      throw new Error("Sign-in is not configured. Missing: NEXT_PUBLIC_SUPABASE_URL.");
    });
    await signIn();

    await waitFor(() => expect(screen.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeTruthy());
    expect(locationReplace).not.toHaveBeenCalled();
  });
});

describe("the destination cannot be pointed off-origin", () => {
  const ORIGIN = "https://ask-sunny.preview.test";

  /**
   * THE ESCAPES A PREFIX TEST DOES NOT CATCH.
   *
   * The first version of this validation tested the input string —
   * `startsWith("/")` and `!startsWith("//")` — and then resolved it.
   * `/\evil.example` passes both: it begins with ONE slash, and the second
   * character is a backslash rather than a slash. The WHATWG parser then treats
   * backslashes as slashes for special HTTP(S) schemes, so it resolved to
   * `https://evil.example/`.
   *
   * Found in QA, reproduced against the real parser, and listed here by name so
   * the specific bypasses stay covered. The assertion that actually protects
   * this, though, is the property test at the end: it reads the ORIGIN OF THE
   * PARSED RESULT, which is the only thing the browser cares about.
   */
  const ESCAPES: [string, string][] = [
    ["/\\evil.example", "a backslash host"],
    ["/\\\\evil.example", "a double backslash host"],
    ["/\\/evil.example", "a backslash then a slash"],
    ["/\\\\@evil.example", "a backslash host with userinfo"],
    ["/\\\\user:pass@evil.example", "a backslash host with credentials"],
    ["//evil.example/steal", "a protocol-relative host"],
    ["https://evil.example/steal", "an absolute URL"],
    ["javascript:alert(1)", "a script scheme"],
    ["data:text/html,x", "a data URL"],
    ["", "an empty string"],
    ["chat", "a bare relative path"],
  ];

  it.each(ESCAPES)("discards %s (%s) for the app root", async (target) => {
    await signIn({ redirectTo: target });

    await waitFor(() => expect(locationReplace).toHaveBeenCalled());
    expect(locationReplace).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  const ALLOWED: string[] = [
    "/",
    "/chat",
    "/chat?x=1",
    "/#section",
    "/forms/monitoring?view=all#top",
  ];

  it.each(ALLOWED)("honours the ordinary internal path %s", async (target) => {
    await signIn({ redirectTo: target });

    await waitFor(() => expect(locationReplace).toHaveBeenCalled());
    expect(locationReplace).toHaveBeenCalledWith(new URL(target, ORIGIN).toString());
  });

  it("PARSES every destination it emits and finds our origin", async () => {
    /*
     * The load-bearing assertion, and the one the previous version got wrong in
     * substance while looking right in shape: it did parse the result, but its
     * case list never included a backslash, so the bypass sailed through a test
     * that was checking the correct thing about the wrong inputs.
     *
     * Both lists are swept together here, so a future input that escapes fails
     * whichever list it was filed under.
     */
    for (const target of [...ESCAPES.map(([value]) => value), ...ALLOWED]) {
      cleanup();
      locationReplace.mockClear();
      await signIn({ redirectTo: target });
      await waitFor(() => expect(locationReplace).toHaveBeenCalled());

      const emitted = new URL(locationReplace.mock.calls[0]![0] as string);
      expect(emitted.origin, `${target} escaped to ${emitted.origin}`).toBe(ORIGIN);
      // A destination this form emits never carries credentials.
      expect(emitted.username, target).toBe("");
      expect(emitted.password, target).toBe("");
    }
  });

  it("decides on the parsed result, not on how the string is spelled", () => {
    /*
     * Asserted against the source too, because this is the distinction the bug
     * turned on: any enumeration of dangerous prefixes is a guess at a
     * normalisation table the parser is free to change.
     */
    const code = readFileSync("src/features/auth/sign-in-form.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).toMatch(/resolved\.origin !== origin/);
    expect(code).not.toMatch(/startsWith\("\/\/"\)/);
  });
});

describe("where each role ends up, decided on the server", () => {
  /*
   * This form navigates to `/` and reads no role — it could not, because the
   * role lives in `app_users` and is resolved server-side. The page guard on
   * `/` is what sends somebody who cannot open the Overview onward.
   */
  it("sends everyone to the root, and reads no role to do it", () => {
    /*
     * Comments stripped: the file EXPLAINS that the role lives in `app_users`
     * and is resolved server-side, and that explanation is the one place the
     * name is supposed to appear.
     */
    const code = readFileSync("src/features/auth/sign-in-form.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).not.toMatch(/\brole\b/);
    expect(code).not.toMatch(/app_users|user_metadata|PERMISSION_MATRIX|hasPermission/);
  });

  it("lands an Admin on the Overview", () => {
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "admin", "view_overview")).toBe(true);
    expect(defaultLandingForRole("admin")).toBe("/");
  });

  it("lands an Employee on Ask Sunny, NOT the Overview", () => {
    // The guard on `/` bounces them, because they cannot hold `view_overview`.
    expect(hasPermission(DEFAULT_PERMISSION_MATRIX, "employee", "view_overview")).toBe(false);
    expect(defaultLandingForRole("employee")).toBe("/chat");
  });

  it("never lands any role on a screen it cannot open", () => {
    const required: Record<string, "view_overview" | "ask_questions"> = {
      "/": "view_overview",
      "/chat": "ask_questions",
    };
    for (const role of Object.keys(DEFAULT_PERMISSION_MATRIX) as Role[]) {
      const landing = defaultLandingForRole(role);
      const permission = required[landing];
      if (permission) {
        expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission), role).toBe(true);
      } else {
        expect(landing, role).toBe("/login");
      }
    }
  });
});
