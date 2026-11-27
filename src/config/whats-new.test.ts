import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";

import { AI_READABLE_PAGES } from "./ai-readable-pages";
import { WHATS_NEW, whatsNewFor } from "./whats-new";

/**
 * The What's New list (Pau, 26 Nov 2026; the owner's format of 26 Nov): releases newest first with a summary; each
 * entry tagged New or Improved, with Before / Now / How to use it and an optional Show me page; and an entry about a
 * page is seen only by the roles that can open that page, on the page and from the AI alike.
 */
const can = (role: (typeof ROLES)[number], permission: Parameters<typeof hasPermission>[2]) => hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission);
const APP = join(process.cwd(), "src", "app", "(app)");
const ENTRIES = WHATS_NEW.flatMap((release) => release.entries);
const CODE_WORDS = /_ENABLED|\b[A-Z]+_[A-Z_]+\b|`/;

describe("What's New", () => {
  it("releases are newest first, one per date, each with a real date and a one-line summary", () => {
    expect(WHATS_NEW.length).toBeGreaterThan(0);
    const dates = WHATS_NEW.map((release) => release.date);
    expect(dates, "add a new release at the top: the list is newest first").toEqual([...dates].sort().reverse());
    expect(new Set(dates).size, "one release per date: add to it instead").toBe(dates.length);
    for (const release of WHATS_NEW) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(release.date)), release.date).toBe(false);
      expect(release.summary.trim().length, release.date).toBeGreaterThan(10);
      expect(release.summary, release.date).not.toMatch(/\n/);
      expect(release.entries.length, `${release.date} has no entries`).toBeGreaterThan(0);
    }
  });

  it("every entry is tagged New or Improved and says Before, Now and How to use it, in plain words", () => {
    for (const entry of ENTRIES) {
      expect(["New", "Improved"], entry.title).toContain(entry.tag);
      for (const part of [entry.before, entry.now, entry.howToUse]) {
        expect(part.trim().length, entry.title).toBeGreaterThan(10);
        expect(part, entry.title).not.toMatch(CODE_WORDS);
      }
    }
  });

  it("a Show me link is a page of this app, and the entry is seen only by roles that can open it", () => {
    const own = AI_READABLE_PAGES.find((candidate) => candidate.route === "/whats-new")!;
    const opensWhatsNew = (role: (typeof ROLES)[number]) => "permission" in own.access && can(role, own.access.permission);
    for (const entry of ENTRIES) {
      if (!entry.showMe) continue;
      const { href } = entry.showMe;
      expect(href, entry.title).toMatch(/^\/[a-z0-9/-]*$/);
      const file = join(APP, ...href.split("/").filter(Boolean), "page.tsx");
      expect(existsSync(file) || existsSync(file.replace(/\.tsx$/, ".ts")), `${entry.title}: ${href} is not a page`).toBe(true);
      const page = AI_READABLE_PAGES.find((candidate) => candidate.kind === "page" && candidate.route === href);
      expect(page, `${href} has no entry in ai-readable-pages.ts`).toBeDefined();
      if (!page || !("permission" in page.access)) continue;
      // A role that cannot open What's New itself is shown none of it.
      for (const role of ROLES.filter(opensWhatsNew)) {
        if (whatsNewFor(role, can).some((release) => release.entries.includes(entry))) {
          expect(can(role, page.access.permission), `${role} is told about ${href}, which they cannot open`).toBe(true);
        }
      }
    }
  });

  it("a role sees only the entries it may open; the preview with no role sees them all", () => {
    expect(whatsNewFor(null, can).flatMap((release) => release.entries)).toHaveLength(ENTRIES.length);
    const director = whatsNewFor("salon_director", can).flatMap((release) => release.entries.map((entry) => entry.title));
    expect(director).toContain("What's New");
    expect(director).not.toContain("Employee address in the Employee Directory");
    expect(whatsNewFor("admin", can).flatMap((release) => release.entries.map((entry) => entry.title))).toContain("Employee address in the Employee Directory");
  });

  it("is Ask Sunny's own list: no sibling-app words", () => {
    const source = readFileSync(join(process.cwd(), "src", "config", "whats-new.ts"), "utf8");
    expect(source).not.toMatch(/Bubbles|Buff City|\bstores?\b|Forms Register/);
  });
});
