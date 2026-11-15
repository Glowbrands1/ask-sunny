import { describe, expect, it } from "vitest";

import { nameConfirmationQuestion } from "@/lib/forms/employee-match";

import { answerNamesSomeoneElse, confirmedSpellings, latestTurnConfirms, spellingsConfirmedFor } from "./confirmed-spelling";

/**
 * Fix batch item 4 (HANDOFF section 7: "Did you mean" confirmation: one consistent instruction, and accept the full
 * name typed back; c022: 4 turns, no card). Invented people: Remy Calder and Remy Caldwell are on the roster, "Remi
 * Calder" is a close spelling nobody has, Juno Paxton is someone else.
 */
const one = nameConfirmationQuestion("Remi Calder", ["Remy Calder"]);
const two = nameConfirmationQuestion("Remi Cald", ["Remy Calder", "Remy Caldwell"]);
const chat = (question: string, ...answers: string[]) => [
  { role: "user", content: "put together a coaching document for Remi Calder, she was late to her shift on 11/14" },
  { role: "assistant", content: `${question}\n\nIf so, tell me what happened.` },
  ...answers.map((content) => ({ role: "user", content })),
];

describe("a spelling the manager confirmed (item 4)", () => {
  it("the full name typed back, in any case, confirms it (c022)", () => {
    for (const answer of ["Remy Calder", "remy calder", "Remy Calder please", "its Remy Calder"]) {
      expect(confirmedSpellings(chat(one, answer)), answer).toEqual([{ answerIndex: 2, name: "Remy Calder", typed: "Remi Calder", by: "full_name" }]);
    }
  });

  it("a bare yes confirms it, as before", () => {
    expect(confirmedSpellings(chat(one, "yes"))).toEqual([{ answerIndex: 2, name: "Remy Calder", typed: "Remi Calder", by: "yes" }]);
  });

  it("with two names offered, the one typed back in full is confirmed", () => {
    expect(confirmedSpellings(chat(two, "Remy Caldwell"))).toEqual([{ answerIndex: 2, name: "Remy Caldwell", typed: "Remi Cald", by: "full_name" }]);
    // A bare yes to two names answers neither (today's readNameConfirmation).
    expect(confirmedSpellings(chat(two, "yes"))).toEqual([]);
  });

  it("a reply naming someone else, a no, a first name alone or no question confirms nobody (c137's shape)", () => {
    expect(confirmedSpellings(chat(one, "it's for Juno Paxton, she was late to her shift on 11/14"))).toEqual([]);
    expect(confirmedSpellings(chat(one, "no"))).toEqual([]);
    expect(confirmedSpellings(chat(one, "remy"))).toEqual([]);
    expect(confirmedSpellings([{ role: "assistant", content: "Who is this Coaching Form for?" }, { role: "user", content: "Remy Calder" }])).toEqual([]);
  });

  it("names the typed spelling for the confirmed person only, and knows whether the latest turn is the answer", () => {
    const answered = chat(one, "Remy Calder");
    expect(spellingsConfirmedFor(answered, ["Remy Calder"])).toEqual(["Remi Calder"]);
    expect(spellingsConfirmedFor(answered, ["Juno Paxton"])).toEqual([]);
    expect(latestTurnConfirms(answered, ["Remy Calder"])?.by).toBe("full_name");
    expect(latestTurnConfirms([...answered, { role: "assistant", content: "Here's the card." }, { role: "user", content: "thanks" }], ["Remy Calder"])).toBeNull();
  });
});

describe("a reply that names someone else is not a yes (item 3, c137)", () => {
  const roster = ["Remy Calder", "Juno Paxton", "Rowan Kestrel"];
  const remi = nameConfirmationQuestion("Remi", ["Remy Calder"]);
  const asked = (answer: string) => [
    { role: "user", content: "put together a coaching document for Remi" },
    { role: "assistant", content: `${remi}\n\nIf so, tell me what happened.` },
    { role: "user", content: answer },
  ];

  it("a pasted account about another roster person, or a name nobody has, names them", () => {
    expect(answerNamesSomeoneElse(asked("Juno Paxton was late to her shift on 11/14 and did not call ahead."), "Remy Calder", roster)).toEqual({ others: ["Juno Paxton"], typed: "Remi" });
    expect(answerNamesSomeoneElse(asked("juno paxton was late to her shift on 11/14"), "Remy Calder", roster)?.others).toEqual(["Juno Paxton"]);
    expect(answerNamesSomeoneElse(asked("Odessa Vantreight was late to her shift on 11/14"), "Remy Calder", roster)?.others).toEqual(["Odessa Vantreight"]);
  });

  it("a yes, the full name typed back, or an account naming nobody else is not caught", () => {
    expect(answerNamesSomeoneElse(asked("yes"), "Remy Calder", roster)).toBeNull();
    expect(answerNamesSomeoneElse(asked("yes, she was late on 11/14, Juno Paxton saw it"), "Remy Calder", roster)).toBeNull();
    expect(answerNamesSomeoneElse(asked("Remy Calder, she was late on 11/14"), "Remy Calder", roster)).toBeNull();
    expect(answerNamesSomeoneElse(asked("she was late to her shift on 11/14"), "Remy Calder", roster)).toBeNull();
  });

  it("only answers to this chat's own question for this person count", () => {
    expect(answerNamesSomeoneElse(asked("Juno Paxton was late"), "Rowan Kestrel", roster)).toBeNull();
    expect(answerNamesSomeoneElse([{ role: "user", content: "Juno Paxton was late" }], "Remy Calder", roster)).toBeNull();
  });
});
