import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/types";
import type { AuthenticatedIdentity } from "./types";

const grant = vi.hoisted(() => ({ value: false as boolean | Error }));

vi.mock("./app-switch-grant", () => ({
  subjectHasSwitchGrant: async () => {
    if (grant.value instanceof Error) throw grant.value;
    return grant.value;
  },
}));

const page = vi.hoisted(() => ({
  enforced: true,
  identity: null as Partial<AuthenticatedIdentity> | null | Error,
}));

vi.mock("./page", () => ({
  pageAuthorizationEnforced: () => page.enforced,
  pageIdentity: async () => {
    if (page.identity instanceof Error) throw page.identity;
    return page.identity;
  },
}));

import { pageShowsAppSwitcher } from "./app-switcher";

function signedInAs(role: Role, verified = true) {
  page.identity = { role, verified };
}

beforeEach(() => {
  page.enforced = true;
  page.identity = null;
  grant.value = false;
});

describe("who is offered the app switcher", () => {
  it.each<Role>(["admin", "owner", "developer"])("a verified %s is", async (role) => {
    signedInAs(role);
    expect(await pageShowsAppSwitcher()).toBe(true);
  });

  it("no other role is", async () => {
    const { ROLES, canAccessAdminConsole } = await import("@/lib/permissions");
    for (const role of ROLES.filter((r) => !canAccessAdminConsole(r))) {
      signedInAs(role);
      expect(await pageShowsAppSwitcher(), role).toBe(false);
    }
  });

  it("an administrator role that is not verified is not", async () => {
    signedInAs("admin", false);
    expect(await pageShowsAppSwitcher()).toBe(false);
  });

  it("nobody signed in is not", async () => {
    expect(await pageShowsAppSwitcher()).toBe(false);
  });

  it("demo mode never is, whatever role the browser claims", async () => {
    page.enforced = false;
    signedInAs("admin");
    expect(await pageShowsAppSwitcher()).toBe(false);
  });

  it("a failed identity lookup is not", async () => {
    page.identity = new Error("auth provider down");
    expect(await pageShowsAppSwitcher()).toBe(false);
  });

  describe("a per-person grant (can_switch_apps)", () => {
    it("offers the switcher to a granted non-administrator, whatever their role", async () => {
      grant.value = true;
      const { ROLES } = await import("@/lib/permissions");
      for (const role of ROLES) {
        signedInAs(role);
        expect(await pageShowsAppSwitcher(), role).toBe(true);
      }
    });

    it("does not offer it without the grant", async () => {
      signedInAs("regional_manager");
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("a grant on an unverified identity does nothing", async () => {
      grant.value = true;
      signedInAs("regional_manager", false);
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("a grant never applies in demo mode", async () => {
      grant.value = true;
      page.enforced = false;
      signedInAs("regional_manager");
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("a failed grant lookup fails closed", async () => {
      grant.value = new Error("db down");
      signedInAs("regional_manager");
      expect(await pageShowsAppSwitcher()).toBe(false);
    });
  });
});
