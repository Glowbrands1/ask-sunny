import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ADMIN_CONSOLE_ROLES, DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";

/**
 * ============================================================================
 * WHO MAY OPEN THE BASELINE SETUP SCREEN
 * ============================================================================
 *
 * The screen reads every listing's anchor and the held reviews behind it, and
 * every control on it moves the line the business counts from. The guard has to
 * run on the SERVER before a row is read, because a refused caller must never
 * receive the data they would have been shown — a client-side redirect happens
 * after the render has already put it in the response.
 *
 * It is gated on `manage_integrations`, the same permission the Integrations
 * screen uses, and NOT on `view_google_reviews`, which most of the org chart
 * holds. Reading the dashboard and deciding what the business counts are
 * different jobs.
 */

const PAGE = "src/app/(app)/reviews/setup/page.tsx";
const source = readFileSync(PAGE, "utf8");

describe("the review baseline setup page", () => {
  it("guards on the server, before it loads anything", () => {
    expect(source).toContain('requirePagePermission("manage_integrations")');

    const guard = source.indexOf("await requirePagePermission");
    const load = source.indexOf("await loadAnchorSetupPage");
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(load);
  });

  it("carries the client-side gate as well, for the mode where guards do not enforce", () => {
    expect(source).toContain('<PermissionGate permission="manage_integrations" adminOnly>');
  });

  it("is not reachable on the dashboard's own, broader permission", () => {
    /* The comment above the guard explains the distinction; the CODE must not. */
    expect(source).not.toMatch(/requirePagePermission\("(?!manage_integrations)/);
    expect(source).not.toMatch(/PermissionGate permission="(?!manage_integrations)/);
  });

  it("is Administration's, and the matrix agrees", () => {
    /*
     * The assertion that actually decides who gets in. If `manage_integrations`
     * ever widened, this page would widen with it silently — so the expectation
     * is stated here, beside the guard that depends on it.
     */
    const holders = ROLES.filter((role) =>
      hasPermission(DEFAULT_PERMISSION_MATRIX, role, "manage_integrations"),
    );

    expect([...holders].sort()).toEqual([...ADMIN_CONSOLE_ROLES].sort());
    expect(holders).not.toContain("district_manager");
    expect(holders).not.toContain("salon_director");
  });
});
