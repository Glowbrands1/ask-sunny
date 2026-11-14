import { describe, expect, it } from "vitest";

import { asksAboutPastForms } from "./tools";

/*
 * PAST FORMS ONLY WHEN ASKED (Pau's privacy rule; QA's review of #992, 14 Nov 2026). QA's probe sentences, their wording
 * kept and the people invented: ordinary incident wording ("before", "records", "history", "did she get a …", "last
 * time") never opens forms on file; a request that names forms or discipline on file does.
 */
const ask = (question: string) => asksAboutPastForms({ question, history: [] });

const CLOSED = [
  "she left before closing and didnt clean the beds",
  "she didnt record the lotion sales",
  "did she get a break today? she was rude to a client",
  "she said she has a history of migraines",
  "clocked in 20 min late, she was told before about being on time",
  "need a ca for wren, last time i told her no phone",
  "do a coaching for ottilie she was late tuesday",
  "her history of migraines came up again",
];

const OPEN = [
  "has she had any write ups",
  "change the date on my last CA for ottilie",
  "what's on file for wren",
  "has she been written up before",
  "had a CA before?",
  "show me her disciplinary history",
  "pull up ottilie's record",
  "same as last time",
  "open my previous coaching for wren",
];

describe("the past-forms gate", () => {
  it.each(CLOSED)("stays closed: %s", (question) => expect(ask(question)).toBe(false));
  it.each(OPEN)("opens: %s", (question) => expect(ask(question)).toBe(true));
  it("a short answer is read with the manager's message before it", () => {
    expect(asksAboutPastForms({ question: "yes", history: [{ id: "1", role: "user", content: "has she had any write ups", createdAt: "" } as never] })).toBe(true);
    expect(asksAboutPastForms({ question: "yes", history: [{ id: "1", role: "user", content: "she left before closing", createdAt: "" } as never] })).toBe(false);
  });
});
