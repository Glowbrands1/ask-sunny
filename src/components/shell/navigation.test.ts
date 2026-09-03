import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REPORTS_DEFAULT_PATH,
  REPORTS_SECTION_PATH,
} from "@/features/reports/reports-routes";

import { isActivePath, NAV_SECTIONS, type NavItem } from "./navigation";

/**
 * WHERE THE SIDEBAR SENDS PEOPLE.
 *
 * The bug these tests exist for was not a broken route. `/reports/salon-
 * performance` rendered correctly the whole time; `/reports` rendered a
 * different screen of seeded demo figures under the same title, and the sidebar
 * pointed at that one. The dashboard was reachable only by typing its URL, so
 * the failure was entirely in the navigation and entirely invisible to a test
 * suite that checked pages in isolation.
 *
 * So what is asserted here is the JOIN: that the entry a manager clicks names
 * the route that actually exists, and that the route still exists.
 */

function itemByLabel(label: string): NavItem {
  const item = NAV_SECTIONS.flatMap((section) => section.items).find(
    (candidate) => candidate.label === label,
  );
  if (!item) throw new Error(`No sidebar item labelled "${label}"`);
  return item;
}

const REPORTS = "Reports & Analytics";

describe("the Reports & Analytics entry", () => {
  it("opens the Salon Performance dashboard, not a section index", () => {
    // THE ACCEPTANCE CRITERION, as one assertion: one click, and the CEO is
    // looking at the dashboard.
    expect(itemByLabel(REPORTS).href).toBe(REPORTS_DEFAULT_PATH);
    expect(itemByLabel(REPORTS).href).toBe("/reports/salon-performance");
  });

  it("no longer points at /reports", () => {
    expect(itemByLabel(REPORTS).href).not.toBe(REPORTS_SECTION_PATH);
  });

  it("names a route that exists in the app router", () => {
    /*
     * The href is a string, and a string cannot be typechecked against the
     * filesystem. This is the assertion that would have failed on the original
     * bug's mirror image — a sidebar entry pointing somewhere no page lives —
     * and it fails again if the dashboard is renamed, moved or deleted.
     */
    expect(existsSync("src/app/(app)/reports/salon-performance/page.tsx")).toBe(true);
    // And the drill-down the dashboard links into.
    expect(existsSync("src/app/(app)/reports/salon-performance/[salon]/page.tsx")).toBe(
      true,
    );
  });

  it("still requires the view_reports permission", () => {
    // The entry moved; what may see it did not.
    expect(itemByLabel(REPORTS).permission).toBe("view_reports");
  });
});

describe("the active section while a report is open", () => {
  const reports = itemByLabel(REPORTS);

  it("is lit on the dashboard itself", () => {
    expect(isActivePath("/reports/salon-performance", reports)).toBe(true);
  });

  it("stays lit in the salon drill-down", () => {
    expect(isActivePath("/reports/salon-performance/0468", reports)).toBe(true);
  });

  it("stays lit on the bare section path", () => {
    expect(isActivePath("/reports", reports)).toBe(true);
  });

  it("stays lit on a report that does not exist yet", () => {
    /*
     * WHY `activePrefix` EARNS ITS KEEP. Keyed on `href` this would be false,
     * so shipping Sales Totals would silently un-highlight the section a
     * manager is standing in. Asserted before that report exists, because
     * afterwards it is a bug report rather than a test.
     */
    expect(isActivePath("/reports/sales-totals", reports)).toBe(true);
    expect(isActivePath("/reports/sales-totals/0468", reports)).toBe(true);
  });

  it("is dark everywhere outside the section", () => {
    for (const path of ["/", "/chat", "/reviews", "/knowledge", "/admin/users"]) {
      expect(isActivePath(path, reports), path).toBe(false);
    }
  });

  it("is not fooled by a path that merely starts with the same characters", () => {
    expect(isActivePath("/reports-archive", reports)).toBe(false);
    expect(isActivePath("/reportsomething", reports)).toBe(false);
  });
});

describe("active state for every other entry", () => {
  it("matches nested routes, so a child page keeps its section lit", () => {
    // Behaviour the removed `matchPrefix` flag claimed to control and never
    // did: it is universal, and these items relied on it already.
    expect(isActivePath("/forms/create/step-2", itemByLabel("Create a Form"))).toBe(true);
    expect(isActivePath("/admin/users/0468", itemByLabel("User Management"))).toBe(true);
  });

  it("does not mark Overview active everywhere", () => {
    /*
     * `/` is the one href a prefix match must not be applied to — every path
     * starts with it.
     */
    const overview = itemByLabel("Overview");
    expect(isActivePath("/", overview)).toBe(true);
    for (const path of ["/chat", "/reports/salon-performance", "/knowledge"]) {
      expect(isActivePath(path, overview), path).toBe(false);
    }
  });

  it("lights exactly one entry for any reporting route", () => {
    /*
     * Two lit entries is as wrong as none, and the section prefix `/reports`
     * now overlaps the dashboard's own path — worth pinning that nothing else
     * in the sidebar claims it.
     */
    for (const path of [
      "/reports",
      "/reports/salon-performance",
      "/reports/salon-performance/0468?grain=monthly",
    ]) {
      const lit = NAV_SECTIONS.flatMap((section) => section.items).filter((item) =>
        isActivePath(path.split("?")[0], item),
      );
      expect(lit.map((item) => item.label), path).toEqual([REPORTS]);
    }
  });
});

describe("the sidebar as a whole", () => {
  it("keeps the section structure the app was designed around", () => {
    expect(NAV_SECTIONS.map((section) => section.label)).toEqual([
      "Home",
      "Assistant",
      "Insights",
      "Knowledge",
      "Forms",
      "Tools",
      "Admin",
    ]);
    expect(
      NAV_SECTIONS.find((section) => section.label === "Insights")?.items.map(
        (item) => item.label,
      ),
    ).toEqual([REPORTS, "Google Reviews"]);
  });

  it("points at no deployment-specific hostname", () => {
    /*
     * The dashboard was demonstrated on a Vercel Preview URL, and the tempting
     * fix for "the CEO cannot find it" was to paste that URL into the sidebar.
     * Every href must stay a root-relative internal path so it resolves on
     * whatever domain the app is actually served from.
     */
    for (const item of NAV_SECTIONS.flatMap((section) => section.items)) {
      expect(item.href, item.label).toMatch(/^\//);
      expect(item.href, item.label).not.toContain("vercel.app");
      expect(item.href, item.label).not.toContain("://");
    }
  });
});
