import { describe, expect, it } from "vitest";

import { nameConfirmationQuestion } from "@/lib/forms/employee-match";

import { confirmedSpellings, latestTurnConfirms, spellingsConfirmedFor } from "./confirmed-spelling";

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
