import { describe, expect, it } from "vitest";

import { titleSaidFor } from "./tools";

/* QA (16 Nov 2026, c219): a title belongs to the name it is attached to, by the name reader (invented names). */
describe("titleSaidFor", () => {
  const roster = ["Remy Calder", "Juno Paxton"];
  it("never takes another person's title as this person's", () => {
    expect(titleSaidFor("Remy Calder, this meeting is about the text you sent your salon director Juno Paxton on 11/3.", "Remy Calder", roster)).toBeNull();
    expect(titleSaidFor("Test Testi was rude to Juno Paxton, the salon director, on 11/3.", "Test Testi", roster)).toBeNull();
  });
  it("keeps a title said for this person, or with no name beside it", () => {
    expect(titleSaidFor("Remy Calder, our salon director, sent a rude text.", "Remy Calder", roster)).toBe("Salon Director");
    expect(titleSaidFor("She is a salon director and missed the meeting.", "Remy Calder", roster)).toBe("Salon Director");
  });
});
