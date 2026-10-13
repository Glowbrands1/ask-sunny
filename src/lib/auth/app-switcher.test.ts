import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/types";
import type { AuthenticatedIdentity } from "./types";

const grant = vi.hoisted(() => ({
  value: false as boolean | Error,
  /** When set, the grant is looked up PER SUBJECT, as the real read does. */
  subjects: null as Set<string> | null,
}));

vi.mock("./app-switch-grant", () => ({
  subjectHasSwitchGrant: async (subject: string) => {
    if (grant.subjects) return grant.subjects.has(subject);
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

function signedInAs(role: Role, verified = true, subject = "sub-default") {
  page.identity = { role, verified, subject };
}

beforeEach(() => {
  page.enforced = true;
  page.identity = null;
  grant.value = false;
  grant.subjects = null;
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

  describe("independent identities with per-person grants", () => {
    const DJ = "sub-dj";
    const COLENE = "sub-colene";

    it("DJ (Regional Manager) and Colene (District Manager) see it; nobody else does", async () => {
      grant.subjects = new Set([DJ, COLENE]);

      signedInAs("regional_manager", true, DJ);
      expect(await pageShowsAppSwitcher(), "DJ").toBe(true);

      signedInAs("district_manager", true, COLENE);
      expect(await pageShowsAppSwitcher(), "Colene").toBe(true);

      // An unrelated manager in the very same roles, and a frontline user.
      signedInAs("regional_manager", true, "sub-other-rm");
      expect(await pageShowsAppSwitcher(), "other RM").toBe(false);
      signedInAs("district_manager", true, "sub-other-dm");
      expect(await pageShowsAppSwitcher(), "other DM").toBe(false);
      signedInAs("employee", true, "sub-employee");
      expect(await pageShowsAppSwitcher(), "employee").toBe(false);
    });

    it("an existing administrator keeps it with no grant at all", async () => {
      grant.subjects = new Set([DJ, COLENE]);
      for (const role of ["admin", "owner", "developer"] as Role[]) {
        signedInAs(role, true, `sub-${role}`);
        expect(await pageShowsAppSwitcher(), role).toBe(true);
      }
    });

    it("a grant is bound to the subject: DJ's grant does not carry to a different login", async () => {
      grant.subjects = new Set([DJ]);
      signedInAs("regional_manager", true, "sub-someone-with-djs-email-alias");
      expect(await pageShowsAppSwitcher()).toBe(false);
    });

    it("a revoked grant stops the switcher on the next render", async () => {
      grant.subjects = new Set([DJ]);
      signedInAs("regional_manager", true, DJ);
      expect(await pageShowsAppSwitcher()).toBe(true);
      grant.subjects = new Set();
      expect(await pageShowsAppSwitcher()).toBe(false);
    });
  });
});
