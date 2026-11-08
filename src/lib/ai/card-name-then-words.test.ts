import { afterEach, describe, expect, it, vi } from "vitest";

import type { RosterEmployee } from "@/lib/forms/employee-match";

import { readingIsCardThenVerb, rosterPersonThenVerb, withCardNameThenWords } from "./card-name-then-words";
import type { AskResponse } from "./types";

/** CARD_NAME_THEN_WORDS_CURRENT_ENABLED (QA's sf-s38, 8 Nov 2026). Invented people. */
const person = (firstName: string, lastName: string) => ({ id: `e-${firstName}`, firstName, lastName, salonIds: [], locationIds: [] }) as unknown as RosterEmployee;
const ROSTER = [person("Rowan", "Kestrel"), person("Marnie", "Holloway")];
const T1 = "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rosterPersonThenVerb", () => {
  it.each([
    ["Rowan Kestrel missing", T1],
    ["Rowan Kestrel Missing", "make me a CA for rowan kestrel missing her shift on 11/7"],
    ["Rowan Kestrel failing", "make me a CA for Rowan Kestrel failing to show up for her saturday shift"],
    ["Rowan Kestrel never", "a CA for Rowan Kestrel never calling in"],
  ])("%s (typed: %s) → Rowan Kestrel", (read, typed) => {
    expect(rosterPersonThenVerb(read, ROSTER, typed)).toBe("Rowan Kestrel");
  });

  it.each([
    ["a capitalised surname after the name", "Rowan Kestrel Manning", "a CA for Rowan Kestrel Manning missing her shift"],
    ["a lower-case word that is no verb shape", "Rowan Kestrel Ashby", "a CA for rowan kestrel ashby on 11/7"],
    ["an -ing surname typed capitalised", "Rowan Kestrel Fielding", "a CA for Rowan Kestrel Fielding"],
    ["nobody on the roster", "Tamsin Oddway missing", "a CA for Tamsin Oddway missing her shift"],
    ["the name alone", "Rowan Kestrel", "a CA for Rowan Kestrel"],
  ])("%s: still checked (null)", (_why, read, typed) => {
    expect(rosterPersonThenVerb(read, ROSTER, typed)).toBeNull();
  });
});

describe("readingIsCardThenVerb (the Create check)", () => {
  it("off: false", () => {
    expect(readingIsCardThenVerb("Rowan Kestrel missing", "Rowan Kestrel", T1)).toBe(false);
  });
  it("on: the card's name then a verb shape typed in lower case; a capitalised surname is still another name", () => {
    vi.stubEnv("CARD_NAME_THEN_WORDS_CURRENT_ENABLED", "true");
    expect(readingIsCardThenVerb("Rowan Kestrel missing", "Rowan Kestrel", T1)).toBe(true);
    expect(readingIsCardThenVerb("Rowan Kestrel Manning", "Rowan Kestrel", "a CA for Rowan Kestrel Manning missing her shift")).toBe(false);
  });
});

describe("withCardNameThenWords", () => {
  const reply = () =>
    ({
      content: "I'll draft a **Corrective Action Form** for **Rowan Kestrel Missing** from what you've described.",
      citations: [],
      formProposal: { templateKey: "dpoa", employeeName: "Rowan Kestrel Missing" },
    }) as unknown as AskResponse;
  const typed = "make me a CA for rowan kestrel missing her shift on 11/7";

  it("off: unchanged", async () => {
    const built = reply();
    expect(await withCardNameThenWords(built, typed, async () => ROSTER)).toBe(built);
  });
  it("on: the card and the reply name the roster person", async () => {
    vi.stubEnv("CARD_NAME_THEN_WORDS_CURRENT_ENABLED", "true");
    const out = await withCardNameThenWords(reply(), typed, async () => ROSTER);
    expect(out.formProposal?.employeeName).toBe("Rowan Kestrel");
    expect(out.content).toContain("for **Rowan Kestrel** from");
  });
});
