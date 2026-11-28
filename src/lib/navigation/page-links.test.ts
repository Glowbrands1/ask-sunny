import { describe, expect, it } from "vitest";

import { AI_READABLE_PAGES } from "@/config/ai-readable-pages";
import { canAccessAdminConsole, DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

import { pageLinksFor, type PageLink } from "./page-links";

/**
 * Pau, 28 Nov 2026: "make sure if sunny or bubble direct them to a page, make sure its clickable". The pages an answer
 * links to are the ones the person's own sidebar shows, so nobody is handed a link to a page they cannot open.
 */
const linksFor = (role: Role, meetingTabs: { href: string; label: string }[] = []): PageLink[] =>
  pageLinksFor({ can: (permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission), isAdmin: canAccessAdminConsole(role), demoMode: false, whatsNewVisible: false }, meetingTabs);
const hrefFor = (links: readonly PageLink[], name: string) => links.find((link) => link.names.includes(name))?.href;

describe("the pages Sunny's answers link to", () => {
  it("a Salon Director's answers link Form Monitoring and the Calendar, never an admin page", () => {
    const links = linksFor("salon_director");
    expect(hrefFor(links, "Form Monitoring")).toBe("/forms/monitoring");
    expect(hrefFor(links, "Calendar")).toBe("/calendar");
    expect(hrefFor(links, "Integrations")).toBeUndefined();
    expect(hrefFor(links, "Woven Employee Sync")).toBeUndefined();
    expect(hrefFor(links, "User Management")).toBeUndefined();
  });

  it("an administrator's answers link Woven Employee Sync and the report tabs", () => {
    const links = linksFor("admin");
    expect(hrefFor(links, "Woven Employee Sync")).toBe("/admin/integrations/woven");
    expect(hrefFor(links, "Sales Totals")).toBe("/reports/sales-totals");
    expect(hrefFor(links, "Reports & Analytics")).toMatch(/^\/reports\//);
  });

  it("\"the L10\" goes to the person's own meeting tab; with no tab it is not a link", () => {
    expect(hrefFor(linksFor("district_manager", [{ href: "/meetings/stc-dm", label: "DM L10" }]), "L10")).toBe("/meetings/stc-dm");
    expect(hrefFor(linksFor("regional_manager"), "L10")).toBeUndefined();
  });

  it("What's New is linked only when the person's sidebar shows it", () => {
    expect(hrefFor(linksFor("admin"), "What's New")).toBeUndefined();
    const shown = pageLinksFor({ can: () => true, isAdmin: true, demoMode: false, whatsNewVisible: true });
    expect(hrefFor(shown, "What's New")).toBe("/whats-new");
  });

  it("every link is a page of this app, never the chat itself, and every role's links are pages it can open", () => {
    const pages = AI_READABLE_PAGES.filter((page) => page.kind === "page");
    for (const role of ROLES) {
      for (const link of linksFor(role, [{ href: "/meetings/stc-dm", label: "DM L10" }])) {
        expect(link.href, `${role}: the chat links to itself`).not.toBe("/chat");
        const page = pages.find((candidate) => candidate.route === link.href || (link.href.startsWith("/meetings/") && candidate.route === "/meetings/[key]"));
        expect(page, `${role}: ${link.href} is not a page`).toBeDefined();
        if (page && "permission" in page.access) {
          expect(hasPermission(DEFAULT_PERMISSION_MATRIX, role, page.access.permission), `${role} is linked to ${link.href}, which they cannot open`).toBe(true);
          if (page.access.adminConsole) expect(canAccessAdminConsole(role), `${role} is linked to ${link.href}, an admin console page`).toBe(true);
        }
      }
    }
  });
});
