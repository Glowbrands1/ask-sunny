import { describe, expect, it } from "vitest";

import {
  buildGroundingBlock,
  buildSystemPrompt,
  extractUsedMarkers,
  stripMarkers,
  type GroundingChunk,
} from "./prompts";

const CONTEXT = {
  userName: "Dana Reyes",
  locationName: "Riverbend Commons",
  todayIso: "2026-08-29",
};

function chunk(marker: number, title: string): GroundingChunk {
  return {
    marker,
    documentTitle: title,
    locator: `Page ${marker}`,
    content: `Excerpt ${marker}.`,
  };
}

describe("buildSystemPrompt", () => {
  it("names the assistant, the manager and the location", () => {
    const prompt = buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: CONTEXT,
      mode: "standard",
      hasContext: true,
    });

    expect(prompt).toContain("You are Sunny");
    expect(prompt).toContain("Dana Reyes");
    expect(prompt).toContain("Riverbend Commons");
    expect(prompt).toContain("2026-08-29");
  });

  it("forbids fabricating policy, documents and citations", () => {
    const prompt = buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: CONTEXT,
      mode: "standard",
      hasContext: true,
    });

    expect(prompt).toMatch(/Never invent a document title, a page number/i);
    expect(prompt).toMatch(/Never use a marker for a source that is not listed/i);
    expect(prompt).toMatch(/Never claim you have read, checked, searched/i);
    expect(prompt).toMatch(/knowledge base does not have it/i);
  });

  it("requires company knowledge and general guidance to be distinguished", () => {
    const prompt = buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: CONTEXT,
      mode: "standard",
      hasContext: true,
    });

    expect(prompt).toContain("Company knowledge");
    expect(prompt).toContain("General management guidance");
  });

  it("states outright that there is no company knowledge when nothing was retrieved", () => {
    const prompt = buildSystemPrompt({
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: CONTEXT,
      mode: "standard",
      hasContext: false,
    });

    expect(prompt).toMatch(/no company documents matched this question/i);
    expect(prompt).toMatch(/You have NO company knowledge/);
  });

  it("varies the length instruction by answer mode", () => {
    const build = (mode: "quick" | "standard" | "detailed") =>
      buildSystemPrompt({
        assistantName: "Sunny",
        brandName: "Sun Tan City",
        salonNoun: "salon",
        context: CONTEXT,
        mode,
        hasContext: true,
      });

    expect(build("quick")).toContain("two or three sentences");
    expect(build("detailed")).toContain("full picture");
    expect(build("quick")).not.toBe(build("detailed"));
  });
});

describe("buildGroundingBlock", () => {
  it("labels each excerpt with its real title and locator", () => {
    const block = buildGroundingBlock([chunk(1, "Attendance Policy")]);
    expect(block).toContain("[S1] Attendance Policy — Page 1");
    expect(block).toContain("Excerpt 1.");
  });

  it("enumerates exactly which markers are valid", () => {
    const block = buildGroundingBlock([chunk(1, "A"), chunk(2, "B")]);
    expect(block).toContain("Valid markers are [S1], [S2].");
  });

  it("says plainly when nothing matched", () => {
    expect(buildGroundingBlock([])).toContain("No company documents matched");
  });
});

describe("extractUsedMarkers", () => {
  it("returns the markers used, in first-appearance order, deduplicated", () => {
    expect(extractUsedMarkers("Yes [S2]. Also [S1] and again [S2].", [1, 2, 3])).toEqual([
      2, 1,
    ]);
  });

  it("discards a marker the model invented", () => {
    // The model cannot conjure a source card for a document that was never
    // retrieved: out-of-range markers are dropped, not resolved.
    expect(extractUsedMarkers("Policy says so [S9].", [1, 2])).toEqual([]);
  });

  it("returns nothing when the answer cites nothing", () => {
    expect(extractUsedMarkers("I do not have that in the knowledge base.", [1])).toEqual([]);
  });
});

describe("stripMarkers", () => {
  it("removes markers from the displayed prose", () => {
    expect(stripMarkers("Be on time [S1]. Wear the badge [S2].")).toBe(
      "Be on time. Wear the badge.",
    );
  });

  it("removes an invalid marker too, so nothing dangles in the UI", () => {
    expect(stripMarkers("Something [S9].")).toBe("Something.");
  });

  it("leaves ordinary bracketed text alone", () => {
    expect(stripMarkers("See the guide [section 4] for detail.")).toBe(
      "See the guide [section 4] for detail.",
    );
  });
});
