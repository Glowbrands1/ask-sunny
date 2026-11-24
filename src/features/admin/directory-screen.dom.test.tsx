// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { AccessScope, Permission, Role } from "@/types";

import { TooltipProvider } from "@/components/ui/overlays";

import { DirectoryScreen, type DirectoryUser } from "./directory-screen";
import { PermissionsMatrix } from "./permissions-matrix";

/**
 * ============================================================================
 * THE ADMINISTRATION SCREENS.
 * ============================================================================
 *
 * Nothing rendered here is a security boundary — every control is enforced
 * again on the server. What these tests protect is a different failure: an
 * administrator being OFFERED an action that will be refused, or being SHOWN a
 * picture of access that is not the one in force. On the one screen whose
 * entire job is to describe who can do what, both are serious.
 */

const scope: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

function user(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: "admin-1",
    email: "admin@suntancity.test",
    displayName: "The Admin",
    role: "admin",
    status: "active",
    scope,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const sessionMock = vi.hoisted(() => ({ authenticated: true }));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { id: "me-1", name: "Me", email: "me@suntancity.test", avatarInitials: "ME" },
    role: "admin" as Role,
    authenticated: sessionMock.authenticated,
    demoMode: !sessionMock.authenticated,
    can: (permission: Permission) =>
      hasPermission(DEFAULT_PERMISSION_MATRIX, "admin", permission),
    isAdmin: true,
  }),
}));

vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => ({
    permissionMatrix: DEFAULT_PERMISSION_MATRIX,
    setPermissionMatrix: () => {},
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(cleanup);

/**
 * The matrix's locked cells carry explanatory tooltips, and Radix requires a
 * provider above them. Rendering it here rather than mocking Tooltip away keeps
 * the locked cells rendering the way they actually do — which is what the
 * "Admin holds manage_users" assertion below is reading.
 */
function renderMatrix() {
  return render(
    <TooltipProvider>
      <PermissionsMatrix />
    </TooltipProvider>,
  );
}

describe("the directory never offers a password", () => {
  it("has no password field, and says why", () => {
    /*
     * Rendered rather than asserted against source, because the promise made to
     * the person reading this screen is the one on screen: nobody here can read
     * or set a password. If that sentence disappears while the guarantee holds,
     * an administrator will keep looking for the button.
     */
    render(<DirectoryScreen initialUsers={[user()]} />);

    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/Ask Sunny never handles passwords/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /set password|copy link|show link/i })).toBeNull();
  });

  it("offers a sign-in link rather than a password, worded the same for both", () => {
    /*
     * ONE LABEL, and it used to be two. "Resend invite" was shown for an
     * invited profile — a prediction the server no longer makes: whether an
     * invitation or a reset goes out is decided from the CREDENTIAL's
     * confirmation state, not the profile's status, so an invited-but-confirmed
     * account correctly receives a reset. A button that names the wrong email
     * is worse than one that names neither; the notice after the click says
     * which was actually sent.
     */
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "a", email: "a@x.test", status: "invited", displayName: "Invited Person" }),
          user({ id: "b", email: "b@x.test", status: "active", displayName: "Active Person" }),
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Send sign-in link/i })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Resend invite/i })).toBeNull();
  });
});

describe("the last administrator cannot be demoted from this screen", () => {
  it("disables the controls and says why when only one active admin is left", () => {
    /*
     * The refusal itself lives in the API and in a database trigger, counted
     * against the whole table. This is only about not OFFERING the action —
     * a button that always errors is worse than no button.
     */
    render(<DirectoryScreen initialUsers={[user({ id: "only-admin" })]} />);

    expect(screen.getByText(/Last administrator/i)).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: /Role for The Admin/i }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: /^Disable$/ }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("enables them once a second administrator exists", () => {
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "admin-1", displayName: "First Admin" }),
          user({ id: "admin-2", email: "two@x.test", displayName: "Second Admin", role: "owner" }),
        ]}
      />,
    );

    expect(screen.queryByText(/Last administrator/i)).toBeNull();
    expect(
      screen.getByRole("combobox", { name: /Role for First Admin/i }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("never lets somebody change their OWN role or status", () => {
    // Enforced server-side and by a trigger; not offered here either.
    render(
      <DirectoryScreen
        initialUsers={[
          user({ id: "me-1", displayName: "Me", email: "me@suntancity.test" }),
          user({ id: "admin-2", email: "two@x.test", displayName: "Second Admin", role: "owner" }),
        ]}
      />,
    );

    expect(screen.getByRole("combobox", { name: /Role for Me/i }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByText("You")).toBeTruthy();
  });
});

describe("the permissions matrix under real authentication", () => {
  it("is editable once the server's matrix has loaded, and the locked cells stay locked", async () => {
    /*
     * CHANGED ON PURPOSE (Pau, 23 Nov 2026). This test used to assert the
     * opposite — every checkbox disabled, no Save, "fixed in this release" —
     * because a saved matrix nobody enforced would have been worse than none.
     * The matrix is saved to the database and enforced on the server now
     * (`/api/admin/permissions`), so under real authentication an administrator
     * can tick and save. What must STILL hold is the locked cells; the tick /
     * save / refresh behaviour is in `permissions-matrix.dom.test.tsx`.
     */
    sessionMock.authenticated = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ overrides: {} }), { status: 200 })),
    );
    const { container } = renderMatrix();
    await screen.findByText(/No unsaved changes/i);

    const boxes = [...container.querySelectorAll('[role="checkbox"]')];
    expect(boxes.length).toBeGreaterThan(20);
    const enabled = boxes.filter((box) => !box.hasAttribute("disabled"));
    expect(enabled.length).toBeGreaterThan(20);
    for (const label of [
      "Manage users for Salon Director",
      "Manage integrations for District Manager",
      "Open the L10 meeting link for Regional Manager",
      "Ask Sunny questions for Admin",
    ]) {
      const box = container.querySelector(`[aria-label="${label}"]`);
      expect(box?.hasAttribute("disabled"), label).toBe(true);
    }

    expect(screen.getByRole("button", { name: /Save changes/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reset to defaults/i })).toBeTruthy();
    expect(screen.queryByText(/fixed in this release/i)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("stays editable in demo mode, where changing it is the point", () => {
    sessionMock.authenticated = false;
    renderMatrix();

    expect(screen.getByRole("button", { name: /Save changes/i })).toBeTruthy();
    expect(screen.queryByText(/fixed in this release/i)).toBeNull();
    sessionMock.authenticated = true;
  });

  it("shows the client Admin holding manage_users, not locked off", async () => {
    /*
     * THE BUG THIS PINS. `isPermissionLockedFor` tested `owner || developer`
     * and was left behind when `admin` was added, so the matrix rendered the
     * client administrator's `manage_users` cell as locked OFF — on the one
     * screen whose job is to describe access accurately. Their actual access
     * was never affected; only the picture of it was.
     */
    sessionMock.authenticated = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ overrides: {} }), { status: 200 })),
    );
    const { container } = renderMatrix();
    await screen.findByText(/No unsaved changes/i);

    const cell = container.querySelector('[aria-label="Manage users for Admin"]');
    expect(cell, "no Manage users / Admin cell").toBeTruthy();
    expect(
      cell!.getAttribute("data-state") === "checked" ||
        cell!.getAttribute("aria-checked") === "true" ||
        (cell as HTMLInputElement).checked === true,
    ).toBe(true);
    vi.unstubAllGlobals();
  });
});
