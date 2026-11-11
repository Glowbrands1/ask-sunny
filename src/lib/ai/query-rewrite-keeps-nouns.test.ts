import { afterEach, describe, expect, it, vi } from "vitest";

import { rewriteToManualTerms } from "./query-rewrite-claude";
import { operationalHowTo, withOwnNouns } from "./query-rewrite";

/*
 * QUERY_REWRITE_KEEPS_NOUNS_ENABLED (QA, 11 Nov 2026; Coding-4's follow-up on conv_mwb2hmb62lroh57). The tester's three
 * questions, word for word (conv_mwb2gsx52k6reh7, conv_mwb2hmb62lroh57, conv_mwb2iugw2fxzr9z). The rewrite turned the
 * how-to into the policy manual's heading "Care and Cleaning of Equipment and Facilities", and the search found the
 * Tanning Consultant Manual's contents page instead of its cleaning section.
 */
const HEADING = "Care and Cleaning of Equipment and Facilities";
const HEADINGS = [HEADING, "Attendance", "Standards of Conduct", "Late Opening"];
const QUESTIONS = [
  "how do i coach on the spray tan booth reset step after cleaning?",
  "how do I reset the spray tan equipment after cleaning it, so I can coach my team on it?",
  "What are the Spray Tan Cleaning Instructions from the Tanning Consultant Manual? What do I do last, to reset the equipment?",
];

async function rewrite(question: string, callModel = vi.fn(async () => ({ heading: HEADING }))) {
  const query = await rewriteToManualTerms({ question, history: [], fallback: question, scopeId: "global", loadHeadings: async () => HEADINGS, callModel });
  return { query, callModel };
}

describe("QUERY_REWRITE_KEEPS_NOUNS_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(QUESTIONS)("on: %s — never the policy heading; the manager's own nouns are searched, and no model call", async (question) => {
    vi.stubEnv("QUERY_REWRITE_KEEPS_NOUNS_ENABLED", "true");
    const { query, callModel } = await rewrite(question);
    expect(query).not.toBe(HEADING);
    expect(query.toLowerCase()).toContain("spray");
    expect(query.toLowerCase()).toContain("reset");
    expect(callModel).not.toHaveBeenCalled();
  });

  it.each(QUESTIONS)("off: %s — the policy heading, as before", async (question) => {
    vi.stubEnv("QUERY_REWRITE_KEEPS_NOUNS_ENABLED", "");
    expect((await rewrite(question)).query).toBe(HEADING);
  });

  it.each([
    "what is our policy on cleaning the beds?",
    "how do I write up an employee who was late twice?",
    "she opened the salon 20 minutes late, which policy is that?",
  ])("on: %s is not an operational how-to; the rewrite reads it as before", async (question) => {
    vi.stubEnv("QUERY_REWRITE_KEEPS_NOUNS_ENABLED", "");
    const off = (await rewrite(question)).query;
    vi.stubEnv("QUERY_REWRITE_KEEPS_NOUNS_ENABLED", "true");
    expect(operationalHowTo(question)).toBe(false);
    // The rewrite is not bypassed: the same heading as with the flag off.
    expect((await rewrite(question)).query).toBe(off);
  });

  it("the nouns a rewritten query lacks are added once", () => {
    expect(withOwnNouns("how do I reset the spray tan booth timer?", "booth")).toBe("booth reset spray tan timer");
    expect(withOwnNouns("how do I reset the booth?", "reset the booth")).toBe("reset the booth");
  });
});
