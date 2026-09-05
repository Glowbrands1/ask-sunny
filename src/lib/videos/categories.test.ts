import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isVideoCategory,
  VIDEO_CATEGORIES,
  VIDEO_CATEGORY_IDS,
  VIDEO_CATEGORY_LABEL,
} from "./categories";

/**
 * ============================================================================
 * ONE RUNTIME VOCABULARY, AND IT IS EXHAUSTIVE
 * ============================================================================
 *
 * There were two: this module held ids for server validation while the dialog
 * and the library read `VIDEO_CATEGORIES` out of `@/data/demo/videos`. Two
 * runtime lists of one vocabulary drift silently — a category added for the UI
 * would have been rejected by a server that never heard of it.
 *
 * AND THE OLD GUARD DID NOT GUARD. `satisfies readonly VideoCategory[]` proves
 * every listed id is a member of the union; it does NOT prove the list contains
 * every member, so dropping one compiled cleanly and quietly made that category
 * unselectable and un-postable. `Record<VideoCategory, string>` is what
 * actually checks, because TypeScript requires a key per union member.
 */

describe("there is one source", () => {
  it("is re-exported by the demo module rather than redefined there", () => {
    const demo = readFileSync("src/data/demo/videos.ts", "utf8");

    expect(demo).toMatch(
      /export \{ VIDEO_CATEGORIES, VIDEO_CATEGORY_LABEL \} from "@\/lib\/videos\/categories"/,
    );
    // No second literal list.
    expect(demo).not.toMatch(/id: "sales"/);
  });

  it("does not make a live server route depend on seeded demo records", () => {
    const route = readFileSync("src/app/api/videos/route.ts", "utf8");

    expect(route).toContain('from "@/lib/videos/categories"');
    expect(route).not.toContain("@/data/demo/videos");
  });

  it("is what the upload dialog offers", () => {
    const dialog = readFileSync("src/features/videos/upload-video-dialog.tsx", "utf8");
    // Either import path resolves to the same module now, but the options must
    // come from the shared vocabulary rather than a local literal.
    expect(dialog).toContain("VIDEO_CATEGORIES");
    expect(dialog).not.toMatch(/value="sales"/);
  });
});

describe("the vocabulary covers the whole type", () => {
  it("carries all seven categories", () => {
    expect([...VIDEO_CATEGORY_IDS]).toEqual([
      "sales",
      "leadership",
      "equipment",
      "cleaning",
      "troubleshooting",
      "operations",
      "training",
    ]);
  });

  it("labels every one of them", () => {
    for (const id of VIDEO_CATEGORY_IDS) {
      expect(VIDEO_CATEGORY_LABEL[id], id).toBeTruthy();
    }
    expect(VIDEO_CATEGORIES).toHaveLength(VIDEO_CATEGORY_IDS.length);
  });

  it("is exhaustiveness-checked by a Record rather than by satisfies", () => {
    // Comments stripped: the module EXPLAINS why `satisfies` was insufficient,
    // so matching the raw file would fail on the explanation.
    const code = readFileSync("src/lib/videos/categories.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(code).toContain("Record<VideoCategory, string>");
    // The construct that only checked membership, not coverage.
    expect(code).not.toContain("satisfies readonly VideoCategory[]");
  });

  it("derives the id list from the labelled map, not a parallel array", () => {
    const code = readFileSync("src/lib/videos/categories.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // A hand-kept second list is the same drift risk one file down.
    expect(code).toMatch(/Object\.keys\(CATEGORY_LABELS\)/);
  });
});

describe("the runtime check", () => {
  it("accepts every canonical id", () => {
    for (const id of VIDEO_CATEGORY_IDS) expect(isVideoCategory(id)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const value of [
      "made_up_category",
      "Sales",
      "",
      " training",
      null,
      42,
      { id: "sales" },
      /*
       * PROTOTYPE PROPERTIES. `in` walks the prototype chain, so an earlier
       * version of this check returned true for both — and a crafted request
       * could have persisted `category: "toString"` through the very allowlist
       * meant to stop it. `Object.hasOwn` is what closes it.
       */
      "toString",
      "constructor",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(isVideoCategory(value), String(value)).toBe(false);
    }
  });
});
