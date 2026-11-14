import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * EXCERPT_EMPTY_CARD_DROP_ENABLED through the real search route (QA via Coding-5, 11 Nov 2026). Only identity, the rate
 * limit and the database match are stand-ins. The p.43 "Buff City Soap:" holidays row is Coding-5's, verbatim.
 */
const ROWS = [
  {
    chunk_id: "chunk-43",
    document_id: "doc-jba",
    document_title: "2025 JBA Policy Manual - Edited 5-2025",
    category: "policies_compliance",
    locator: "Page 43 — Buff City Soap",
    page: 43,
    section: "Buff City Soap",
    content:
      "Buff City Soap:\nBuff City Soap is closed on the below listed holidays. These holidays are paid holidays for\nsalaried managers and full-time staff:\no Independence Day\no Thanksgiving Day\no Christmas Day\no New Years Day\no Easter",
    similarity: 0.8,
  },
  {
    chunk_id: "chunk-42",
    document_id: "doc-jba",
    document_title: "2025 JBA Policy Manual - Edited 5-2025",
    category: "policies_compliance",
    locator: "Page 42 — Paid Time Off",
    page: 42,
    section: "Paid Time Off",
    content: "Full-time employees accrue paid time off each pay period.",
    similarity: 0.79,
  },
];

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
});
vi.mock("@/lib/auth/server", () => ({ authorizeRequest: async () => ({ identity: { subject: "u1", role: "salon_director" } }) }));
vi.mock("@/lib/knowledge/providers/supabase", () => ({ SupabaseKnowledgeProvider: class { async match() { return ROWS; } } }));

const { POST } = await import("./route");

async function cards() {
  const response = await POST(new Request("https://app.test/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: "paid holidays" }) }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { citations: { locator: string; excerpt: string }[] }).citations;
}

describe("the search route's source cards (EXCERPT_EMPTY_CARD_DROP_ENABLED)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on, with the brand filter: no empty card, and none labelled with the sibling company", async () => {
    vi.stubEnv("EXCERPT_BRAND_FILTER_ENABLED", "true");
    vi.stubEnv("EXCERPT_EMPTY_CARD_DROP_ENABLED", "true");
    const shown = await cards();
    expect(shown.some((card) => card.excerpt.trim() === "")).toBe(false);
    expect(shown.some((card) => /Buff\s+City/i.test(card.locator))).toBe(false);
    expect(shown.map((card) => card.locator)).toEqual(["Page 42 — Paid Time Off"]);
  });

  it("off: the empty, sibling-labelled card is still there (the bug, as the brand filter alone leaves it)", async () => {
    vi.stubEnv("EXCERPT_BRAND_FILTER_ENABLED", "true");
    vi.stubEnv("EXCERPT_EMPTY_CARD_DROP_ENABLED", "");
    const shown = await cards();
    expect(shown.map((card) => [card.locator, card.excerpt])).toContainEqual(["Page 43 — Buff City Soap", ""]);
  });
});
