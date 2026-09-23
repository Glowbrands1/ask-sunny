// @vitest-environment jsdom
import * as React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ResetPasswordForm } from "./reset-password-form";

/**
 * ============================================================================
 * CONSUMING A RECOVERY LINK, AND SETTING THE PASSWORD IT AUTHORISES.
 * ============================================================================
 *
 * THE BUG THESE CASES EXIST FOR. Supabase returns a recovery session either as
 * `?code=` (PKCE, from the browser's own `resetPasswordForEmail`) or as
 * `#access_token=` (implicit, from anything sent server-side). A fragment is
 * never transmitted to a server, so the old route-handler landing saw an empty
 * request, decided the link was spent, and redirected to `/login` — carrying
 * the fragment with it, because browsers re-attach one to a redirect target
 * that has none. The person landed on the sign-in screen holding a live
 * recovery session nothing on that page would ever read.
 *
 * So this screen now reads the link itself, in both shapes.
 *
 * Setting a password is also not by itself enough to use Ask Sunny. An INVITED
 * profile is refused by the auth provider, so somebody who set a password and
 * stopped would hold a working credential the application still turns away.
 * Activation therefore happens here, where we know the password actually took.
 *
 * The password goes to Supabase and nowhere else: no Ask Sunny endpoint ever
 * receives it, and the activation call that follows carries no body at all.
 */

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  setSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("@/lib/supabase/browser-client", () => ({
  getSupabaseBrowserClient: supabase.getClient,
}));

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fetchSpy = vi.fn();

const PASSWORD = "correct-horse-battery";

/** A realistic implicit fragment, in the order Supabase writes it. */
const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.fake-access";
const REFRESH_TOKEN = "fake-refresh-token";
const IMPLICIT_HASH =
  `#access_token=${ACCESS_TOKEN}&expires_in=3600` +
  `&refresh_token=${REFRESH_TOKEN}&token_type=bearer&type=recovery`;

const PKCE_CODE = "one-time-pkce-code-abc123";

/** Puts the browser on `/reset-password` with the given query and fragment. */
function land(search = "", hash = "") {
  window.history.replaceState(null, "", `/reset-password${search}${hash}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  land();

  supabase.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  supabase.updateUser.mockResolvedValue({ data: {}, error: null });
  supabase.setSession.mockResolvedValue({ data: {}, error: null });
  supabase.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  supabase.signOut.mockResolvedValue({ error: null });
  supabase.getClient.mockReturnValue({
    auth: {
      getUser: supabase.getUser,
      updateUser: supabase.updateUser,
      setSession: supabase.setSession,
      exchangeCodeForSession: supabase.exchangeCodeForSession,
      signOut: supabase.signOut,
    },
  } as never);

  fetchSpy.mockResolvedValue({
    ok: true,
    json: async () => ({ activated: true, landing: "/" }),
  });
  globalThis.fetch = fetchSpy as never;
});

afterEach(cleanup);

/** Renders and waits for the link check to settle into the form. */
async function openForm() {
  render(<ResetPasswordForm />);
  await waitFor(() => expect(screen.getByLabelText(/^New password$/i)).toBeTruthy());
}

/** Fills both fields and submits, once the form is on screen. */
async function setPassword(value = PASSWORD, confirm = value) {
  await openForm();

  fireEvent.change(screen.getByLabelText(/^New password$/i), { target: { value } });
  fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: /Set password and continue/i }));
}

/* ------------------------------------------------------- reading the link */

describe("an IMPLICIT recovery link — the shape that used to be lost", () => {
  it("reads the fragment and opens the session with it", async () => {
    land("", IMPLICIT_HASH);
    await openForm();

    expect(supabase.setSession).toHaveBeenCalledWith({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    });
  });

  it("carries through to updateUser({ password }) — the server-sent Forgot Password path", async () => {
    /*
     * `/api/auth/forgot-password` asks Supabase with an implicit-flow client,
     * so this is exactly the link a person gets from the public Forgot
     * Password form: fragment → setSession → form → updateUser.
     */
    land("", IMPLICIT_HASH);
    await setPassword();

    await waitFor(() => expect(supabase.updateUser).toHaveBeenCalledWith({ password: PASSWORD }));
    expect(supabase.setSession).toHaveBeenCalledTimes(1);
    expect(supabase.setSession.mock.invocationCallOrder[0]).toBeLessThan(
      supabase.updateUser.mock.invocationCallOrder[0],
    );
  });

  it("shows the password form rather than sending anybody to sign in", async () => {
    land("", IMPLICIT_HASH);
    await openForm();

    expect(screen.getByLabelText(/^Confirm new password$/i)).toBeTruthy();
    expect(screen.queryByText(/no longer valid/i)).toBeNull();
    // The whole failure was a navigation to the login screen. There is none.
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("SCRUBS the token out of the URL and out of the back button", async () => {
    /*
     * `history.replaceState` rewrites the entry the browser is sitting on, so
     * the token leaves the address bar without adding a history entry that
     * still holds it. Assigning `location.hash` — which the library's own
     * cleanup does — would leave the previous entry in the back stack.
     */
    land("", IMPLICIT_HASH);
    await openForm();

    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(ACCESS_TOKEN);
    expect(window.location.href).not.toContain(REFRESH_TOKEN);
  });

  it("treats a rejected token as a dead link, without the provider's words", async () => {
    supabase.setSession.mockResolvedValue({
      data: {},
      error: { message: "Token has expired or is invalid" },
    });
    land("", IMPLICIT_HASH);
    render(<ResetPasswordForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(screen.queryByText(/Token has expired/)).toBeNull();
  });
});

describe("a PKCE recovery link", () => {
  it("exchanges the code for a session", async () => {
    land(`?code=${PKCE_CODE}`);
    await openForm();

    expect(supabase.exchangeCodeForSession).toHaveBeenCalledWith(PKCE_CODE);
  });

  it("scrubs the code out of the URL", async () => {
    land(`?code=${PKCE_CODE}`);
    await openForm();

    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain(PKCE_CODE);
  });

  it("falls back to the session when the library already consumed the code", async () => {
    /*
     * `detectSessionInUrl` is on by default in the browser and fires while the
     * client is constructed, so the client may well have spent this code
     * already — in which case the exchange fails over a session that is fine.
     * Refusing on that error would reject a working link.
     */
    supabase.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "code verifier should be non-empty" },
    });
    land(`?code=${PKCE_CODE}`);
    await openForm();

    expect(supabase.getUser).toHaveBeenCalled();
    expect(screen.getByLabelText(/^New password$/i)).toBeTruthy();
  });

  it("reports a dead link when the exchange fails and no session exists", async () => {
    supabase.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "invalid request: both auth code and code verifier should be non-empty" },
    });
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    land(`?code=${PKCE_CODE}`);
    render(<ResetPasswordForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(screen.queryByText(/code verifier/)).toBeNull();
  });
});

describe("a session established before this screen was reached", () => {
  it("shows the form when /auth/recovery or /auth/accept already signed them in", async () => {
    land();
    await openForm();

    expect(supabase.getUser).toHaveBeenCalled();
    expect(supabase.setSession).not.toHaveBeenCalled();
    expect(supabase.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------- invalid / expired links */

describe("an invalid or expired recovery link", () => {
  it("says so instead of showing a form that cannot succeed", async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    render(<ResetPasswordForm />);

    await waitFor(() =>
      expect(screen.getByText(/reset link is no longer valid/i)).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/^New password$/i)).toBeNull();
  });

  it("offers a way to request another reset email", async () => {
    supabase.getUser.mockResolvedValue({ data: { user: null }, error: { message: "x" } });
    render(<ResetPasswordForm />);

    const again = await screen.findByRole("link", { name: /Request a new link/i });
    expect(again.getAttribute("href")).toBe("/forgot-password");
  });

  it("recognises the provider's own `#error=` fragment without asking anything", async () => {
    land("", "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    render(<ResetPasswordForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    // Nothing was worth asking Supabase about, and the provider's text is not shown.
    expect(supabase.setSession).not.toHaveBeenCalled();
    expect(supabase.getUser).not.toHaveBeenCalled();
    expect(screen.queryByText(/Email link is invalid/)).toBeNull();
  });

  it("scrubs a failed link's parameters off the screen too", async () => {
    land("", "#error=access_denied&error_code=otp_expired");
    render(<ResetPasswordForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(window.location.hash).toBe("");
  });

  it("believes the legacy route when it says the exchange already failed", async () => {
    /*
     * `/auth/recovery` sets `?link=expired` for a code it read and Supabase
     * refused. There is no fragment in that case and no session to find, so
     * asking the auth server would only add a round trip to a known answer.
     */
    land("?link=expired");
    render(<ResetPasswordForm />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(supabase.getUser).not.toHaveBeenCalled();
  });

  it("names the missing variables when the deployment has no Supabase config", async () => {
    supabase.getClient.mockImplementation(() => {
      throw new Error("Sign-in is not configured. Missing: NEXT_PUBLIC_SUPABASE_URL.");
    });
    render(<ResetPasswordForm />);

    await waitFor(() =>
      expect(screen.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeTruthy(),
    );
    // A configuration failure is a different sentence from a dead link.
    expect(screen.getByText(/could not be opened/i)).toBeTruthy();
  });
});

/* ----------------------------------------------------------- the password */

describe("the password itself", () => {
  it("goes to Supabase and to no Ask Sunny endpoint", async () => {
    await setPassword();
    await waitFor(() => expect(supabase.updateUser).toHaveBeenCalledWith({ password: PASSWORD }));

    // Every fetch this component makes, checked for the value.
    for (const [, init] of fetchSpy.mock.calls) {
      expect(JSON.stringify(init ?? {})).not.toContain(PASSWORD);
    }
  });

  it("never reaches the URL, the history or the DOM", async () => {
    await setPassword();
    await waitFor(() => expect(supabase.updateUser).toHaveBeenCalled());

    expect(window.location.href).not.toContain(PASSWORD);
    expect(document.body.innerHTML).not.toContain(PASSWORD);
  });

  it("refuses a password that is too short, without calling anything", async () => {
    /*
     * Scoped to the ERROR notice. The form also carries a standing checklist
     * saying "At least 12 characters", so a bare text match finds two elements
     * and would pass even if the refusal never appeared.
     */
    await setPassword("short", "short");
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

  it("surfaces a rule Supabase enforced that this form could not", async () => {
    /*
     * No enumeration risk — the session already proves who this is — and the
     * message is the only way somebody learns their password was rejected for
     * being previously leaked or too weak.
     */
    supabase.updateUser.mockResolvedValue({
      data: {},
      error: { message: "This password has appeared in a data breach." },
    });
    await setPassword();

    await waitFor(() =>
      expect(screen.getByText(/appeared in a data breach/i)).toBeTruthy(),
    );
    expect(screen.getByLabelText(/^New password$/i)).toBeTruthy();
  });
});

describe("what the form shows while you use it", () => {
  it("reveals and re-hides each field independently", async () => {
    await openForm();

    const newPassword = screen.getByLabelText(/^New password$/i);
    const confirm = screen.getByLabelText(/^Confirm new password$/i);
    const toggle = screen.getByRole("button", { name: /Show new password/i });

    expect(newPassword.getAttribute("type")).toBe("password");

    fireEvent.click(toggle);
    expect(newPassword.getAttribute("type")).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    // The other field is untouched — revealing one must not reveal both.
    expect(confirm.getAttribute("type")).toBe("password");

    fireEvent.click(toggle);
    expect(newPassword.getAttribute("type")).toBe("password");
  });

  it("does not submit the form when the reveal toggle is clicked", async () => {
    /*
     * A button with no explicit `type` inside a form submits it, which here
     * would mean revealing the password and attempting the change in one click.
     */
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: /Show new password/i }));

    expect(supabase.updateUser).not.toHaveBeenCalled();
  });

  it("marks each rule as it is met", async () => {
    await openForm();
    const rules = screen.getByRole("list");

    expect(rules.textContent).toContain("not yet met");

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: PASSWORD },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: PASSWORD },
    });

    await waitFor(() => expect(rules.textContent).not.toContain("not yet met"));
  });

  it("shows a loading state while the change is in flight", async () => {
    let release: (value: { data: unknown; error: unknown }) => void = () => {};
    supabase.updateUser.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    await setPassword();

    const saving = await screen.findByRole("button", { name: /Saving…/i });
    expect(saving.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText(/^New password$/i).hasAttribute("disabled")).toBe(true);

    release({ data: {}, error: null });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("confirms success before navigating away", async () => {
    await setPassword();

    await waitFor(() => expect(screen.getByText(/Password updated/i)).toBeTruthy());
    expect(screen.queryByLabelText(/^New password$/i)).toBeNull();
  });
});

/* --------------------------------------------- finishing the session state */

describe("finishing the auth state", () => {
  it("ends every OTHER session, and keeps this one", async () => {
    /*
     * A password change is the moment an account is most likely to be
     * recovering from somebody else holding a credential, and Supabase leaves
     * other refresh tokens alive by default. `scope: "others"` revokes them
     * without throwing out the person standing on this screen.
     */
    await setPassword();

    await waitFor(() =>
      expect(supabase.signOut).toHaveBeenCalledWith({ scope: "others" }),
    );
    expect(supabase.signOut).not.toHaveBeenCalledWith();
  });

  it("does not revoke anything when the password change failed", async () => {
    supabase.updateUser.mockResolvedValue({
      data: {},
      error: { message: "Password should be at least 6 characters." },
    });
    await setPassword();

    await waitFor(() =>
      expect(screen.getByText(/at least 6 characters/i)).toBeTruthy(),
    );
    expect(supabase.signOut).not.toHaveBeenCalled();
  });

  it("still finishes when revoking other sessions fails", async () => {
    // The password has already changed; nothing here is worth stranding
    // somebody over.
    supabase.signOut.mockRejectedValue(new Error("network"));
    await setPassword();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
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

/* -------------------------------------------------------- the source itself */

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

  it("never writes a credential to storage of its own", () => {
    // Supabase's client owns the session. Anything here would be a second,
    // unmanaged copy of it.
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it("scrubs the URL with replaceState, never by assigning the hash", () => {
    // Assigning `location.hash` is a same-document navigation: it adds an entry
    // and leaves the token-bearing one in the back stack.
    expect(code).toMatch(/history\.replaceState/);
    expect(code).not.toMatch(/location\.hash\s*=/);
  });
});
