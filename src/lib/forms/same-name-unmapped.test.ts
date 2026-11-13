import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AskResponse } from "@/lib/ai/types";

import { directoryTitle } from "./employee-roster";
import { withUnmappedSameNameNote } from "./same-name-unmapped";

afterEach(() => vi.unstubAllEnvs());

function card(): AskResponse {
  return {
    content: "I'll draft a **Corrective Action Form** for **Linnea Starkweather**.",
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formProposal: { employeeName: "Linnea Starkweather", locationId: "loc-0309", status: "ready" } as never,
  };
}

describe("PLACEHOLDER_TITLE_IS_NONE_ENABLED: Woven's placeholder is no job title (QA, Sunny 38b live check)", () => {
  it("off: the text as read", () => {
    vi.stubEnv("PLACEHOLDER_TITLE_IS_NONE_ENABLED", "false");
    expect(directoryTitle("No Position Set")).toBe("No Position Set");
  });
  it.each(["No Position Set", "no position", "None", "N/A", "Unknown", "TBD", "-"])("on: %s is no title", (raw) => {
    vi.stubEnv("PLACEHOLDER_TITLE_IS_NONE_ENABLED", "true");
    expect(directoryTitle(raw)).toBeNull();
  });
  it("on: a real title is kept, and blank is null", () => {
    vi.stubEnv("PLACEHOLDER_TITLE_IS_NONE_ENABLED", "true");
    expect(directoryTitle(" Salon Director ")).toBe("Salon Director");
    expect(directoryTitle("   ")).toBeNull();
  });
});

describe("SAME_NAME_UNMAPPED_NOTE_ENABLED: another active person with the name, at no salon (QA, Sunny 38b live check)", () => {
  it("off: the card as built", () => {
    vi.stubEnv("SAME_NAME_UNMAPPED_NOTE_ENABLED", "false");
    const built = card();
    expect(withUnmappedSameNameNote(built, { rosterIds: ["a"], activeIds: ["a", "b"] })).toBe(built);
  });
  it("on: one plain line, the card and Create unchanged", () => {
    vi.stubEnv("SAME_NAME_UNMAPPED_NOTE_ENABLED", "true");
    const out = withUnmappedSameNameNote(card(), { rosterIds: ["a"], activeIds: ["a", "b"] });
    expect(out.content).toMatch(/There's also an active Linnea Starkweather at a location that isn't one of your salons in Ask Sunny\. This card is for the one at [^\n.]+\.$/);
    expect(out.formProposal).toEqual(card().formProposal);
  });
  it("on: nothing when every active person with the name is in the roster (SAME_NAME_ASKS_WHICH asks about those)", () => {
    vi.stubEnv("SAME_NAME_UNMAPPED_NOTE_ENABLED", "true");
    const built = card();
    expect(withUnmappedSameNameNote(built, { rosterIds: ["a", "b"], activeIds: ["a", "b"] })).toBe(built);
    expect(withUnmappedSameNameNote(built, { rosterIds: ["a"], activeIds: ["a"] })).toBe(built);
  });
});
