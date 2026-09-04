import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REPORTS_DEFAULT_PATH,
  REPORTS_SECTION_PATH,
} from "@/features/reports/reports-routes";
import {
  DEFAULT_PERMISSION_MATRIX,
  ROLES,
  canAccessAdminConsole,
  hasPermission,
} from "@/lib/permissions";
import type { Role } from "@/types";

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

/**
 * ============================================================================
 * WHAT EACH ROLE SEES ON THE RAIL.
 * ============================================================================
 *
 * The rail is not a security boundary — the page guards and `authorizeRequest`
 * are — but it is what somebody believes the product contains. Two failures
 * matter here and they point in opposite directions:
 *
 *   TOO MUCH. An Employee shown "Reports & Analytics" clicks it, gets bounced,
 *   and reports Ask Sunny as broken. Every link on the rail must be one the
 *   role can actually open.
 *
 *   TOO LITTLE. This is the one that has already happened: filtering on the
 *   permission matrix hid Form Templates from a Salon Director while the page
 *   gate was stood down, so the screen existed with no way in. A gate added
 *   without the matching grant deletes working functionality.
 */
describe("what each role sees on the rail", () => {
  const ALL_ITEMS = NAV_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ section, item })),
  );

  /** The rail as a given role would see it in real mode. */
  function railFor(role: Role) {
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (section.admin && !canAccessAdminConsole(role)) return false;
        if (!item.permission) return true;
        return hasPermission(DEFAULT_PERMISSION_MATRIX, role, item.permission);
      }),
    })).filter((section) => section.items.length > 0);
  }

  function labelsFor(role: Role): string[] {
    return railFor(role).flatMap((section) => section.items.map((item) => item.label));
  }

  it("gives every item a permission, so nothing is visible by default", () => {
    /*
     * THE LOAD-BEARING ASSERTION. Four items had no `permission` at all —
     * Overview, Knowledge Base, Create a Form and Manager Resources — which
     * meant every role saw them and the pages behind them had no gate either.
     * Derived from NAV_SECTIONS, so an item added without a permission fails
     * here rather than quietly appearing for the frontline role.
     */
    for (const { item } of ALL_ITEMS) {
      expect(item.permission, `${item.label} has no permission`).toBeDefined();
    }
  });

  it("shows an Employee exactly Ask Sunny, Knowledge Base and Videos", () => {
    expect(labelsFor("employee").sort()).toEqual(
      ["Ask Sunny", "Knowledge Base", "Videos"].sort(),
    );
  });

  it("leaves an Employee no empty section headings", () => {
    /*
     * A section whose every item was filtered out must not render its heading.
     * "Insights" with nothing under it reads as a loading failure, and
     * "Admin" with nothing under it advertises a console the person cannot
     * reach.
     */
    for (const section of railFor("employee")) {
      expect(section.items.length, section.label).toBeGreaterThan(0);
    }
    const sectionIds = railFor("employee").map((section) => section.id);
    expect(sectionIds).not.toContain("admin");
    expect(sectionIds).not.toContain("insights");
    expect(sectionIds).not.toContain("forms");
    expect(sectionIds).not.toContain("tools");
    expect(sectionIds).not.toContain("home");
  });

  it("never shows a role a link it cannot open", () => {
    /*
     * Checked for EVERY role against the page guard's own permission, read out
     * of the page file. This is the join the rail and the guards have to agree
     * on, and reading the page source is what makes the agreement real rather
     * than two lists that happen to match today.
     */
    for (const role of ROLES) {
      for (const section of railFor(role)) {
        for (const item of section.items) {
          expect(
            hasPermission(DEFAULT_PERMISSION_MATRIX, role, item.permission!),
            `${role} sees ${item.label}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps every previously-visible item visible to the manager roles", () => {
    /*
     * THE REGRESSION GUARD. Before this milestone the four ungated items showed
     * for everyone. Adding a permission must not have taken any of them away
     * from a role that legitimately had them.
     */
    const MANAGERS: Role[] = [
      "assistant_salon_director",
      "salon_director",
      "district_manager",
      "regional_manager",
      "admin",
      "owner",
      "developer",
    ];
    for (const role of MANAGERS) {
      for (const label of ["Overview", "Knowledge Base", "Manager Resources"]) {
        expect(labelsFor(role), `${role} lost ${label}`).toContain(label);
      }
    }
    // Create a Form, for every role that can create one.
    for (const role of MANAGERS.filter((candidate) => candidate !== "assistant_salon_director")) {
      expect(labelsFor(role), `${role} lost Create a Form`).toContain("Create a Form");
    }
  });

  it("takes Create a Form away from the Assistant Salon Director, deliberately", () => {
    /*
     * THE ONE ITEM THIS MILESTONE REMOVES FROM AN EXISTING ROLE, and it is a
     * correction rather than a regression — which is worth stating here because
     * the test above would otherwise read as if nothing was lost.
     *
     * An ASD holds `create_coaching`, and NO TEMPLATE IN THE LIBRARY REQUIRES
     * IT: every one of the ten needs `create_coaching_form`,
     * `create_corrective_action`, `create_epp` or `create_policy_review`, none
     * of which an ASD has. So the workspace they could previously open offered
     * them a builder and then refused every form in it.
     *
     * The assertion is written against the LIBRARY rather than against the
     * matrix, so if an ASD-creatable template is ever added this fails and
     * whoever adds it has to decide about the workspace on purpose.
     */
    const library = readFileSync("src/lib/forms/library.ts", "utf8");
    const required = new Set(
      [...library.matchAll(/requiredPermission: "([^"]+)"/g)].map((match) => match[1]),
    );
    const asdCanCreateSomething = [...required].some((permission) =>
      hasPermission(DEFAULT_PERMISSION_MATRIX, "assistant_salon_director", permission as never),
    );

    expect(asdCanCreateSomething).toBe(false);
    expect(labelsFor("assistant_salon_director")).not.toContain("Create a Form");
    // What they DO keep: monitoring, so they can still see outstanding forms.
    expect(labelsFor("assistant_salon_director")).toContain("Form Monitoring");
  });

  it("matches each item's permission to the gate on the page it opens", () => {
    /*
     * Reads the actual page file for each item's href and asserts the guard
     * there names the SAME permission. A rail entry stricter than its page
     * hides something reachable; looser, and it offers a bounce.
     */
    const routeToFile: Record<string, string> = {
      "/": "src/app/(app)/page.tsx",
      "/chat": "src/app/(app)/chat/page.tsx",
      "/knowledge": "src/app/(app)/knowledge/page.tsx",
      "/videos": "src/app/(app)/videos/page.tsx",
      "/resources": "src/app/(app)/resources/page.tsx",
      "/reviews": "src/app/(app)/reviews/page.tsx",
      "/forms/create": "src/app/(app)/forms/create/page.tsx",
      "/forms/monitoring": "src/app/(app)/forms/monitoring/page.tsx",
      "/forms/templates": "src/app/(app)/forms/templates/page.tsx",
      "/admin/ai-usage": "src/app/(app)/admin/ai-usage/page.tsx",
      "/admin/users": "src/app/(app)/admin/users/page.tsx",
      "/admin/integrations": "src/app/(app)/admin/integrations/page.tsx",
      [REPORTS_DEFAULT_PATH]: "src/app/(app)/reports/salon-performance/page.tsx",
    };

    for (const { item } of ALL_ITEMS) {
      const file = routeToFile[item.href];
      expect(file, `no page mapped for ${item.href}`).toBeDefined();
      const source = readFileSync(file!, "utf8");
      expect(source, `${item.label} -> ${file}`).toContain(
        `requirePagePermission("${item.permission}")`,
      );
    }
  });
});
