import { describe, expect, it } from "vitest";

import { DEMO_CONVERSATIONS, DEMO_FORM_TEMPLATES, DEMO_GENERATED_FORMS } from "@/data/demo";

import {
  DEMO_CONVERSATION_IDS,
  DEMO_FORM_TEMPLATE_IDS,
  DEMO_GENERATED_FORM_IDS,
} from "./demo-record-ids";

/**
 * ============================================================================
 * THE ONE PLACE THE ID LIST AND THE SEEDS ARE ALLOWED TO MEET
 * ============================================================================
 *
 * `demo-record-ids.ts` exists so the IndexedDB cleanup can run on a live
 * deployment without that deployment importing `data/demo/*` — the cleanup
 * has to know which ids to remove, and nothing else about the records.
 *
 * The cost of that separation is the risk every duplicated list carries: it
 * can drift. A seed added and not listed here is a fabricated record that
 * quietly escapes the cleanup and stays in somebody's browser forever; a
 * seed renamed is the same. So the two are compared exactly, here, in a test
 * file — which is a place a static import of the demo data costs nothing,
 * because tests are not shipped.
 */

describe("the purge list matches the seeds exactly", () => {
  it.each([
    ["conversations", DEMO_CONVERSATION_IDS, DEMO_CONVERSATIONS],
    ["generated forms", DEMO_GENERATED_FORM_IDS, DEMO_GENERATED_FORMS],
    ["form templates", DEMO_FORM_TEMPLATE_IDS, DEMO_FORM_TEMPLATES],
  ])("%s", (_label, listed, seeds) => {
    expect([...listed].sort()).toEqual(seeds.map((seed) => seed.id).sort());
  });

  it("lists no id twice", () => {
    for (const list of [
      DEMO_CONVERSATION_IDS,
      DEMO_GENERATED_FORM_IDS,
      DEMO_FORM_TEMPLATE_IDS,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  /**
   * IDS ONLY. The whole justification for shipping this module to production
   * is that an id is opaque — a primary key that states nothing about a
   * person, a salon or a figure. If a name, a URL or a sentence ever appears
   * in it, that justification is gone.
   */
  it("carries nothing but ids", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("./demo-record-ids.ts", import.meta.url),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    // Every string literal in the code must look like one of the id shapes.
    const literals = [...source.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(literal, literal).toMatch(/^(conv-seed-\d+|form-\d+|tpl-[a-z-]+)$/);
    }
  });
});
