import { describe, expect, it } from "vitest";

import { rosterSpellingOf, type RosterEmployee } from "./employee-match";
import { withCorrectedSpelling } from "./short-name";

/*
 * Port from the sibling app (its QA's live re-test, 21 Nov 2026, agent loop on): the manager typed "<First> <Lastx>" in T1
 * and corrected it to "<First> <Lasty>" in T3 ("Her name is <First> <Lasty> and she is at <salon>"); the card's name
 * followed, the account kept "<First> <Lastx>". Invented people (the pack's STAFF): Remy Calder, first typed "Remy Caldr".
 */
const person = (id: string, firstName: string, lastName: string): RosterEmployee => ({ id, firstName, lastName, preferredFirstName: null, salonIds: ["loc-0309"] });
const REMY = person("e-2", "Remy", "Calder");
const ROSTER = [person("e-1", "Marnie", "Holloway"), REMY, person("e-3", "Juno", "Paxton")];
/** The T1 account, as the model copied it onto the card. */
const ACCOUNT = "Remy Caldr was 10 minutes late on her last two shifts. On the first shift she was verbally coached on policy and expectations. Then she was late again on 10/15.";

describe("withCorrectedSpelling (the corrected name replaces the old spelling)", () => {
  it("the T1 account: the roster's close spelling of the card's person becomes the corrected name", () => {
    const out = withCorrectedSpelling(ACCOUNT, "Remy Calder", [], rosterSpellingOf(REMY.id, ROSTER));
    expect(out.text).toBe(ACCOUNT.replace("Remy Caldr", "Remy Calder"));
    expect(out.text).not.toMatch(/\bCaldr\b/);
  });
  it("the card's earlier name (its record), however far from the new one, possessive and any case", () => {
    expect(withCorrectedSpelling("remy colter was late on Remy Colter's last two shifts.", "Remy Calder", ["Remy Colter"]).text).toBe("Remy Calder was late on Remy Calder's last two shifts.");
  });
  it("never another roster person, two close people, a name in quotes, or the full name itself", () => {
    const two = [...ROSTER, person("e-9", "Remy", "Caldar")];
    expect(withCorrectedSpelling("Remy Caldar covered the shift.", "Remy Calder", [], rosterSpellingOf(REMY.id, two)).replaced).toBe(0);
    expect(withCorrectedSpelling("Remy Caldr was late.", "Remy Calder", [], rosterSpellingOf(REMY.id, two)).replaced).toBe(0);
    expect(withCorrectedSpelling('The note said "Remy Caldr was late."', "Remy Calder", [], rosterSpellingOf(REMY.id, ROSTER)).replaced).toBe(0);
    expect(withCorrectedSpelling("Remy Calder was late. Juno Paxton covered.", "Remy Calder", [], rosterSpellingOf(REMY.id, ROSTER)).replaced).toBe(0);
  });
});
