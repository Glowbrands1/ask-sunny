import { describe, expect, it } from "vitest";

import { ALLOWED_STORE_CODES } from "../store-codes";
import { discoverMappings, type KnownListing } from "./locations";
import type { GbpLocation } from "./types";

const listings: KnownListing[] = ALLOWED_STORE_CODES.map((storeCode) => ({
  storeCode,
  googleLocationLabel: `Sun Tan City ${storeCode}`,
  verifiedPlaceId: `ChIJplace${storeCode}0000`,
  confirmedLocationName: null,
}));

const loc = (n: number, storeCode: string | undefined, extra: Partial<GbpLocation> = {}): GbpLocation => ({
  name: `locations/${n}`,
  title: "Sun Tan City",
  storeCode,
  placeId: storeCode ? `ChIJplace${storeCode}0000` : undefined,
  ...extra,
});

describe("discoverMappings", () => {
  it("marks a location eligible only with allowlisted code, unique code and matching place id", () => {
    const { proposals } = discoverMappings([loc(1, "306")], listings);
    expect(proposals[0]).toMatchObject({ verdict: "eligible", storeCode: "306" });
  });

  it("excludes another brand in the same account — never even proposed", () => {
    const { proposals, counts } = discoverMappings(
      [loc(1, "306"), { name: "locations/2", title: "Buff City Soap - Overland Park", storeCode: "88" }, { name: "locations/3", title: "Buff City Soap" }],
      listings,
    );
    expect(proposals.filter((p) => p.verdict === "excluded_other_brand").map((p) => p.googleLocationName)).toEqual(["locations/2", "locations/3"]);
    expect(counts.eligible).toBe(1);
  });

  it("does not map a Sun Tan City title that has no usable store code — it goes to a person", () => {
    const { proposals } = discoverMappings([{ name: "locations/4", title: "Sun Tan City - New Salon" }], listings);
    expect(proposals[0].verdict).toBe("needs_review");
  });

  it("never treats a Google store code as a salon number (306 is KS Manhattan, not salon 0306)", () => {
    const { proposals } = discoverMappings([loc(1, "0306"), loc(2, "306")], listings);
    expect(proposals.find((p) => p.googleLocationName === "locations/1")?.verdict).not.toBe("eligible");
    expect(proposals.find((p) => p.googleLocationName === "locations/2")?.verdict).toBe("eligible");
  });

  it("flags duplicate store codes as conflicts rather than choosing one", () => {
    const { proposals } = discoverMappings([loc(1, "306"), loc(2, "306")], listings);
    expect(proposals.every((p) => p.verdict === "conflict")).toBe(true);
  });

  it("flags a place id that disagrees with the verified one", () => {
    const { proposals } = discoverMappings([loc(1, "306", { placeId: "ChIJsomethingElse000" })], listings);
    expect(proposals[0]).toMatchObject({ verdict: "conflict", reasons: ["place_id_differs_from_verified_place_id"] });
  });

  it("needs a person when there is no place id to corroborate", () => {
    const { proposals } = discoverMappings([loc(1, "306", { placeId: undefined })], listings);
    expect(proposals[0].verdict).toBe("needs_review");
  });

  it("reports allowlisted listings Google did not return, without guessing", () => {
    const { missing } = discoverMappings([loc(1, "306")], listings);
    expect(missing).toHaveLength(ALLOWED_STORE_CODES.length - 1);
    expect(missing.find((m) => m.storeCode === "306")).toBeUndefined();
  });

  it("recognises an existing confirmation and flags a different location", () => {
    const confirmed = listings.map((l) => (l.storeCode === "306" ? { ...l, confirmedLocationName: "locations/1" } : l));
    expect(discoverMappings([loc(1, "306")], confirmed).proposals[0].verdict).toBe("already_confirmed");
    expect(discoverMappings([loc(9, "306")], confirmed).proposals[0].verdict).toBe("conflict");
  });
});
