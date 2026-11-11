import { afterEach, describe, expect, it, vi } from "vitest";

import { cardMetaTurn, NOTHING_TO_COPY } from "@/lib/ai/card-meta-turn";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";

/*
 * Ported from Ask Bubbles: QA's Bubbles 17i live test (11 Nov 2026), the manager's words as typed (the employee is
 * invented). Both reproduce here with production's flags:
 *   - "can you make a CA for <C> for wearing a hoodie to work?" made a card with no Policy line;
 *   - "Do i need to copy and paste it?", with that card on screen, was answered as if there were none.
 * (Its first item, "… one of the forms below." with no forms, is not this app's: the lead here is "I can prepare:".)
 */
const HOODIE_CA = "can you make a CA for Marnie Holloway for wearing a hoodie to work?";

afterEach(() => vi.unstubAllEnvs());

describe("WORN_CLOTHING_IS_DRESS_CODE_ENABLED", () => {
  it("off (production today): \"for wearing a hoodie to work\" names no policy (the bug)", () => {
    vi.stubEnv("WORN_CLOTHING_IS_DRESS_CODE_ENABLED", "");
    const reading = readCaPolicy(HOODIE_CA);
    expect(reading.readFromApp).toBeUndefined();
    expect(caPolicyProposalLine(reading) ?? "").not.toMatch(/Dress Code/);
  });

  it("on: the hoodie is the Dress Code, read from the request (never \"as you said\")", () => {
    vi.stubEnv("WORN_CLOTHING_IS_DRESS_CODE_ENABLED", "true");
    const line = caPolicyProposalLine(readCaPolicy(HOODIE_CA)) ?? "";
    expect(line).toMatch(/\*\*Policy:\*\* Dress Code — read from this request/);
    expect(line).not.toMatch(/as you said/);
  });

  it.each(["she wore sweatpants on her shift", "he showed up in joggers again", "she came to work in pajamas"])("on: %s is the Dress Code", (text) => {
    vi.stubEnv("WORN_CLOTHING_IS_DRESS_CODE_ENABLED", "true");
    expect(readCaPolicy(`create a CA for Marnie Holloway, ${text}`).readFromApp).toBe("dress_code");
  });

  it.each([
    "she sold three hoodies and missed her goal",
    "we ran out of hoodies so she restocked late",
    "she was wearing her uniform but was rude to a guest",
  ])("on: %s is not read as the Dress Code", (text) => {
    vi.stubEnv("WORN_CLOTHING_IS_DRESS_CODE_ENABLED", "true");
    expect(readCaPolicy(`create a CA for Marnie Holloway, ${text}`).readFromApp).not.toBe("dress_code");
  });

  it("on: a policy the manager names still wins", () => {
    vi.stubEnv("WORN_CLOTHING_IS_DRESS_CODE_ENABLED", "true");
    const reading = readCaPolicy("create a CA for Marnie Holloway under the attendance policy, she was late again wearing a hoodie");
    expect(reading.readFromApp).toBeUndefined();
  });
});

describe("COPY_PASTE_POINTS_TO_CARD_ENABLED", () => {
  const CARD = { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Marnie Holloway" };
  const request = {
    question: "Do i need to copy and paste it?",
    continueProposalTemplateKey: "dpoa",
    activeFormInstanceId: undefined,
    questionMessageId: "m-3",
    history: [
      { id: "m-1", role: "user", content: HOODIE_CA },
      { id: "m-2", role: "assistant", content: "I'll draft a **Corrective Action Form** …", formProposal: CARD },
    ],
  } as unknown as Parameters<typeof cardMetaTurn>[0];

  it("off (production today): not a turn about the card (the model answered it as if there were none)", () => {
    vi.stubEnv("COPY_PASTE_POINTS_TO_CARD_ENABLED", "");
    vi.stubEnv("CREATE_COMMAND_POINTS_TO_CARD_ENABLED", "true");
    expect(cardMetaTurn(request)).toBeNull();
  });

  it("on: the reply points to the card's Create draft, and the card stays on it", () => {
    vi.stubEnv("COPY_PASTE_POINTS_TO_CARD_ENABLED", "true");
    const turn = cardMetaTurn(request);
    expect(turn?.card?.content).toBe(NOTHING_TO_COPY);
    expect(turn?.card?.formProposal).toMatchObject({ templateKey: "dpoa", employeeName: "Marnie Holloway" });
    expect(NOTHING_TO_COPY).toMatch(/Create draft/);
  });

  it.each(["do I have to copy it?", "should i copy paste this into the form?", "where do I paste it", "so do i need to copy and paste it?"])(
    "on: %s is a copy question",
    (question) => {
      vi.stubEnv("COPY_PASTE_POINTS_TO_CARD_ENABLED", "true");
      expect(cardMetaTurn({ ...request, question })?.card?.content).toBe(NOTHING_TO_COPY);
    },
  );

  it("on: with no card on screen, nothing changes", () => {
    vi.stubEnv("COPY_PASTE_POINTS_TO_CARD_ENABLED", "true");
    expect(cardMetaTurn({ ...request, continueProposalTemplateKey: undefined })).toBeNull();
  });
});
