import { afterEach, describe, expect, it, vi } from "vitest";

import { readSalonMentions } from "./salon-mention";

/* REASON_PLACE_NOT_STORE (ported from the sibling app, 13 Nov 2026). Invented wording. */
afterEach(() => vi.unstubAllEnvs());

const ids = (text: string) => readSalonMentions(text).flatMap((mention) => mention.salonIds);

describe("REASON_PLACE_NOT_STORE", () => {
  it("off: the reason's place is read as a salon (as on main)", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "");
    expect(ids("she was late because she was at grand island")).toEqual(["loc-0307"]);
  });

  it("on: a place in a because-clause is not a salon", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    expect(ids("she was late because she was at grand island")).toEqual([]);
  });

  it("on: a salon said as the salon is still read", () => {
    vi.stubEnv("REASON_PLACE_NOT_STORE_ENABLED", "true");
    expect(ids("she was late at grand island")).toEqual(["loc-0307"]);
    expect(ids("at grand island, she was late because she was at the dentist")).toEqual(["loc-0307"]);
  });
});
