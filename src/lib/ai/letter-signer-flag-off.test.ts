import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withoutLetterSigner } from "./letter-signer";

/*
 * QA's condition for the server-ask.ts lines (9 Nov 2026): with EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED off, the
 * proposal question is the manager's turn unchanged, for the six-turn exit chat (QA, 8 Nov 2026, the person invented,
 * as in nov8-field-label-not-a-question-cases.ts) and the sf-s35 CA wording (as in forms/s35-draw-me-up-ca.test.ts).
 */
const TURNS = [
  "create an exit for marnie holloway, assistant salon director at lees summit, mo. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. drop wage and forfeit bonus. not eligible for rehire. marnie's address is 48 Ne Briar Hollow Lane, lees summit, MO. 64064",
  "marnie told management on 10-26-26 that she quit effective immediately due to personal reasons.",
  "exit is for marnie holloway",
  "create exit for marnie holloway",
  "resignation date 10-26-2026. how employee resigned - Marnie told management she quit effective immediately on 10-26-2026. Reason for resignation - Marnie quit due to personal family issues.",
  "how employee resigned - told management",
] as const;
const S35 = "Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26. Wrenna has signed a coaching document for being late on 10/14/26.";

beforeEach(() => vi.stubEnv("EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED", ""));
afterEach(() => vi.unstubAllEnvs());

describe("withoutLetterSigner with EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED off", () => {
  it.each(TURNS.map((turn, index) => [index + 1, turn] as const))("the six-turn exit chat, turn %i: unchanged", (_turn, question) => {
    expect(withoutLetterSigner({ question })).toBe(question);
  });

  it("the six turns as one window: unchanged", () => {
    const question = TURNS.join("\n\n");
    expect(withoutLetterSigner({ question })).toBe(question);
  });

  it("the sf-s35 CA wording: unchanged", () => {
    expect(withoutLetterSigner({ question: S35 })).toBe(S35);
  });

  it("on, neither has a letter sign-off, so neither changes", () => {
    vi.stubEnv("EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED", "true");
    for (const question of [...TURNS, S35]) expect(withoutLetterSigner({ question })).toBe(question);
  });
});
