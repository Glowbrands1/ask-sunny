import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PERMISSIONS, ROLES } from "@/lib/permissions";
import type { Permission, Role } from "@/types";

/**
 * ============================================================================
 * PAGE AUTHORIZATION.
 * ============================================================================
 *
 * The API routes have always had a guard. Pages had none: `/`, `/knowledge`,
 * `/resources` and `/forms/create` rendered for anybody who typed the URL, and
 * the sidebar's job was to not mention them.
 *
 * The first describe block is the one that will still be doing work in a year.
 * It walks the app directory rather than listing routes, so a page added next
 * month is covered on the day it is added — which is the only way a rule like
 * this survives, because the failure mode is a NEW page nobody remembered to
 * guard, and a hand-written list of routes says nothing about pages that were
 * not in it when it was written.
 */

const APP_DIR = "src/app/(app)";

/** Every page.tsx under the authenticated app segment. */
function appPages(dir = APP_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...appPages(path));
    else if (entry.name === "page.tsx") found.push(path);
  }
  return found.sort();
}

describe("every page in the authenticated app is guarded on the server", () => {
  const pages = appPages();

  it("finds the pages at all, so an empty sweep cannot pass silently", () => {
    // A directory rename would otherwise turn every assertion below into a
    // vacuous loop over nothing.
    expect(pages.length).toBeGreaterThanOrEqual(16);
  });

  it.each(appPages())("%s calls a server-side page guard", (page) => {
    const source = readFileSync(page, "utf8");
    expect(source).toMatch(/requirePagePermission\(|requireAuthenticatedPage\(/);
  });

  it.each(appPages())("%s awaits the guard BEFORE reading any data", (page) => {
    /*
     * Ordering is the whole value of a server-side gate. A guard that runs
     * after the queries has already put the rows into the render; one that runs
     * after an `await` of anything else has already done that work for somebody
     * who may not see it. So the guard must be the first await in the function.
     */
    const source = readFileSync(page, "utf8");
    const body = source.slice(source.indexOf("export default"));
    const guard = body.search(/await require(PagePermission|AuthenticatedPage)\(/);
    const firstAwait = body.search(/await /);

    expect(guard, page).toBeGreaterThan(-1);
    expect(guard, page).toBe(firstAwait);
  });

  it.each(appPages())("%s renders dynamically, since the guard reads headers", (page) => {
    // A statically prerendered page never runs the guard for a real request.
    const source = readFileSync(page, "utf8");
    expect(source).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("gates each page on a permission that actually exists", () => {
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      for (const [, permission] of source.matchAll(/requirePagePermission\("([^"]+)"\)/g)) {
        expect(PERMISSIONS, `${page}: ${permission}`).toContain(permission as Permission);
      }
    }
  });

  it("gates the four screens that previously had no check at all", () => {
    /*
     * Named individually because these are the ones this milestone is about.
     * The others already had a client-side PermissionGate; these had nothing.
     */
    const expected: Record<string, Permission> = {
      "page.tsx": "view_overview",
      "knowledge/page.tsx": "view_knowledge",
      "resources/page.tsx": "view_manager_resources",
      "forms/create/page.tsx": "view_forms_workspace",
    };
    for (const [suffix, permission] of Object.entries(expected)) {
      const page = pages.find((candidate) => relative(APP_DIR, candidate) === suffix);
      expect(page, suffix).toBeDefined();
      expect(readFileSync(page!, "utf8"), suffix).toContain(
        `requirePagePermission("${permission}")`,
      );
    }
  });
});

describe("where a role lands", () => {
  it("sends an Employee to Ask Sunny, not to the Overview", async () => {
    /*
     * THE REDIRECT LOOP THIS AVOIDS. An Employee cannot hold `view_overview`,
     * so landing them on `/` would bounce them straight back out — and the
     * bounce target of a forbidden page is the landing page, so the two would
     * ping-pong. Ask Sunny is the screen the role exists for.
     */
    const { defaultLandingForRole } = await import("./page");
    expect(defaultLandingForRole("employee")).toBe("/chat");
  });

  it("sends every role that can see the Overview to the Overview", async () => {
    const { defaultLandingForRole } = await import("./page");
    for (const role of ["salon_director", "district_manager", "admin", "owner"] as Role[]) {
      expect(defaultLandingForRole(role), role).toBe("/");
    }
  });

  it("never lands a role on a page that role cannot open", async () => {
    /*
     * The load-bearing property, checked for EVERY role rather than the two
     * that exist today: the landing page must be one the role can actually
     * open, or signing in is a redirect loop.
     */
    const { defaultLandingForRole } = await import("./page");
    const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
    const required: Record<string, Permission> = {
      "/": "view_overview",
      "/chat": "ask_questions",
    };

    for (const role of ROLES) {
      const landing = defaultLandingForRole(role);
      const permission = required[landing];
      if (permission) {
        expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission), role).toBe(true);
      } else {
        // The only other answer is the login screen, which needs nothing.
        expect(landing, role).toBe("/login");
      }
    }
  });
});

describe("the guard's behaviour, with the framework stubbed", () => {
  const redirects: string[] = [];
  let cookieHeader = "";

  beforeEach(() => {
    vi.resetModules();
    redirects.length = 0;
    cookieHeader = "";
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  });

  afterEach(() => {
    /*
     * `vi.resetModules()` clears the module CACHE but leaves `doMock`
     * registrations in place, so an un-unmocked `./index` from one case
     * silently answered the next one — which is how the demo-mode case below
     * saw a production-grade provider and reported enforcement as on.
     */
    vi.doUnmock("next/headers");
    vi.doUnmock("next/navigation");
    vi.doUnmock("./index");
  });

  /** `redirect()` throws in Next, and code after it must not run. */
  class Redirected extends Error {}

  async function loadGuards(identity: unknown) {
    vi.doMock("next/headers", () => ({
      headers: async () => new Headers(cookieHeader ? { cookie: cookieHeader } : {}),
    }));
    vi.doMock("next/navigation", () => ({
      redirect: (to: string) => {
        redirects.push(to);
        throw new Redirected(to);
      },
    }));
    vi.doMock("./index", () => ({
      getAuthProvider: () => ({
        kind: "supabase",
        name: "Supabase Auth",
        isProductionGrade: true,
        missingConfiguration: [],
        identify: async () => identity,
      }),
    }));
    return import("./page");
  }

  const admin = {
    subject: "user-1",
    email: "admin@example.test",
    displayName: "An Admin",
    role: "admin" as Role,
    scope: { level: "global" as const, primaryAreaId: null, alsoCoversAreaIds: [] },
    verified: true,
  };

  it("sends an unauthenticated caller to the login screen", async () => {
    const { requirePagePermission } = await loadGuards(null);
    await expect(requirePagePermission("view_overview")).rejects.toThrow(Redirected);
    expect(redirects).toEqual(["/login"]);
  });

  it("REFUSES an identity the provider did not verify", async () => {
    /*
     * The demo provider returns a fully-formed identity with `verified: false`.
     * A page guard that only checked for the PRESENCE of an identity would
     * accept it, which is exactly the confusion `verified` exists to prevent.
     */
    const { requirePagePermission } = await loadGuards({ ...admin, verified: false });
    await expect(requirePagePermission("view_overview")).rejects.toThrow(Redirected);
    expect(redirects).toEqual(["/login"]);
  });

  it("lets a permitted role through, and returns the identity", async () => {
    const { requirePagePermission } = await loadGuards(admin);
    const identity = await requirePagePermission("view_overview");
    expect(identity?.role).toBe("admin");
    expect(redirects).toEqual([]);
  });

  it("bounces a forbidden role to its OWN landing page, saying why", async () => {
    const employee = {
      ...admin,
      role: "employee" as Role,
      scope: { level: "salon" as const, primaryAreaId: "loc-1", alsoCoversAreaIds: [] },
    };
    const { requirePagePermission } = await loadGuards(employee);

    await expect(requirePagePermission("view_overview")).rejects.toThrow(Redirected);
    // Its own landing page, not `/` — otherwise this is a loop. And the reason
    // is carried, because a silent bounce gets reported as a broken link.
    expect(redirects).toEqual(["/chat?denied=view_overview"]);
  });

  it("reads the permission from the SERVER matrix, not from any request input", async () => {
    /*
     * The browser's matrix lives in IndexedDB and is editable in demo mode. A
     * client that edited it must not thereby open a screen — so the guard is
     * handed nothing but the identity, and there is no parameter through which
     * a caller could supply permissions.
     */
    const source = readFileSync("src/lib/auth/page.ts", "utf8");
    expect(source).toContain("DEFAULT_PERMISSION_MATRIX");
    expect(source).not.toMatch(/permissionMatrix|useAppStore|searchParams/);
  });

  it("does not enforce in demo mode, and says so in one place", async () => {
    /*
     * Deliberate, and the same call the sidebar already made: the demo matrix
     * is a guess, and enforcing a guess previously left Form Templates with no
     * way in. What matters is that the decision is ONE function, so the guard
     * and the screens that explain themselves cannot disagree about it.
     */
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    // The real selector, not the stub the other cases install.
    vi.doUnmock("./index");
    vi.resetModules();

    vi.doMock("next/headers", () => ({ headers: async () => new Headers() }));
    vi.doMock("next/navigation", () => ({
      redirect: (to: string) => {
        redirects.push(to);
        throw new Redirected(to);
      },
    }));
    const { pageAuthorizationEnforced, requirePagePermission } = await import("./page");

    expect(pageAuthorizationEnforced()).toBe(false);
    // A permission no demo role holds still renders, rather than redirecting.
    await requirePagePermission("manage_users");
    expect(redirects).toEqual([]);
  });
});
