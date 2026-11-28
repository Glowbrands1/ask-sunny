import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { canAccessAdminConsole, DEFAULT_PERMISSION_MATRIX, hasPermission, ROLES } from "@/lib/permissions";

import { mayReadHomeAddress } from "@/lib/employees/woven/home-address-access";

import { AI_READABLE_PAGES } from "./ai-readable-pages";
import { WHATS_NEW, whatsNewEnabled, whatsNewFor } from "./whats-new";

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
      for (const part of [entry.before, entry.now, entry.howToUse, entry.note].filter((p): p is string => p !== undefined)) {
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
      // An admin console page's entry must say so, or a role holding the permission alone is told about it.
      expect(entry.adminConsole === true, `${entry.title}: ${href} is ${page.access.adminConsole ? "" : "not "}an admin console page`).toBe(page.access.adminConsole === true);
      // A role that cannot open What's New itself is shown none of it.
      for (const role of ROLES.filter(opensWhatsNew)) {
        if (whatsNewFor(role, can).some((release) => release.entries.includes(entry))) {
          expect(can(role, page.access.permission), `${role} is told about ${href}, which they cannot open`).toBe(true);
          if (page.access.adminConsole) expect(canAccessAdminConsole(role), `${role} is told about ${href}, an admin console page`).toBe(true);
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
    // A Regional Manager holds View AI usage but does not open the admin console: not told about the admin's AI-readable pages screen.
    expect(whatsNewFor("regional_manager", can).flatMap((release) => release.entries.map((entry) => entry.title))).not.toContain("The list of pages Sunny can read");
  });

  it("the exit form's address entry is seen by exactly the roles that get the address (mayReadHomeAddress)", () => {
    const entry = ENTRIES.find((candidate) => candidate.title === "The exit form fills in the Permanent Address");
    expect(entry, "the exit form's address entry is missing").toBeDefined();
    for (const role of ROLES) {
      const told = whatsNewFor(role, can).some((release) => release.entries.includes(entry!));
      expect(told, `${role}: told about the exit form's address ${told ? "but does not get it" : "but gets it"}`).toBe(mayReadHomeAddress(role));
    }
    // The Employee Directory's "Show address" is the admin console roles' only.
    const directory = ENTRIES.find((candidate) => candidate.title === "Employee address in the Employee Directory")!;
    for (const role of ROLES.filter((r) => whatsNewFor(r, can).some((release) => release.entries.includes(directory)))) expect(canAccessAdminConsole(role), role).toBe(true);
  });

  it("the owner's red badges and notes (28 Nov 2026) are on their entries", () => {
    const find = (title: string) => ENTRIES.find((candidate) => candidate.title === title);
    expect(find("Search every form for one employee")?.audience).toBe("HR only");
    expect(find("Employee address in the Employee Directory")?.audience).toBe("Admin only");
    expect(find("Employee address in the Employee Directory")?.note).toMatch(/no address in Woven/);
    expect(find("The Corrective Action history box fills itself")?.note).toMatch(/as long as the employee has history/);
    expect(find("Missing fields explained at Finalize")?.before).toBeUndefined();
    expect(find("Delete several drafts at once"), "taken off What's New").toBeUndefined();
  });

  it("a screenshot is a file under public/whats-new/<its release's date>/, small, with alt text", () => {
    for (const release of WHATS_NEW) {
      for (const entry of release.entries) {
        if (!entry.image) continue;
        expect(entry.image.src, entry.title).toMatch(new RegExp(`^/whats-new/${release.date}/[a-z0-9-]+\\.(webp|png)$`));
        const file = join(process.cwd(), "public", ...entry.image.src.split("/").filter(Boolean));
        expect(existsSync(file), `${entry.title}: ${file} is missing`).toBe(true);
        expect(statSync(file).size, `${entry.title}: keep a screenshot under 200 KB`).toBeLessThan(200 * 1024);
        expect(entry.image.alt.trim().length, `${entry.title}: say what the screenshot shows`).toBeGreaterThan(15);
        expect(entry.image.alt, entry.title).not.toMatch(CODE_WORDS);
      }
    }
  });

  it("is Ask Sunny's own list: no sibling-app words", () => {
    const source = readFileSync(join(process.cwd(), "src", "config", "whats-new.ts"), "utf8");
    expect(source).not.toMatch(/Bubbles|Buff City|\bstores?\b|Forms Register/);
  });
});

describe("hidden for everyone until rolled out (Pau, 27 Nov 2026: \"hide this for everyone, for now pls, i will roll it out later\")", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  /*
   * CHANGED ON PURPOSE (the owner, 27 Nov 2026: "live but on my own page only"). The sidebar entry used to be left out
   * of NAV_SECTIONS while the switch was off. It is now always there, marked `whatsNew`, and the server decides per
   * person (`whatsNewVisibleFor`: everyone with the switch on, else WHATS_NEW_USERS), handing the sidebar and search
   * one yes/no (`useWhatsNewVisible`). Who sees it is tested in `src/lib/whats-new/whats-new-access.test.ts`.
   */
  it("unset, the switch is off; the sidebar's What's New entry is marked so the server decides who sees it", async () => {
    vi.stubEnv("NEXT_PUBLIC_WHATS_NEW_ENABLED", undefined);
    expect(whatsNewEnabled()).toBe(false);
    vi.resetModules();
    const { NAV_SECTIONS } = await import("@/components/shell/navigation");
    const entry = NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.href === "/whats-new");
    expect(entry?.whatsNew, "the entry must carry the server's decision, or it shows to everyone").toBe(true);
    /*
     * CHANGED ON PURPOSE (Pau, 28 Nov 2026: answers link the pages the sidebar shows). The rail's rule moved from
     * sidebar.tsx into navigation.ts's visibleNavSections, which the sidebar and the answers' page links both call.
     */
    for (const file of ["navigation.ts", "global-search.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src", "components", "shell", file), "utf8");
      expect(source, `${file} does not hide What's New from whom the server says`).toMatch(/item\.whatsNew && !whatsNewVisible/);
    }
    const sidebar = readFileSync(join(process.cwd(), "src", "components", "shell", "sidebar.tsx"), "utf8");
    expect(sidebar, "the sidebar does not use the shared rule").toMatch(/visibleNavSections\(\{[^}]*whatsNewVisible[^}]*\}\)/);
  });

  it("turned on, the switch is on", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATS_NEW_ENABLED", "true");
    expect(whatsNewEnabled()).toBe(true);
  });

  it("the page is a 404 for anyone the server does not let see it (the verified session, never the browser)", () => {
    const page = readFileSync(join(APP, "whats-new", "page.tsx"), "utf8");
    expect(page).toMatch(/if \(!whatsNewVisibleFor\(identity \?\? \{\}\)\) notFound\(\);/);
    const layout = readFileSync(join(APP, "layout.tsx"), "utf8");
    expect(layout, "the layout hands the sidebar the server's yes/no").toMatch(/<WhatsNewAccessProvider visible=\{whatsNew\}>/);
    expect(layout, "the layout must not read the list itself").not.toMatch(/process\.env\.WHATS_NEW_USERS/);
    // The list must never reach the browser: only the server-only module reads it.
    const provider = readFileSync(join(process.cwd(), "src", "features", "whats-new", "whats-new-access.tsx"), "utf8");
    expect(provider).not.toMatch(/process\.env/);
    const access = readFileSync(join(process.cwd(), "src", "lib", "whats-new", "whats-new-access.ts"), "utf8");
    expect(access).toMatch(/^import "server-only";/);
  });
});
