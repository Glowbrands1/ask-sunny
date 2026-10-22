import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/types";
import type { AuthenticatedIdentity } from "./types";

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

import { APP_SWITCHER_USER_IDS, pageShowsAppSwitcher } from "./app-switcher";

function signedInAs(role: Role, verified = true, subject = "someone-else") {
  page.identity = { role, verified, subject };
}

beforeEach(() => {
  page.enforced = true;
  page.identity = null;
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

  describe("the two named non-administrators", () => {
    const [delphine, dj] = APP_SWITCHER_USER_IDS;

    it("Delphine (district_manager) and DJ (regional_manager) are, by user id", async () => {
      signedInAs("district_manager", true, delphine);
      expect(await pageShowsAppSwitcher()).toBe(true);
      signedInAs("regional_manager", true, dj);
      expect(await pageShowsAppSwitcher()).toBe(true);
    });

    it("their email does not grant it — only the id does", async () => {
      page.identity = {
        role: "district_manager",
        verified: true,
        subject: "other-id",
        email: "delphine.ashworth@glowbrands.com",
      };
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("an unverified identity carrying their id is not", async () => {
      signedInAs("district_manager", false, delphine);
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("demo mode is not, even with their id", async () => {
      page.enforced = false;
      signedInAs("district_manager", true, delphine);
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("does not make them administrators", async () => {
      const { canAccessAdminConsole } = await import("@/lib/permissions");
      expect(canAccessAdminConsole("district_manager")).toBe(false);
      expect(canAccessAdminConsole("regional_manager")).toBe(false);
      expect(APP_SWITCHER_USER_IDS).toHaveLength(2);
    });
  });
});
