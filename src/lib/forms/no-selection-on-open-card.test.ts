import { afterEach, describe, expect, it } from "vitest";

import type { AskResponse } from "@/lib/ai/types";

import { withoutSelectionOnOpenCard } from "./no-selection-on-open-card";

/*
 * NO_SELECTION_ON_OPEN_CARD_ENABLED (Pau's sf-b6, twin). The replay pack runs the chat with the manager's words:
 * `nov5-pau-sf-b6-twin-cases.ts`.
 */
const choice = (templateKey: string) => ({ templateKey, templateName: templateKey, description: "" });
const answer = {
  content: "I can add that detail as the factual account on the form.\n\nBased on what you've described, I can prepare:",
  citations: [],
  coverage: "not_applicable",
  recommendedVideoIds: [],
  formSelection: { primary: choice("dpoa"), additional: [choice("coaching")] },
} as unknown as AskResponse;

afterEach(() => {
  delete process.env.NO_SELECTION_ON_OPEN_CARD_ENABLED;
});

describe("the form choice with a card on screen", () => {
  it("is left off, with its lead, when it offers the card's own form; as before with the flag off", () => {
    expect(withoutSelectionOnOpenCard(answer, "dpoa")).toBe(answer);
    process.env.NO_SELECTION_ON_OPEN_CARD_ENABLED = "true";
    const read = withoutSelectionOnOpenCard(answer, "dpoa");
    expect(read.formSelection).toBeUndefined();
    expect(read.content).toBe("I can add that detail as the factual account on the form.");
  });

  it("stays with no card on screen, or a card of a form it does not offer", () => {
    process.env.NO_SELECTION_ON_OPEN_CARD_ENABLED = "true";
    expect(withoutSelectionOnOpenCard(answer, undefined)).toBe(answer);
    expect(withoutSelectionOnOpenCard(answer, "exit")).toBe(answer);
  });
});
