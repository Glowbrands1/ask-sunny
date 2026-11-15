import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { RosterEmployee } from "@/lib/forms/employee-match";
import type { ChatMessage } from "@/types";

import { personKey, type NameQuestionRecord } from "./card-record";
import { answerNamesSomeoneElse, answeredNameQuestions, isConfirmedSpelling, latestTurnConfirms, spellingKeysConfirmedFor, type NameQuestionView } from "./confirmed-spelling";

/**
 * Fix batch items 4 and 3 (HANDOFF section 7). What was asked comes from the server's name question record, never the
 * reply's text (QA's review of #1051): every reply below is a paraphrase, and it changes nothing. Invented people: Remy
 * Calder, Remy Caldwell, Juno Paxton and Rowan Kestrel are on the roster; "Remi Calder" and "Remi" are nobody.
 */
const person = (id: string, firstName: string, lastName: string): RosterEmployee => ({ id, firstName, lastName, preferredFirstName: null, salonIds: ["loc-0309"] }) as unknown as RosterEmployee;
const ROSTER = [person("e-2", "Remy", "Calder"), person("e-6", "Remy", "Caldwell"), person("e-3", "Juno", "Paxton"), person("e-4", "Rowan", "Kestrel")];

const asked = (offered: string[], typed: string): NameQuestionRecord => ({ offeredKeys: offered.map(personKey), typedKey: personKey(typed), messageId: "m-1" });

/** The manager's first message (m-1), the loop's reply (a paraphrase), then the answers: the last one is being answered now. */
function view(record: NameQuestionRecord, ...answers: string[]): NameQuestionView {
  const history = [
    { id: "m-1", role: "user", content: "put together a coaching document for Remi Calder, she was late to her shift on 11/14" },
    { id: "a-1", role: "assistant", content: "Is that Remy Calder? Tell me what happened if so." },
    ...answers.slice(0, -1).flatMap((content, at) => [
      { id: `m-${at + 2}`, role: "user", content },
      { id: `a-${at + 2}`, role: "assistant", content: "Here's the card." },
    ]),
  ] as ChatMessage[];
  return { history, question: answers.at(-1)!, records: [record], roster: ROSTER };
}

const one = asked(["e-2"], "Remi Calder");
const two = asked(["e-2", "e-6"], "Remi Cald");

describe("the answer to a recorded Did-you-mean (item 4)", () => {
  it("the full name typed back, in any case, confirms the offered person, whatever the reply said (c022)", () => {
    for (const answer of ["Remy Calder", "remy calder", "Remy Calder please", "its Remy Calder"]) {
      const [found] = answeredNameQuestions(view(one, answer));
      expect(found?.confirmed?.id, answer).toBe("e-2");
      expect(found?.by).toBe("full_name");
      expect(found?.latest).toBe(true);
    }
  });

  it("a bare yes confirms one offered person, as before", () => {
    expect(latestTurnConfirms(view(one, "yes"), "e-2")?.by).toBe("yes");
  });

  it("with two people offered, the one typed back in full is confirmed; a bare yes confirms neither", () => {
    expect(latestTurnConfirms(view(two, "Remy Caldwell"), "e-6")?.by).toBe("full_name");
    expect(answeredNameQuestions(view(two, "yes"))[0]?.confirmed).toBeNull();
  });

  it("a reply naming someone else, a no or a first name alone confirms nobody; no record, no question", () => {
    for (const answer of ["it's for Juno Paxton, she was late to her shift on 11/14", "no", "remy"]) {
      expect(answeredNameQuestions(view(one, answer))[0]?.confirmed, answer).toBeNull();
    }
    expect(answeredNameQuestions({ ...view(one, "Remy Calder"), records: [] })).toEqual([]);
  });

  it("the typed spelling is this person's once confirmed, and only the answer being given now is latest", () => {
    const keys = spellingKeysConfirmedFor(view(one, "Remy Calder"), "e-2");
    expect(isConfirmedSpelling("Remi Calder", keys)).toBe(true);
    expect(isConfirmedSpelling("remi  calder", keys)).toBe(true);
    expect(isConfirmedSpelling("Juno Paxton", keys)).toBe(false);
    expect(spellingKeysConfirmedFor(view(one, "Remy Calder"), "e-3")).toEqual([]);
    expect(latestTurnConfirms(view(one, "Remy Calder", "thanks"), "e-2")).toBeNull();
    expect(spellingKeysConfirmedFor(view(one, "Remy Calder", "thanks"), "e-2")).toHaveLength(1);
  });
});

describe("a reply that names someone else is not a yes (item 3, c137)", () => {
  const remi = asked(["e-2"], "Remi");

  it("a pasted account about another roster person, or a name nobody has, names them", () => {
    expect(answerNamesSomeoneElse(view(remi, "Juno Paxton was late to her shift on 11/14 and did not call ahead."), "e-2")).toEqual({ others: ["Juno Paxton"] });
    expect(answerNamesSomeoneElse(view(remi, "juno paxton was late to her shift on 11/14"), "e-2")?.others).toEqual(["Juno Paxton"]);
    expect(answerNamesSomeoneElse(view(remi, "Odessa Vantreight was late to her shift on 11/14"), "e-2")?.others).toEqual(["Odessa Vantreight"]);
  });

  it("a yes, a yes with a witness, the full name typed back, or an account naming nobody else is not caught", () => {
    for (const answer of ["yes", "yes, she was late on 11/14, Juno Paxton saw it", "Remy Calder, she was late on 11/14", "she was late to her shift on 11/14"]) {
      expect(answerNamesSomeoneElse(view(remi, answer), "e-2"), answer).toBeNull();
    }
  });

  it("only an answer, now, to a question that offered this person counts", () => {
    expect(answerNamesSomeoneElse(view(remi, "Juno Paxton was late"), "e-4")).toBeNull();
    expect(answerNamesSomeoneElse(view(remi, "Juno Paxton was late", "and Rowan Kestrel too"), "e-2")).toBeNull();
  });
});
