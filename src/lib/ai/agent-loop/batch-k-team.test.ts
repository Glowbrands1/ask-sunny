import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { teamWords } = await import("./tools");

/* Batch K9 (QA's 266-chat shadow replay): the team reader's misspellings and wordings; names invented. */
describe("coach_team's reading of the request", () => {
  it("near-misses of coaching", () => {
    expect(teamWords("coahcing for my entire team")).toBe("coaching for the whole team");
    expect(teamWords("I need a coachng form for my whole team")).toBe("I need a coaching form for the whole team");
    expect(teamWords("caoching for everyone on my team")).toBe("coaching for the whole team");
  });
  it("words that are not coaching stay", () => {
    expect(teamWords("catching up with Remy Calder")).toBe("catching up with Remy Calder");
    expect(teamWords("cooking class for the team")).toBe("cooking class for the team");
  });
});
