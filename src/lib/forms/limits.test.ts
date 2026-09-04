import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EMPLOYEE_NAME_MAX } from "./limits";

/**
 * THE BUG THIS FILE EXISTS TO PREVENT.
 *
 * `EMPLOYEE_NAME_MAX` first lived in `create-form-flow.tsx`, which carries
 * `"use client"`. A client module's non-component exports become client
 * REFERENCES when a server component imports them, so the server-rendered page
 * evaluated `params.employee?.slice(0, EMPLOYEE_NAME_MAX)` as `slice(0, 0)` and
 * handed the screen an empty name. Typecheck was clean. The component's own
 * tests passed, because they hand the prop straight in and never cross the
 * boundary. Only the browser run caught it.
 *
 * The structural fix is that the constant lives in a plain module. These tests
 * pin that: the value is a real number, and the module it lives in carries
 * neither directive — which is what makes it safe to read on both sides.
 */

/*
 * Comments stripped before scanning. The module's own doc comment explains the
 * bug by quoting `import "server-only"`, and a naive scan matched that prose
 * rather than a real directive — the same trap a source guard fell into earlier
 * in this project.
 */
const SOURCE = readFileSync(new URL("./limits.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("the shared field limits", () => {
  it("is a real number, not a proxy or a string", () => {
    expect(typeof EMPLOYEE_NAME_MAX).toBe("number");
    expect(Number.isInteger(EMPLOYEE_NAME_MAX)).toBe(true);
    expect(EMPLOYEE_NAME_MAX).toBe(120);
  });

  it("actually truncates, which is the operation the page performs", () => {
    // The exact expression the server page runs. If the constant is ever wrong
    // in a way that types cannot see, this is what goes wrong.
    expect("Jordan Vance".slice(0, EMPLOYEE_NAME_MAX)).toBe("Jordan Vance");
    expect("X".repeat(400).slice(0, EMPLOYEE_NAME_MAX)).toHaveLength(120);
  });

  it("lives in a module with no client or server directive", () => {
    /*
     * THE LOAD-BEARING ASSERTION. `"use client"` here would silently reintroduce
     * the original bug; `import "server-only"` would break the browser bundle
     * instead. The module has to be readable from both sides, so it may carry
     * neither.
     */
    expect(SOURCE).not.toMatch(/^\s*["']use client["']/m);
    expect(SOURCE).not.toMatch(/^\s*["']use server["']/m);
    expect(SOURCE).not.toMatch(/import\s+["']server-only["']/);
  });
});

describe("who reads the limit", () => {
  /*
   * All three places that apply the cap must read this module rather than each
   * other — one of them is a server component, and importing it from either
   * client module is exactly what failed.
   */
  const readers = [
    "src/app/(app)/forms/create/page.tsx",
    "src/features/forms/create-form-flow.tsx",
    "src/features/chat/message-bubble.tsx",
  ];

  it("imports it from lib/forms/limits everywhere, and from nowhere else", () => {
    for (const file of readers) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toContain('from "@/lib/forms/limits"');
      // The old cross-boundary import, and any stray hard-coded 120.
      expect(text, file).not.toMatch(/EMPLOYEE_NAME_MAX\s*\}\s*from\s+["'][^"']*create-form-flow/);
      expect(text, file).not.toMatch(/slice\(0,\s*120\)/);
      expect(text, file).not.toMatch(/maxLength=\{?120\}?/);
    }
  });
});
