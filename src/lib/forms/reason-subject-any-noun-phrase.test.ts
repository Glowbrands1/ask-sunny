import { afterEach, describe, expect, it, vi } from "vitest";

import { readSalonMentions } from "./salon-mention";

/* REASON_SUBJECT_ANY_NOUN_PHRASE (Gate-Sunny's #975 follow-up, QA 14 Nov 2026). Invented wording besides QA's. */
afterEach(() => vi.unstubAllEnvs());

const read = (text: string) => readSalonMentions(text).flatMap((mention) => mention.salonIds).length > 0;
const on = (wide: boolean) => {
  vi.stubEnv("REASON_PLACE_NOT_SALON_ENABLED", "true");
  vi.stubEnv("REASON_SUBJECT_ANY_NOUN_PHRASE_ENABLED", wide ? "true" : "");
};

const REASONS = [
  "she left early because her kid was sick in lincoln",
  "she was late because her car broke down in kearney",
  "she left early because her son got hurt at kearney",
  "she was late bc her mom was stuck in grand island",
  // Gate-Sunny's probe of #989 (14 Nov 2026).
  "she was late because she was stuck in kearney",
  "she left early because she had to be in grand island",
];

describe("REASON_SUBJECT_ANY_NOUN_PHRASE", () => {
  it("off: a noun-phrase reason's place is read as a salon (as on main)", () => {
    on(false);
    for (const said of REASONS) expect(read(said), said).toBe(true);
  });

  it("on: a noun-phrase reason's place is not a salon", () => {
    on(true);
    for (const said of REASONS) expect(read(said), said).toBe(false);
  });

  it("on: a salon said as the salon, or where she was late, is still read", () => {
    on(true);
    for (const said of [
      "at kearney, she was late because her kid was sick",
      "she was late at kearney",
      "she was written up because she was late at kearney",
      "she was late because she was working at kearney",
      "she was late because she went to work in kearney",
      "since 11/3 she has been late at kearney",
      // "had to be" outside a "because" reason (this reader never reads "at kearney by 9", even on main).
      "she had to be at kearney and was late",
    ]) {
      expect(read(said), said).toBe(true);
    }
  });
});
