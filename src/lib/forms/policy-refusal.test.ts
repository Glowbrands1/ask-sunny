import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeQuery } from "@/lib/knowledge/types";
import type { SearchResult } from "@/types";

/**
 * ============================================================================
 * THE BLANK FIELD THAT LIED
 * ============================================================================
 *
 * A Disciplinary Plan of Action for a dress code violation came back with
 * "Direct policy from official manual" empty and the notice "No approved policy
 * matched closely enough to quote" — while the company's employment policy
 * manual sat indexed in the corpus with the dress code on page 16.
 *
 * The manual was filed under Operations. `groundPolicy` searches Policies &
 * Compliance only, so the manual was never a candidate and the refusal said
 * nothing a manager could act on.
 *
 * The fail-closed rule is right and is unchanged here: a mis-filed document is
 * still not quotable. What these tests pin is that the refusal now NAMES the
 * document and the fix, and that the diagnosis never leaks into the quote.
 */

const state = {
  /** What the category-filtered search returns. */
  filtered: [] as SearchResult[],
  /** What an unfiltered search returns. */
  unfiltered: [] as SearchResult[],
  queries: [] as KnowledgeQuery[],
  throwOnUnfiltered: false,
};

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => ({
    async search(query: KnowledgeQuery) {
      state.queries.push(query);
      if (query.categories?.length) return state.filtered;
      if (state.throwOnUnfiltered) throw new Error("index offline");
      return state.unfiltered;
    },
  }),
}));

function hit(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    documentTitle: "JBA Policy Manual Edited 5.2025",
    locator: "Page 16 — Dress Code for The Company",
    content: "Employees are to keep a neat, clean, professional appearance at all times.",
    score: 0.62,
    ...overrides,
  };
}

beforeEach(() => {
  state.filtered = [];
  state.unfiltered = [];
  state.queries = [];
  state.throwOnUnfiltered = false;
});

describe("groundPolicy refusal", () => {
  it("names the mis-filed document, its page and its topic", async () => {
    const { groundPolicy } = await import("./policy-grounding");
    state.unfiltered = [hit()];

    const grounding = await groundPolicy("dress code violation, reported in jeans");

    expect(grounding.unverified).toBe(true);
    expect(grounding.reason).toContain("JBA Policy Manual Edited 5.2025");
    expect(grounding.reason).toContain("Page 16 — Dress Code for The Company");
    expect(grounding.reason).toContain("Policies & Compliance");
  });

  it("still refuses to quote what the diagnosis found", async () => {
    const { groundPolicy } = await import("./policy-grounding");
    state.unfiltered = [hit()];

    const grounding = await groundPolicy("dress code violation, reported in jeans");

    // The whole point: a mis-filed document explains the refusal, it does not
    // become a quotation on a disciplinary record.
    expect(grounding.passages).toEqual([]);
    expect(grounding.unverified).toBe(true);
  });

  it("searches Policies & Compliance for anything it may quote", async () => {
    const { groundPolicy, POLICY_CATEGORY } = await import("./policy-grounding");
    state.unfiltered = [hit()];

    await groundPolicy("dress code violation, reported in jeans");

    expect(state.queries[0]!.categories).toEqual([POLICY_CATEGORY]);
  });

  it("says only that nothing matched when nothing matches anywhere", async () => {
    const { groundPolicy } = await import("./policy-grounding");

    const grounding = await groundPolicy("a topic the corpus has never heard of");

    expect(grounding.reason).toBe(
      "No approved policy matched closely enough to quote. The policy fields are left for the manager to complete.",
    );
  });

  it("ignores a weak match rather than pointing at the wrong document", async () => {
    const { groundPolicy, POLICY_MATCH_FLOOR } = await import("./policy-grounding");
    state.unfiltered = [hit({ score: POLICY_MATCH_FLOOR - 0.01 })];

    const grounding = await groundPolicy("dress code violation, reported in jeans");

    expect(grounding.reason).not.toContain("JBA Policy Manual");
  });

  it("still refuses cleanly when the diagnosis search itself fails", async () => {
    const { groundPolicy } = await import("./policy-grounding");
    state.throwOnUnfiltered = true;

    const grounding = await groundPolicy("dress code violation, reported in jeans");

    expect(grounding.unverified).toBe(true);
    expect(grounding.reason).toContain("No approved policy matched");
  });

  it("does not run a second search when approved policy was found", async () => {
    const { groundPolicy } = await import("./policy-grounding");
    state.filtered = [hit()];

    const grounding = await groundPolicy("dress code violation, reported in jeans");

    expect(grounding.unverified).toBe(false);
    expect(grounding.passages).toHaveLength(1);
    expect(state.queries).toHaveLength(1);
  });
});
