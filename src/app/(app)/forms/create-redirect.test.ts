import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../../next.config";

/**
 * FORMS ARE ONLY CREATED BY CHATTING WITH ASK SUNNY.
 *
 * The standalone Create a Form screen — form dropdown, employee field, location
 * dropdown, "Start this form" — was removed. An old bookmark or shortcut to it
 * must land in the chat, and nothing may quietly bring the screen back.
 */

async function formsCreateRule() {
  if (typeof nextConfig.redirects !== "function") {
    throw new Error("next.config.ts declares no redirects()");
  }
  return (await nextConfig.redirects()).find((rule) => rule.source === "/forms/create");
}

describe("the /forms/create redirect", () => {
  it("sends the old path, query string and all, to the chat", async () => {
    const rule = await formsCreateRule();
    expect(rule?.destination).toBe("/chat");
    // No `has` / `missing` conditions: `?template=tpl-coaching` matches too.
    expect(rule).not.toHaveProperty("has");
    expect(rule).not.toHaveProperty("missing");
  });

  it("is temporary, so no browser caches it past a later decision", async () => {
    expect((await formsCreateRule())?.permanent).toBe(false);
  });
});

describe("the standalone form builder", () => {
  it("has no page", () => {
    // A `redirects()` rule shadows a page at the same path, so a page here
    // would never render — and would be a builder nobody meant to ship.
    expect(existsSync("src/app/(app)/forms/create")).toBe(false);
  });

  it("is not rendered anywhere else", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) sources.push(path);
      }
    };
    walk("src");

    for (const file of sources) {
      // Comments stripped: several explain what used to link here.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(text, file).not.toContain("Start this form");
      expect(text, file).not.toContain("CreateFormFlow");
      expect(text, file).not.toMatch(/href=["'{`]+\/forms\/create/);
    }
  });
});
