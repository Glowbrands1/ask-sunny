import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { firstNameOf, matchesTopic, topicWords } = await import("./form-topic-search");

/* Pau, 21 Nov 2026: a search of past forms by topic, in the managers' own phrasings. Invented names only. */
describe("a form's topic", () => {
  it('"any forms about cash handling at my salons this month?" and "who\'s been written up for dress code?" keep only the topic', () => {
    expect(topicWords("cash handling")).toEqual(["cash", "handling"]);
    expect(topicWords("any forms about cash handling at my salons this month?")).toEqual(["cash", "handling"]);
    expect(topicWords("who's been written up for dress code?")).toEqual(["dress", "code"]);
    expect(topicWords("forms")).toEqual([]);
  });

  it("matches every topic word in the saved text, a word or one starting with its stem; never one word alone", () => {
    expect(matchesTopic("she left the cash drawer open; cash was handled without a count", ["cash", "handling"])).toBe(true);
    expect(matchesTopic("dress code", ["dress", "code"])).toBe(true);
    expect(matchesTopic("wore a hoodie, dress code violation", ["dress", "code"])).toBe(true);
    expect(matchesTopic("the cash drawer was short", ["cash", "handling"])).toBe(false);
    expect(matchesTopic("late to open", ["dress", "code"])).toBe(false);
    expect(matchesTopic("anything", [])).toBe(false);
  });

  it("the person is named by first name only", () => {
    expect(firstNameOf("Remy Calder")).toBe("Remy");
  });
});
