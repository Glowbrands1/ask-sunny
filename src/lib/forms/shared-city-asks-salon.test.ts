import { afterEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";

import { readSalonMentions } from "./salon-mention";

/*
 * SHARED_CITY_ASKS_SALON (QA's Sunny 38c live check, 13 Nov 2026): "create a ca for <A> at omha, she was late" read no
 * salon. A shared city typed a letter off is a mention of every salon in that city, as the city spelled right is.
 */
afterEach(() => vi.unstubAllEnvs());

const OMAHA = PRODUCTION_SALONS.filter((salon) => salon.name.startsWith("NE Omaha ")).map((salon) => salon.id).sort();
const salons = (text: string) => readSalonMentions(text).map((mention) => [...mention.salonIds].sort());

describe("SHARED_CITY_ASKS_SALON: a shared city a letter off", () => {
  it("flag off: \"at omha\" is no place (as on main); \"at omaha\" is every Omaha salon", () => {
    vi.stubEnv("SHARED_CITY_ASKS_SALON_ENABLED", "");
    expect(salons("create a ca for avery at omha, she was late")).toEqual([]);
    expect(salons("create a ca for avery at omaha, she was late")).toEqual([OMAHA]);
  });

  it("flag on: \"at omha\" and \"in omahaa\" are every Omaha salon", () => {
    vi.stubEnv("SHARED_CITY_ASKS_SALON_ENABLED", "true");
    expect(salons("create a ca for avery at omha, she was late")).toEqual([OMAHA]);
    expect(salons("she was late in omahaa today")).toEqual([OMAHA]);
  });

  it("flag on: no cue, or a city word two letters off, is no place", () => {
    vi.stubEnv("SHARED_CITY_ASKS_SALON_ENABLED", "true");
    expect(salons("create a ca for avery, omha, she was late")).toEqual([]);
    expect(salons("create a ca for avery at oma, she was late")).toEqual([]);
  });
});
