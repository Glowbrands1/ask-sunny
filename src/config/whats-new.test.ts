import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";

import { AI_READABLE_PAGES } from "./ai-readable-pages";
import { WHATS_NEW, whatsNewFor } from "./whats-new";

/**
 * The What's New list (Pau, 26 Nov 2026): every entry is well formed, newest first, and an entry about a page is seen
 * only by the roles that can open that page, on the page and from the AI alike.
 */
const can = (role: (typeof ROLES)[number], permission: Parameters<typeof hasPermission>[2]) => hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission);
const APP = join(process.cwd(), "src", "app", "(app)");

describe("What's New", () => {
  it("every entry has a real date, a title and a plain description, newest first", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0);
    for (const entry of WHATS_NEW) {
      expect(entry.date, entry.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(entry.date)), entry.title).toBe(false);
      expect(entry.title.trim().length, entry.date).toBeGreaterThan(3);
      expect(entry.description.trim().length, entry.title).toBeGreaterThan(20);
      // Plain manager language: no flag names or code words.
      expect(entry.description, entry.title).not.toMatch(/_ENABLED|\b[A-Z]+_[A-Z_]+\b|`/);
    }
    const dates = WHATS_NEW.map((entry) => entry.date);
    expect(dates, "add new entries at the top: the list is newest first").toEqual([...dates].sort().reverse());
  });

  it("a link is a page of this app, and the entry is seen only by roles that can open it", () => {
    const own = AI_READABLE_PAGES.find((candidate) => candidate.route === "/whats-new")!;
    const opensWhatsNew = (role: (typeof ROLES)[number]) => "permission" in own.access && can(role, own.access.permission);
    for (const entry of WHATS_NEW) {
      if (!entry.href) continue;
      expect(entry.href, entry.title).toMatch(/^\/[a-z0-9/-]*$/);
      const file = join(APP, ...entry.href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file) || existsSync(file.replace(/\.tsx$/, ".ts")), `${entry.title}: ${entry.href} is not a page`).toBe(true);
      const page = AI_READABLE_PAGES.find((candidate) => candidate.kind === "page" && candidate.route === entry.href);
      expect(page, `${entry.href} has no entry in ai-readable-pages.ts`).toBeDefined();
      if (!page || !("permission" in page.access)) continue;
      // A role that cannot open What's New itself is shown none of it.
      for (const role of ROLES.filter(opensWhatsNew)) {
        if (whatsNewFor(role, can).includes(entry)) {
          expect(can(role, page.access.permission), `${role} is told about ${entry.href}, which they cannot open`).toBe(true);
        }
      }
    }
  });

  it("a role sees only the entries it may open; the preview with no role sees them all", () => {
    expect(whatsNewFor(null, can)).toHaveLength(WHATS_NEW.length);
    const director = whatsNewFor("salon_director", can).map((entry) => entry.title);
    expect(director).toContain("What's New");
    expect(director).not.toContain("Employee address in the Employee Directory");
    expect(whatsNewFor("admin", can).map((entry) => entry.title)).toContain("Employee address in the Employee Directory");
  });

  it("is Ask Sunny's own list: no sibling-app words", () => {
    const source = readFileSync(join(process.cwd(), "src", "config", "whats-new.ts"), "utf8");
    expect(source).not.toMatch(/Bubbles|Buff City|\bstores?\b|Forms Register/);
  });
});
