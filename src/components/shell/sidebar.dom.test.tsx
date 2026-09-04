// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import type { Permission, Role } from "@/types";

import { SidebarNav } from "./sidebar";

/**
 * A SCREEN WITH NO WAY IN IS A BROKEN SCREEN.
 *
 * Form Templates is reachable at /forms/templates and the page-level block was
 * removed, because the permission matrix behind it is this app's own guess and
 * nobody has configured roles yet. The RAIL was still filtering on that same
 * guess — so for a Salon Director the link simply was not there, and the screen
 * existed with no route to it from inside the app. The report was literally
 * "I don't see it on the app".
 *
 * These tests pin both halves of the decision:
 *   in preview, the rail does not hide a screen on an unconfigured permission;
 *   the Admin section is STILL gated, because Owner/Developer there is a fixed
 *   decision rather than a guess.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/forms/create",
}));

// The rail also renders the profile menu, which reaches into the app store.
// That is not what is under test here, and mounting the whole store to check
// which links exist would make the test about the store instead.
vi.mock("./user-menu", () => ({
  UserMenu: () => null,
}));

/** The session values the rail actually reads. */
function session(role: Role, demoMode: boolean) {
  return {
    can: (permission: Permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission),
    isAdmin: role === "owner" || role === "developer",
    demoMode,
  };
}

const mocked = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => mocked.value,
}));

beforeAll(() => {
  // Radix Tooltip measures, and jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(cleanup);

function renderAs(role: Role, demoMode = true) {
  mocked.value = session(role, demoMode);
  return render(<SidebarNav />);
}

describe("what a Salon Director can reach from the rail", () => {
  it("shows Form Templates, even though the default matrix withholds it", () => {
    // The premise, asserted so this test cannot pass for the wrong reason: the
    // matrix really does NOT give a Salon Director this permission.
    expect(
      hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director", "manage_form_templates"),
    ).toBe(false);

    renderAs("salon_director");
    expect(screen.getByRole("link", { name: /Form Templates/ })).toBeTruthy();
  });

  it("shows the whole Forms section, not a subset of it", () => {
    renderAs("salon_director");
    for (const label of ["Create a Form", "Form Monitoring", "Form Templates"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) }), label).toBeTruthy();
    }
  });

  it("still keeps the admin console out of the rail", () => {
    // Not a guess: Owner/Developer for the admin console is a fixed decision,
    // so standing down the permission filter must not open it.
    renderAs("salon_director");
    expect(screen.queryByRole("link", { name: /User Management/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /AI Usage/ })).toBeNull();
  });
});

describe("what an owner sees", () => {
  it("gets the admin console as well", () => {
    renderAs("owner");
    expect(screen.getByRole("link", { name: /Form Templates/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /User Management/ })).toBeTruthy();
  });
});

describe("once identity is real", () => {
  it("goes back to filtering the rail on the role's permissions", () => {
    // Live mode is the case where the role has actually been verified, so
    // hiding what it cannot use is meaningful again.
    renderAs("salon_director", false);
    expect(screen.queryByRole("link", { name: /Form Templates/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Create a Form/ })).toBeTruthy();
  });
});
