import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DASHBOARD_QUICK_ACTIONS } from "@/data/quick-actions";
import { NAV_SECTIONS } from "./navigation";

/**
 * ============================================================================
 * FORM CREATION STARTS IN ASK SUNNY — NO GENERIC "CREATE A FORM" WAY IN
 * ============================================================================
 *
 * The standalone builder at `/forms/create` still exists: a chat proposal's
 * handoff and the route's own permission check depend on it, and removing a
 * page is not what was asked. What must not exist is a button or link that
 * takes a manager to it from the app's chrome — the sidebar, the mobile drawer,
 * the Overview shortcuts, the Forms pages, the chat header or the context rail.
 * The chat's own "Create a form" controls are allowed because they are not
 * links: they post "Create a form from this conversation." to Ask Sunny.
 *
 * A SOURCE SCAN, deliberately. A new link to the builder from anywhere in the
 * UI tree fails here, whichever component it is added to.
 */

const UI_ROOTS = ["src/features", "src/components", "src/data", "src/app/(app)"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });
}

describe("no generic Create a Form entry point", () => {
  it("no UI source links or navigates to the standalone builder", () => {
    const offenders: string[] = [];
    for (const file of UI_ROOTS.flatMap(files)) {
      // The builder's own page is allowed to be the builder.
      if (file.endsWith(join("forms", "create", "page.tsx"))) continue;
      const code = readFileSync(file, "utf8")
        // Comments may describe the history; only code is checked.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      if (/["'`]\/forms\/create/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("no Overview shortcut leads to a form builder — a form shortcut opens the chat", () => {
    for (const action of DASHBOARD_QUICK_ACTIONS) {
      expect(action.href, action.label).not.toMatch(/^\/forms/);
      if (/form/i.test(action.label)) expect(action.href, action.label).toMatch(/^\/chat\?q=/);
    }
  });

  it("no sidebar, drawer or collapsed-rail item is Create a Form", () => {
    for (const item of NAV_SECTIONS.flatMap((section) => section.items)) {
      expect(item.href).not.toBe("/forms/create");
      expect(item.label).not.toMatch(/create a form/i);
    }
  });

  it("the chat's own Create a form controls post to Ask Sunny rather than link anywhere", () => {
    const chat = readFileSync("src/features/chat/chat-screen.tsx", "utf8");
    expect(chat).toMatch(/void send\(CREATE_FORM_FROM_CONVERSATION\)/);
    const rail = readFileSync("src/features/chat/context-panel.tsx", "utf8");
    expect(rail).toMatch(/onClick=\{onCreateForm\}/);
    expect(rail.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")).not.toMatch(/<Link[^>]*forms/);
  });
});
