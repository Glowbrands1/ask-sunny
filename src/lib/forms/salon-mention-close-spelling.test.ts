import { afterEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";

import { readSalonMentions } from "./salon-mention";

/*
 * CLOSE_SPELLING_MATCH (Pau via QA, 13 Nov 2026): "Match the manager's words against our own lists instead of exact
 * spellings, for names, stores/salons and policy titles. Allow close spellings … Ask "Did you mean …?" when there is
 * more than one possible match, or when the match isn't confident." Invented wording.
 */
afterEach(() => vi.unstubAllEnvs());

const id = (name: string) => PRODUCTION_SALONS.find((salon) => salon.name === name)!.id;
const salons = (text: string) => readSalonMentions(text).map((mention) => [...mention.salonIds].sort());

describe("salon mentions: close spellings", () => {
  it("flag off: a salon a letter off is not read (as on main)", () => {
    expect(salons("coaching for avery at kearny today")).toEqual([]);
    expect(salons("ca for avery at grand islnd, she was late")).toEqual([]);
  });

  it("flag on: one word a letter off, cued, is that salon", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(salons("coaching for avery at kearny today")).toEqual([[id("NE Kearney")]]);
    expect(salons("ca for avery at grand islnd, she was late")).toEqual([[id("NE Grand Island")]]);
    expect(salons("ca for avery, the lawrnce salon")).toEqual([[id("KS Lawrence")]]);
    expect(salons("ne kearny")).toEqual([[id("NE Kearney")]]);
  });

  it("flag on: a short name a letter off still needs its cue", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(salons("ca for lawrnce, she was late")).toEqual([]);
    expect(salons("kearny was late today")).toEqual([]);
  });

  it("flag on: two words off is not confident — no salon", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(salons("ca for avery at grnd islnd today")).toEqual([]);
  });

  it("flag on: a salon spelled right is read exactly as before", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(salons("coaching for avery at kearney today")).toEqual([[id("NE Kearney")]]);
  });
});

describe("salon mentions: close spellings anywhere in the sentence", () => {
  it("flag on: a salon of two words a letter off is read wherever its words fall", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    // Word runs overlap: "rowan kestrel at grand islnd" is read at "grand", whatever comes before it.
    expect(salons("create a ca for rowan kestrel at grand islnd, he was late today")).toEqual([[id("NE Grand Island")]]);
    expect(salons("create a ca for rowan at grand islnd, he was late today")).toEqual([[id("NE Grand Island")]]);
  });
});
