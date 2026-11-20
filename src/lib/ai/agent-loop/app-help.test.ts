import { describe, expect, it } from "vitest";

import { appHelp } from "./tools";

/*
 * QA's code audit (20 Nov 2026, on 9e1d1f67): app_help's "what Sunny does" answer said "It does not hold sales, review or
 * scheduling data", which contradicts read_reviews and read_stats. CLAUDE.md §5: anything a manager can ask about must
 * be readable by the AI, and the app's own description of itself says what it can read.
 */
describe("app_help: what the app does", () => {
  it("says it reads the Google Reviews and report figures, and never that it holds no review or sales data", async () => {
    const answer = String((await appHelp({})).answer);
    expect(answer).not.toMatch(/does not hold sales|no (?:sales|review) data/i);
    expect(answer).toMatch(/Google Reviews/);
    expect(answer).toMatch(/Daily Stats, Sales Totals, Comp/);
    expect(answer).toMatch(/no scheduling data/);
  });
});
