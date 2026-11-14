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
  // QA's second probe (14 Nov 2026): requests for a NEW form, and incident wording.
  "do you have a form for tardiness",
  "does she have to sign the form",
  "do a ca for ottilie before her shift ends",
  "give her a verbal warning before she clocks out",
  "fill out the form before she leaves",
  "i coached her before close on cleaning beds",
  "she was given a warning by the customer to stop",
  "she was told last week by the dm, need a written",
  "pls do a ca on her she was late AGAIN",
  "she was on her phone the whole shift, last shift too",
  // QA (14 Nov 2026): "already has one" with no form word in the same message stays closed.
  "she already has one",
  "she already has one, she was late again",
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
  "does she have any write ups",
  "has she been written up before?",
  "written up before.",
  "i coached her before for this",
  // QA (14 Nov 2026): the same message names a form word AND says the person already has one.
  "she already has a CA but the policy wasn't listed",
  "she already has a verbal, now do a written",
  "I need you to draw me up a a coachong document for Wrenna. She already has one but the policy was not listed",
];

describe("the past-forms gate", () => {
  it.each(CLOSED)("stays closed: %s", (question) => expect(ask(question)).toBe(false));
  it.each(OPEN)("opens: %s", (question) => expect(ask(question)).toBe(true));
  it("a short answer is read with the manager's message before it", () => {
    expect(asksAboutPastForms({ question: "yes", history: [{ id: "1", role: "user", content: "has she had any write ups", createdAt: "" } as never] })).toBe(true);
    expect(asksAboutPastForms({ question: "yes", history: [{ id: "1", role: "user", content: "she left before closing", createdAt: "" } as never] })).toBe(false);
  });
});
