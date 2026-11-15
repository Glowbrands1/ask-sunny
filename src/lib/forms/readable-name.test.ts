import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rosterMatches } from "@/lib/ai/agent-loop/tools";
import { displayTypedName } from "@/lib/ai/roster-reply";
import { displayName, matchEmployeeName, type RosterEmployee } from "./employee-match";
import { extractEmployeeNames, tidyTypedName } from "./proposal";
import { readableName, squashedName, squashedSpellingMatches } from "./readable-name";
import { offRosterTyped } from "./roster-only-names";
import { cleanPersonName } from "./roster-validated-name";

/**
 * READABLE_NAMES_ENABLED (Pau via QA, 15 Nov 2026: "all naming conventions should be readable; some have de la Torre
 * etc."). Every name here is invented.
 */

describe("readableName: case and spacing only, never a letter", () => {
  it.each([
    ["maria de la torre", "Maria de la Torre"],
    ["MARIA DE LA TORRE", "Maria de la Torre"],
    ["  maria   de la  torre ", "Maria de la Torre"],
    ["joaquin de los santos", "Joaquin de los Santos"],
    ["pieter van der berg", "Pieter van der Berg"],
    ["klaus von linden", "Klaus von Linden"],
    ["lucia del valle", "Lucia del Valle"],
    ["paolo di stefano", "Paolo di Stefano"],
    ["ana da silva", "Ana da Silva"],
    ["rui dos anjos", "Rui dos Anjos"],
    ["claire du pont", "Claire du Pont"],
    ["emile le brun", "Emile le Brun"],
    ["ian mcdonald", "Ian McDonald"],
    ["iona macdonald", "Iona MacDonald"],
    ["keira o'brien", "Keira O'Brien"],
    ["nico d'angelo", "Nico D'Angelo"],
    ["tessa smith-jones", "Tessa Smith-Jones"],
    ["josé peña", "José Peña"],
    ["JOSÉ PEÑA", "José Peña"],
    ["marcus webb jr", "Marcus Webb Jr."],
    ["marcus webb sr.", "Marcus Webb Sr."],
    ["henry ashford iii", "Henry Ashford III"],
    ["de la cruz", "De la Cruz"],
  ])("%s → %s", (typed, readable) => {
    expect(readableName(typed)).toBe(readable);
  });

  it.each([
    ["LaToya Brennick", "LaToya Brennick"],
    ["DeShawn Corley", "DeShawn Corley"],
    ["Macy Thornbury", "Macy Thornbury"],
    ["macy thornbury", "Macy Thornbury"],
    ["Maria De La Torre", "Maria De La Torre"],
  ])("a word with its own case is the person's spelling: %s", (typed, readable) => {
    expect(readableName(typed)).toBe(readable);
  });

  it("never changes a letter", () => {
    for (const typed of ["maria de la torre", "keira o'brien", "josé peña", "tessa smith-jones", "ian mcdonald"]) {
      expect(readableName(typed).toLowerCase()).toBe(typed.toLowerCase());
    }
  });

  it("the matching key ignores case, accents, spaces, hyphens and apostrophes", () => {
    expect(squashedName("de la Torre")).toBe("delatorre");
    expect(squashedName("O'Brien")).toBe("obrien");
    expect(squashedName("Peña")).toBe("pena");
  });
});

const ROSTER: RosterEmployee[] = [
  { id: "e-mdlt", firstName: "Maria", lastName: "de la Torre", salonIds: ["loc-0309"] },
  { id: "e-imcd", firstName: "Ian", lastName: "McDonald", salonIds: ["loc-0309"] },
  { id: "e-kob", firstName: "Keira", lastName: "O'Brien", salonIds: ["loc-0309"] },
  { id: "e-other", firstName: "Tessa", lastName: "Holloway", salonIds: ["loc-0309"] },
];

describe("READABLE_NAMES_ENABLED on", () => {
  beforeEach(() => {
    vi.stubEnv("READABLE_NAMES_ENABLED", "true");
    vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["create a ca for maria de la torre, she was late", "maria de la torre"],
    ["create a ca for jacinta van der berg, she was late on 11/12", "jacinta van der berg"],
    ["create a ca for Maria de la Torre, she was late", "Maria de la Torre"],
    ["maria de la torre", "maria de la torre"],
    ["ca for lucia del valle, late", "lucia del valle"],
    ["ca for keira o'brien, late", "keira o'brien"],
  ])("a particle is part of the name, never its end: %s", (said, name) => {
    expect(extractEmployeeNames(said)).toEqual([name]);
  });

  it("a typed name goes on the card readable (tidyTypedName)", () => {
    expect(tidyTypedName("maria de la torre")).toBe("Maria de la Torre");
    expect(tidyTypedName("keira o'brien")).toBe("Keira O'Brien");
  });

  it("an all-caps or all-lowercase roster row is shown readable; a mixed-case one as Woven has it", () => {
    expect(displayName({ id: "x", firstName: "MARIA", lastName: "DE LA TORRE", salonIds: [] })).toBe("Maria de la Torre");
    expect(displayName({ id: "x", firstName: "ian", lastName: "mcdonald", salonIds: [] })).toBe("Ian McDonald");
    expect(displayName({ id: "x", firstName: "Maria", lastName: "De La Torre", salonIds: [] })).toBe("Maria De La Torre");
  });

  it.each([
    ["maria de la torre", "Maria de la Torre"],
    ["Maria De La Torre", "Maria de la Torre"],
    ["maria delatorre", "Maria de la Torre"],
    ["maria dela torre", "Maria de la Torre"],
    ["ian mcdonald", "Ian McDonald"],
    ["keira obrien", "Keira O'Brien"],
    ["keira o'brien", "Keira O'Brien"],
  ])("matchEmployeeName: %s is the roster's %s", (typed, roster) => {
    const found = matchEmployeeName(typed, ROSTER);
    expect(found.kind, JSON.stringify(found)).toBe("exact");
    expect(found.kind === "exact" ? found.name : "").toBe(roster);
  });

  it.each([
    ["maria de la tore", "Maria de la Torre"],
    ["maria delatore", "Maria de la Torre"],
    ["keira obrian", "Keira O'Brien"],
  ])("matchEmployeeName: a typo %s is one close match, %s", (typed, roster) => {
    const found = matchEmployeeName(typed, ROSTER);
    expect(found.kind, JSON.stringify(found)).toBe("confirm");
    expect(found.kind === "confirm" ? found.candidates.map((candidate) => candidate.name) : []).toEqual([roster]);
  });

  it.each([
    ["maria de la torre", "e-mdlt"],
    ["maria delatorre", "e-mdlt"],
    ["Maria dela torre", "e-mdlt"],
    ["delatorre", "e-mdlt"],
    ["ian mcdonald", "e-imcd"],
    ["keira obrien", "e-kob"],
    ["obrien", "e-kob"],
    ["keira o'brien", "e-kob"],
  ])("the loop's rosterMatches: %s finds the roster person", (typed, id) => {
    expect(rosterMatches(typed, ROSTER).map((person) => person.id)).toEqual([id]);
  });

  it("the squashed check is exact: another person's name is not a match", () => {
    expect(squashedSpellingMatches("maria holloway", ROSTER[0]!)).toBe(false);
    expect(rosterMatches("tessa delatorre", ROSTER)).toEqual([]);
  });
});

describe("READABLE_NAMES_ENABLED on: the off-roster name, as printed and as offered", () => {
  beforeEach(() => vi.stubEnv("READABLE_NAMES_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ["jacinta van der berg", "Jacinta van der Berg"],
    ["ian mcdonald", "Ian McDonald"],
    ["keira o'brien", "Keira O'Brien"],
    ["LaToya de la cruz", "LaToya de la Cruz"],
  ])("%s prints %s", (typed, shown) => {
    expect(displayTypedName(typed)).toBe(shown);
    expect(cleanPersonName(typed, [])).toBe(shown);
  });
  // QA, 15 Nov 2026 (reversing part of the review's finding 9): a two-letter all-caps word that is no particle is
  // initials and stays upper case.
  it("initials typed in capitals are kept", () => {
    expect(cleanPersonName("JT holloway", [])).toBe("JT Holloway");
  });
  it("a name with particles is still a name's shape, and is offered readable", () => {
    expect(offRosterTyped("Jacinta van der Berg", "use jacinta van der berg", [])).toBe("Jacinta van der Berg");
    expect(offRosterTyped("jacinta van der berg", "create a ca for jacinta van der berg, she was late", [])).toBe("Jacinta van der Berg");
    // Changed on purpose (QA's review of #1013, finding 5): the last word is the surname, never a particle, so "jacinta
    // van der" is a three-word name ("Jacinta van Der"), not a cut one.
    expect(offRosterTyped("Jacinta van der", "use jacinta van der", [])).toBe("Jacinta van Der");
  });
});

describe("READABLE_NAMES_ENABLED off: as before", () => {
  beforeEach(() => vi.stubEnv("ROSTER_COMPOUND_SURNAME_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());
  it("the typed name is kept as typed, and the squashed spellings are not matched", () => {
    expect(tidyTypedName("maria de la torre")).toBe("maria de la torre");
    expect(displayName({ id: "x", firstName: "MARIA", lastName: "DE LA TORRE", salonIds: [] })).toBe("MARIA DE LA TORRE");
    expect(matchEmployeeName("maria delatorre", ROSTER).kind).not.toBe("exact");
    expect(rosterMatches("keira obrien", ROSTER)).toEqual([]);
    expect(displayTypedName("jacinta van der berg")).toBe("Jacinta Van Der Berg");
    expect(offRosterTyped("Jacinta Van Der Berg", "use jacinta van der berg", [])).toBeNull();
    // The bug Pau saw: the name was cut at its particles.
    expect(extractEmployeeNames("create a ca for maria de la torre, she was late")).toEqual(["maria de"]);
    expect(extractEmployeeNames("create a ca for jacinta van der berg, she was late on 11/12")).toEqual(["jacinta van"]);
  });
});

describe("QA, 15 Nov 2026: two-letter initials (no vowel, or AJ/JJ/EJ) stay upper case; Al/Ed/Jo/Bo/Ty are names; a two-letter particle as the last word is the surname", () => {
  it.each([
    ["JT holloway", "JT Holloway"],
    ["AJ fairweather", "AJ Fairweather"],
    ["DJ de la torre", "DJ de la Torre"],
    ["jt holloway", "JT Holloway"],
    ["KC FAIRWEATHER", "KC Fairweather"],
    ["AL SMITH", "Al Smith"],
    ["ED SMITH", "Ed Smith"],
    ["JO SMITH", "Jo Smith"],
    ["BO SMITH", "Bo Smith"],
    ["TY SMITH", "Ty Smith"],
    // QA's re-review: the last word is the surname, never initials.
    ["kim ng", "Kim Ng"],
    ["KIM NG", "Kim Ng"],
    ["THANH LE", "Thanh Le"],
    ["kim DU", "Kim Du"],
    ["maria DE la torre", "Maria de la Torre"],
  ])("%s → %s", (typed, shown) => {
    expect(readableName(typed)).toBe(shown);
  });
});
