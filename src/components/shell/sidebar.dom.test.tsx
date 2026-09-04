// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  DEFAULT_PERMISSION_MATRIX,
  canAccessAdminConsole,
  hasPermission,
} from "@/lib/permissions";
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
    isAdmin: canAccessAdminConsole(role),
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

describe("what an Employee sees on the rail with real authentication", () => {
  /*
   * THE ACCEPTANCE CRITERION FOR THE FRONTLINE ROLE, rendered rather than
   * computed: Ask Sunny, Knowledge Base, Videos. Nothing else, and no empty
   * section heading left behind where something was filtered out.
   *
   * `demoMode = false` throughout, because the whole point of this role is what
   * it looks like once identity is real.
   */
  /**
   * The links inside the NAVIGATION, not every link on screen.
   *
   * The rail's header also carries a brand link whose accessible name is
   * "Ask Sunny — Overview" — so a query across the whole tree matches
   * /Overview/ for every role and reports the wordmark as a navigation item.
   * Scoping to the nav is what makes "an Employee cannot see Overview" mean
   * the sidebar entry rather than the logo.
   */
  function navLinks(container: HTMLElement): string[] {
    const nav = container.querySelector("nav")!;
    return [...nav.querySelectorAll("a")].map((link) => {
      /*
       * Decorative nodes are excluded, not just the icons: an admin entry
       * renders an `aria-hidden` "Admin" pill INSIDE the link, so raw
       * textContent reads "User ManagementAdmin" and an exact-label assertion
       * fails on the one section this test most needs to check. Dropping
       * aria-hidden content gives the accessible name, which is the label a
       * person actually reads.
       */
      const clone = link.cloneNode(true) as HTMLElement;
      for (const hidden of clone.querySelectorAll("[aria-hidden]")) hidden.remove();
      return clone.textContent?.trim() ?? "";
    });
  }

  it("shows exactly the three screens it is entitled to", () => {
    const { container } = renderAs("employee", false);
    expect(navLinks(container).sort()).toEqual(
      ["Ask Sunny", "Knowledge Base", "Videos"].sort(),
    );
  });

  it("shows nothing it cannot open", () => {
    const { container } = renderAs("employee", false);
    const links = navLinks(container);

    for (const label of [
      "Overview",
      "Reports & Analytics",
      "Google Reviews",
      "Create a Form",
      "Form Monitoring",
      "Form Templates",
      "Manager Resources",
      "AI Usage",
      "User Management",
      "Integrations",
    ]) {
      expect(links, label).not.toContain(label);
    }
  });

  it("leaves NO empty section headings behind", () => {
    /*
     * The failure this catches is cosmetic and reads as a bug: "Insights" with
     * nothing under it looks like content that failed to load, and an "Admin"
     * heading advertises a console the person cannot reach. Only the two
     * sections with surviving items may appear.
     */
    const { container } = renderAs("employee", false);
    const headings = [...container.querySelectorAll("nav p")].map(
      (node) => node.textContent?.trim() ?? "",
    );

    expect(headings.sort()).toEqual(["Assistant", "Knowledge"]);
    for (const gone of ["Home", "Insights", "Forms", "Tools", "Admin"]) {
      expect(headings, gone).not.toContain(gone);
    }
  });

  it("gives an Admin the whole rail, including the admin console", () => {
    // The other end of the same filter, so a bug that hides everything from
    // everybody cannot pass the Employee assertions above.
    const { container } = renderAs("admin", false);
    const links = navLinks(container);

    for (const label of ["Overview", "Ask Sunny", "Form Templates", "User Management"]) {
      expect(links, label).toContain(label);
    }
  });
});
