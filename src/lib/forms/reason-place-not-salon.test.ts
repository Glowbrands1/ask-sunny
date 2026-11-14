import { afterEach, describe, expect, it, vi } from "vitest";

import { placeReadingText } from "./reason-place";
import { readSalonMentions } from "./salon-mention";

/* REASON_PLACE_NOT_STORE (ported from the sibling app, 13 Nov 2026). Invented wording. */
afterEach(() => vi.unstubAllEnvs());

const ids = (text: string) => readSalonMentions(text).flatMap((mention) => mention.salonIds);

describe("REASON_PLACE_NOT_STORE", () => {
  it("off: placeReadingText returns its input unchanged (QA's condition for the salon-mention.ts edit)", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "");
    for (const said of [
      "she was late because she was at grand island",
      "create a ca for marnie holloway at grand island, she was late because she was at the dentist",
      "",
    ]) {
      expect(placeReadingText(said)).toBe(said);
    }
  });

  it("on: placeReadingText blanks only the reason's place, keeping every other offset", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    const said = "she was late because she was at grand island, then she left";
    const read = placeReadingText(said);
    expect(read).toHaveLength(said.length);
    expect(read).toBe("she was late because she was                , then she left");
  });

  it("off: the reason's place is read as a salon (as on main)", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "");
    expect(ids("she was late because she was at grand island")).toEqual(["loc-0307"]);
  });

  it("on: a place in a because-clause is not a salon", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    expect(ids("she was late because she was at grand island")).toEqual([]);
  });

  it("on: the same reason said another way (the sibling gate's probes)", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    for (const why of ["bc", "b/c", "cause", "'cause", "cuz", "since"]) {
      expect(ids(`she was late ${why} she was at grand island`), why).toEqual([]);
    }
  });

  it("on: \"since\" as a time word leaves the salon to be read (QA, 14 Nov 2026)", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    expect(ids("since 11/3 she has been late at grand island")).toEqual(["loc-0307"]);
    expect(ids("she's been late at grand island since monday")).toEqual(["loc-0307"]);
  });

  it("on: a salon said as the salon is still read", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    expect(ids("she was late at grand island")).toEqual(["loc-0307"]);
    expect(ids("at grand island, she was late because she was at the dentist")).toEqual(["loc-0307"]);
  });
});
