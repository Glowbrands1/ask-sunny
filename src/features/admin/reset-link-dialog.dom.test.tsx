// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, Permission, Role } from "@/types";

import { DirectoryScreen, ResetLinkDialog, type DirectoryUser } from "./directory-screen";

/**
 * The generated reset link is shown ONCE, to the administrator who asked, as
 * text to copy — never as a link that could be opened (and spent) here.
 */

const scope: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

function user(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: "emp-1",
    email: "sam@suntancity.test",
    displayName: "Sam",
    role: "employee",
    status: "active",
    scope,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { id: "me-1", name: "Me", email: "me@suntancity.test", avatarInitials: "ME" },
    role: "admin" as Role,
    authenticated: true,
    demoMode: false,
    can: (permission: Permission) =>
      hasPermission(DEFAULT_PERMISSION_MATRIX, "admin", permission),
    isAdmin: true,
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const URL_VALUE =
  "https://ask-sunny.vercel.app/auth/recovery-start?token_hash=abcdef0123456789abcdef&type=recovery";

describe("where the action is offered", () => {
  it("only on active, non-administrator accounts", () => {
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "a", displayName: "Active Employee" }),
          user({ id: "b", displayName: "Disabled Employee", status: "disabled" }),
          user({ id: "c", displayName: "Invited Employee", status: "invited" }),
          user({ id: "d", displayName: "An Admin", role: "admin" }),
          user({ id: "e", displayName: "Another Admin", role: "admin" }),
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Generate reset link/i })).toHaveLength(1);
  });
});

describe("generating a link", () => {
  it("POSTs with no body to the per-user route, then shows the link in a dialog", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: URL_VALUE, email: "sam@suntancity.test" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DirectoryScreen initialUsers={[user()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Generate reset link/i }));

    const field = (await screen.findByLabelText("Reset link")) as HTMLInputElement;
    expect(field.value).toBe(URL_VALUE);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/admin/users/emp-1/reset-link");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("shows the server's refusal and no dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "This account is disabled." }), { status: 409 }),
      ),
    );

    render(<DirectoryScreen initialUsers={[user()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Generate reset link/i }));

    expect(await screen.findByText("This account is disabled.")).toBeTruthy();
    expect(screen.queryByLabelText("Reset link")).toBeNull();
  });
});

describe("the dialog", () => {
  it("says it is a one-time credential, and that no email was sent", () => {
    render(<ResetLinkDialog link={{ email: "sam@suntancity.test", url: URL_VALUE }} onClose={() => {}} />);

    expect(screen.getByText(/one-time credential/i)).toBeTruthy();
    expect(screen.getByText(/No email has been sent/i)).toBeTruthy();
    expect(screen.getByText(/Do not open it yourself/i)).toBeTruthy();
  });

  it("shows the link as read-only text, never as a link that could be opened", () => {
    render(<ResetLinkDialog link={{ email: "sam@suntancity.test", url: URL_VALUE }} onClose={() => {}} />);

    const field = screen.getByLabelText("Reset link") as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    expect(document.querySelector(`a[href*="recovery-start"]`)).toBeNull();
    expect(document.querySelector("iframe, img[src*='recovery-start']")).toBeNull();
  });

  it("copies the link to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<ResetLinkDialog link={{ email: "sam@suntancity.test", url: URL_VALUE }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy reset link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_VALUE));
    expect(await screen.findByText(/Copied/i)).toBeTruthy();
  });

  it("drops the link when closed", () => {
    const onClose = vi.fn();
    render(<ResetLinkDialog link={{ email: "sam@suntancity.test", url: URL_VALUE }} onClose={onClose} />);

    fireEvent.click(screen.getAllByRole("button", { name: /^Close$/ })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing without a link", () => {
    render(<ResetLinkDialog link={null} onClose={() => {}} />);
    expect(screen.queryByLabelText("Reset link")).toBeNull();
  });
});
