import { describe, expect, it } from "vitest";
import { turnsFromThisPersonsRequest } from "./this-persons-turns";

// Names invented. A stand-in reader: "for <First Last>" or "<First Last> …" at the start.
const names = (text: string) => [...text.matchAll(/\b(Marnie Holloway|Remy Calder|marnie holloway|remy calder)\b/g)].map((match) => match[1]!);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const read = { names, same };
function context(...turns: string[]) {
  const messages = turns.map((content, index) => ({ id: `m${index + 1}`, content }));
  return { messages, ids: messages.map((turn) => turn.id) };
}

describe("turnsFromThisPersonsRequest", () => {
  it("drops an earlier person's request and the details that followed it (live check B2)", () => {
    const turns = context(
      "create a coaching form for Marnie Holloway",
      "this is what i am wanting to coach on: getting rooms ready between guests",
      "create a coaching form for remy calder",
    );
    expect(turnsFromThisPersonsRequest(turns, "Remy Calder", read)).toEqual(["m3"]);
  });

  it("keeps the request that named nobody before the answer that named this person", () => {
    const turns = context("create a coaching form", "remy calder", "he was late on 10/20");
    expect(turnsFromThisPersonsRequest(turns, "Remy Calder", read)).toEqual(["m1", "m2", "m3"]);
  });

  it("keeps everything in a conversation that never names anybody else", () => {
    const turns = context("he keeps leaving rooms unready", "create a coaching form for remy calder");
    expect(turnsFromThisPersonsRequest(turns, "Remy Calder", read)).toEqual(["m1", "m2"]);
  });

  it("keeps every turn when no turn names this person, or no person is known", () => {
    const turns = context("create a coaching form for Marnie Holloway", "she was late");
    expect(turnsFromThisPersonsRequest(turns, "Remy Calder", read)).toEqual(["m1", "m2"]);
    expect(turnsFromThisPersonsRequest(turns, null, read)).toEqual(["m1", "m2"]);
  });
});
