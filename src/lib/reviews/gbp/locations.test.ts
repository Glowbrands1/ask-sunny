import { describe, expect, it } from "vitest";

import { ALLOWED_STORE_CODES } from "../store-codes";
import { addressAgrees, discoverMappings, isOtherBrandTitle, normalizeAddressText, type KnownListing } from "./locations";
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

  it("blocks another brand by TITLE first, even when its store code equals one of ours", () => {
    const { proposals } = discoverMappings([{ name: "locations/5", title: "Buff City Soap - Lee's Summit", storeCode: "306", placeId: "ChIJplace3060000" }], listings);
    expect(proposals[0]).toMatchObject({ verdict: "excluded_other_brand", reasons: ["title_names_another_brand"] });
    expect(isOtherBrandTitle("BUFF CITY SOAP")).toBe(true);
    expect(isOtherBrandTitle("Sun Tan City - KS Manhattan")).toBe(false);
  });

  describe("address corroboration (Ask Bubbles' rule)", () => {
    const withAddress = (over: Partial<KnownListing> = {}): KnownListing[] =>
      listings.map((l) => (l.storeCode === "306" ? { ...l, verifiedPlaceId: null, expectedAddress: { street: "1101 N 3rd St", city: "Manhattan", state: "KS", postalCode: "66502" }, ...over } : l));
    const at = (over: Record<string, unknown> = {}): GbpLocation => ({
      name: "locations/9", title: "Sun Tan City", storeCode: "306", placeId: undefined,
      address: { addressLines: ["1101 North 3rd Street"], locality: "Manhattan", administrativeArea: "KS", postalCode: "66502-1234", ...over },
    });

    it("is eligible on store code + matching street/city/state/ZIP even without a place id", () => {
      expect(discoverMappings([at()], withAddress()).proposals[0].verdict).toBe("eligible");
    });
    it("is a CONFLICT when both sides state an address and they differ", () => {
      expect(discoverMappings([at({ postalCode: "99999" })], withAddress()).proposals[0]).toMatchObject({ verdict: "conflict", reasons: ["address_differs_from_roster"] });
    });
    it("needs a person when Google gives no address and no place id to corroborate", () => {
      const noAddress = { ...at(), address: undefined };
      expect(discoverMappings([noAddress], withAddress()).proposals[0].verdict).toBe("needs_review");
    });
    it("normalises street words and treats missing data as disagreement", () => {
      expect(normalizeAddressText("1101 North 3rd Street, Suite 4")).toBe("1101 n 3rd st ste 4");
      expect(addressAgrees(null, at())).toBe(false);
      expect(addressAgrees({ street: "1101 N 3rd St", city: "Manhattan", state: "KS", postalCode: "66502" }, { ...at(), address: undefined })).toBe(false);
    });
  });
});
