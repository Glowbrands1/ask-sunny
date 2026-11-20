import { afterEach, describe, expect, it, vi } from "vitest";

import { QUICK_QUESTIONS } from "./quick-questions";
import { COACHING_STARTER, TRAINING_STARTER, withStarterFollowUp } from "./starter-follow-up";
import type { AskRequest, AskResponse } from "./types";

/** QA item 24: a home starter's follow-up carries one example answer (STARTER_FOLLOW_UP_EXAMPLE_ENABLED). */
const answer = (content: string, extra: Partial<AskResponse> = {}) => ({ content, citations: [], coverage: "not_applicable", recommendedVideoIds: [], ...extra }) as unknown as AskResponse;
const ask = (question: string, history: AskRequest["history"] = []) => ({ question, history }) as unknown as AskRequest;

describe("withStarterFollowUp (item 24)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keys only to the app's own starter texts", () => {
    const texts = QUICK_QUESTIONS.map((question) => question.text);
    expect(texts).toContain(COACHING_STARTER);
    expect(texts).toContain(TRAINING_STARTER);
  });

  it("off: the reply is as it was", () => {
    const reply = answer("Who is this form for? Tell me the employee's full name.");
    expect(withStarterFollowUp(reply, ask(COACHING_STARTER))).toBe(reply);
  });

  it("on: the coaching starter's who-question carries the example; a later starter does not", () => {
    vi.stubEnv("STARTER_FOLLOW_UP_EXAMPLE_ENABLED", "true");
    const reply = answer("Here is what I would put on a **Coaching Form**.\n\nWho is this form for? Tell me the employee's full name.");
    expect(withStarterFollowUp(reply, ask(COACHING_STARTER)).content).toMatch(/full name\.\n\nFor example: "coaching for <name> on greeting guests"\.$/);
    expect(withStarterFollowUp(reply, ask(COACHING_STARTER, [{ role: "user", content: "hi" }] as never)).content).toBe(reply.content);
  });

  it("on: the training starter's \"which issue?\" carries examples, only when no training was shown", () => {
    vi.stubEnv("STARTER_FOLLOW_UP_EXAMPLE_ENABLED", "true");
    expect(withStarterFollowUp(answer("Which issue should I find training for?"), ask(TRAINING_STARTER)).content).toMatch(/\n\nFor example: "training on greeting guests" or "training on selling lotion"\.$/);
    const shown = answer("Here are two videos. Want more?", { recommendedVideoIds: ["v1"] });
    expect(withStarterFollowUp(shown, ask(TRAINING_STARTER))).toBe(shown);
  });
});
