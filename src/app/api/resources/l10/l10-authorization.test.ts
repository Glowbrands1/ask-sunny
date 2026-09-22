import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_ONLY_PERMISSIONS,
  DEFAULT_PERMISSION_MATRIX,
  ROLES,
  hasPermission,
  isPermissionLockedFor,
} from "@/lib/permissions";
import { L10_MEETINGS_PATH, L10_MEETINGS_URL_ENV, readL10Url } from "@/lib/config/l10-link";
import type { Role } from "@/types";

/**
 * =============================================================================
 * THE L10 MEETING LINK IS ADMINISTRATOR-ONLY, AND THAT IS ENFORCED ON THE SERVER
 * =============================================================================
 *
 * REQUESTED BY THE CLIENT: "The L10 meeting link needs to be restricted to admin
 * accounts only for now."
 *
 * WHY THIS FILE EXISTS RATHER THAN A RENDER TEST. Hiding the tile satisfies the
 * sentence and not the requirement: the destination would still have been
 * compiled into the JavaScript every manager downloads, and the tile's own href
 * would still have worked when pasted. So the test that matters is the one
 * below — a Salon Director, a District Manager and a Regional Manager are
 * REFUSED BY THE ROUTE, with no destination in the response, whether or not any
 * screen ever offered them a link.
 *
 * NO EMAIL ADDRESS APPEARS ANYWHERE IN THIS PATH. The rule is a permission on a
 * role, resolved from `app_users` by `authorizeRequest`; "do not hard-code
 * individual email addresses" is satisfied structurally, because there is
 * nowhere in the check to put one.
 */

const ORIGINAL = { ...process.env };

const DESTINATION = "https://l10.example.com/meetings";

/** Every role the client's matrix calls an administrator. */
const ADMIN_ROLES: Role[] = ["admin", "owner", "developer"];

/** The three the brief names explicitly, plus the frontline role. */
const NON_ADMIN_ROLES: Role[] = [
  "employee",
  "assistant_salon_director",
  "salon_director",
  "district_manager",
  "regional_manager",
];

async function load(role: Role | null) {
  vi.resetModules();

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      const { AuthError } = await import("@/lib/auth/types");
      if (!role) throw new AuthError("unauthenticated", "You are not signed in.");
      /*
       * THE REAL MATRIX, NOT A STUB ANSWER. The fake stands in for session
       * resolution only; whether the role holds the permission is decided by
       * the same table the server uses, so a grant added to a manager role by
       * mistake fails this test rather than passing it.
       */
      if (
        !hasPermission(
          DEFAULT_PERMISSION_MATRIX,
          role,
          permission as Parameters<typeof hasPermission>[2],
        )
      ) {
        throw new AuthError("forbidden", "Your role does not have access to this.");
      }
      return {
        identity: {
          subject: "11111111-1111-4111-8111-111111111111",
          email: "person@example.com",
          displayName: "Person",
          role,
          scope: { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] },
          verified: true,
        },
      };
    },
  }));

  return import("./route");
}

beforeEach(() => {
  process.env[L10_MEETINGS_URL_ENV] = DESTINATION;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/auth/server");
  process.env = { ...ORIGINAL };
});

/* --------------------------------------------------------- the permission -- */

describe("the permission itself", () => {
  it("is held by the administrator roles and by nobody else", () => {
    for (const role of ADMIN_ROLES) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "view_l10_meetings")).toBe(true);
    }
    for (const role of NON_ADMIN_ROLES) {
      expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, "view_l10_meetings")).toBe(false);
    }
  });

  it("covers every role the matrix declares, so a new one is denied by default", () => {
    const decided = new Set([...ADMIN_ROLES, ...NON_ADMIN_ROLES]);
    expect(ROLES.filter((role) => !decided.has(role))).toEqual([]);
  });

  it("is locked in the matrix UI rather than offered as a checkbox", () => {
    /*
     * "for now" is the client's own wording. Locking it means an administrator
     * cannot widen it by ticking a box on the permissions screen — opening it
     * up is a deliberate change to the grants, not a stray click.
     */
    expect(ADMIN_ONLY_PERMISSIONS).toContain("view_l10_meetings");
    expect(isPermissionLockedFor("salon_director", "view_l10_meetings")).toBe(true);
  });
});

/* -------------------------------------------------------------- the route -- */

describe("GET /api/resources/l10", () => {
  it("redirects an administrator to the configured destination", async () => {
    for (const role of ADMIN_ROLES) {
      const route = await load(role);
      const response = await route.GET(new Request("https://app.test/api/resources/l10"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(DESTINATION);
      // Never cached: the answer depends on who asked, and salon devices are shared.
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("refuses a manager, and tells them nothing about the destination", async () => {
    for (const role of NON_ADMIN_ROLES) {
      const route = await load(role);
      const response = await route.GET(new Request("https://app.test/api/resources/l10"));

      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();

      const body = JSON.stringify(await response.json());
      expect(body).not.toContain(DESTINATION);
      expect(body).not.toContain("l10.example.com");
    }
  });

  it("refuses an unauthenticated caller", async () => {
    const route = await load(null);
    const response = await route.GET(new Request("https://app.test/api/resources/l10"));
    expect(response.status).toBe(401);
  });

  it("refuses a manager identically whether or not a destination is configured", async () => {
    /*
     * A different answer would tell an unauthorized caller that there is
     * something there to find, which is a smaller leak than the URL and still a
     * leak.
     */
    const configured = await (await load("salon_director")).GET(
      new Request("https://app.test/api/resources/l10"),
    );
    delete process.env[L10_MEETINGS_URL_ENV];
    const unconfigured = await (await load("salon_director")).GET(
      new Request("https://app.test/api/resources/l10"),
    );

    expect(unconfigured.status).toBe(configured.status);
    expect(await unconfigured.json()).toEqual(await configured.json());
  });

  it("tells an administrator which variable to set when there is none", async () => {
    delete process.env[L10_MEETINGS_URL_ENV];
    const route = await load("admin");
    const response = await route.GET(new Request("https://app.test/api/resources/l10"));

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).toContain(L10_MEETINGS_URL_ENV);
  });
});

/* ------------------------------------------------------- the configuration -- */

describe("the destination is configuration, and is never guessed", () => {
  it("is absent until a deployment is given one", () => {
    expect(readL10Url({})).toBeNull();
    expect(readL10Url({ [L10_MEETINGS_URL_ENV]: "   " })).toBeNull();
  });

  it("refuses a relative value, which would redirect back into this app", () => {
    expect(readL10Url({ [L10_MEETINGS_URL_ENV]: "/l10" })).toBeNull();
    expect(readL10Url({ [L10_MEETINGS_URL_ENV]: "leadership-sync" })).toBeNull();
  });

  it("refuses a non-http scheme", () => {
    expect(readL10Url({ [L10_MEETINGS_URL_ENV]: "javascript:alert(1)" })).toBeNull();
    expect(readL10Url({ [L10_MEETINGS_URL_ENV]: "file:///etc/passwd" })).toBeNull();
  });

  it("accepts an absolute http(s) URL", () => {
    expect(readL10Url({ [L10_MEETINGS_URL_ENV]: DESTINATION })).toBe(DESTINATION);
  });

  it("is not a NEXT_PUBLIC_ variable, so it is never inlined into a bundle", () => {
    /*
     * The whole difference between restricting the link and hiding it. A
     * NEXT_PUBLIC_ value is compiled into the JavaScript every visitor
     * downloads; this one is read by the route and by nothing else.
     */
    expect(L10_MEETINGS_URL_ENV.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  it("is what every surface links to, so no surface holds the address", () => {
    expect(L10_MEETINGS_PATH).toBe("/api/resources/l10");
  });
});
