import { afterEach, describe, expect, it, vi } from "vitest";

import { QUICK_QUESTIONS } from "./quick-questions";
import { COACHING_CONVERSATION_STARTER, COACHING_STARTER, STARTER_TEXTS, TRAINING_STARTER, starterExampleText, withStarterFollowUp } from "./starter-follow-up";
import type { AskRequest, AskResponse } from "./types";

/** QA item 24 and its live re-test: a home starter's who / which follow-up carries one example answer. */
const answer = (content: string, extra: Partial<AskResponse> = {}) => ({ content, citations: [], coverage: "not_applicable", recommendedVideoIds: [], ...extra }) as unknown as AskResponse;
const ask = (question: string, history: AskRequest["history"] = []) => ({ question, history }) as unknown as AskRequest;
const first = { firstMessage: true, namesPerson: false, showedSomething: false };

describe("starter follow-up example (item 24)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keys only to the app's own starter texts", () => {
    const texts = QUICK_QUESTIONS.map((question) => question.text);
    for (const starter of STARTER_TEXTS) expect(texts).toContain(starter);
  });

  it("off: the reply is as it was", () => {
    const reply = answer("Who is this form for? Tell me the employee's full name.");
    expect(withStarterFollowUp(reply, ask(COACHING_STARTER))).toBe(reply);
  });

  it("on: the live re-test's two replies (who-question with \", and …?\", no bold; the coaching-conversation chip) get the example", () => {
    vi.stubEnv("STARTER_FOLLOW_UP_EXAMPLE_ENABLED", "true");
    expect(starterExampleText("I can set that up. Who is this Coaching Form for, and what's it about?", COACHING_STARTER, first))
      .toBe("I can set that up. Who is this Coaching Form for, and what's it about?\n\nFor example: \"coaching for <name> on greeting guests\".");
    expect(starterExampleText("A couple of things first:\n1. Who is this coaching conversation for?\n2. What's the topic you want to cover?", COACHING_CONVERSATION_STARTER, first))
      .toMatch(/\n\nFor example: "a coaching conversation with <name> about greeting guests"\.$/);
    expect(starterExampleText("Here is what I would put on a **Coaching Form**.\n\nWho is this form for? Tell me the employee's full name.", COACHING_STARTER, first))
      .toMatch(/full name\.\n\nFor example: "coaching for <name> on greeting guests"\.$/);
  });

  it("on: never on a later message, a card that names the person, or a training reply that showed training", () => {
    vi.stubEnv("STARTER_FOLLOW_UP_EXAMPLE_ENABLED", "true");
    const who = "Who is this Coaching Form for?";
    expect(starterExampleText(who, COACHING_STARTER, { ...first, firstMessage: false })).toBe(who);
    expect(starterExampleText(who, COACHING_STARTER, { ...first, namesPerson: true })).toBe(who);
    expect(starterExampleText("Which issue should I find training for?", TRAINING_STARTER, first)).toMatch(/training on greeting guests/);
    expect(starterExampleText("Here are two videos. Want more?", TRAINING_STARTER, { ...first, showedSomething: true })).toBe("Here are two videos. Want more?");
    expect(starterExampleText("Who is this Coaching Form for?", "Create a coaching form for Remy Calder", first)).toBe("Who is this Coaching Form for?");
  });
});
