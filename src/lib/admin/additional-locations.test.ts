import { describe, expect, it } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";

import {
  ADDITIONAL_LOCATION_OPTIONS,
  additionalLocationOptions,
  cleanAdditionalLocations,
  unknownAdditionalAreaIds,
} from "./additional-locations";

describe("additional location options", () => {
  it("offers every salon by stable id", () => {
    expect(ADDITIONAL_LOCATION_OPTIONS.map((o) => o.id)).toEqual(PRODUCTION_SALONS.map((s) => s.id));
    expect(ADDITIONAL_LOCATION_OPTIONS.every((o) => /^loc-\d+$/.test(o.id))).toBe(true);
  });

  it("excludes the primary salon", () => {
    const options = additionalLocationOptions("loc-0306");
    expect(options.map((o) => o.id)).not.toContain("loc-0306");
    expect(options).toHaveLength(PRODUCTION_SALONS.length - 1);
  });

  it("excludes nothing when the primary is an area", () => {
    expect(additionalLocationOptions(null)).toHaveLength(PRODUCTION_SALONS.length);
    expect(additionalLocationOptions("dist-cotton-sarah")).toHaveLength(PRODUCTION_SALONS.length);
  });
});

describe("cleanAdditionalLocations", () => {
  const salon = { level: "salon", primaryAreaId: "loc-0306" } as const;

  it("de-duplicates, drops the primary and keeps order", () => {
    expect(cleanAdditionalLocations(["loc-0394", "loc-0306", "loc-0394", "loc-0468"], salon)).toEqual([
      "loc-0394",
      "loc-0468",
    ]);
  });

  it("is empty for global", () => {
    expect(cleanAdditionalLocations(["loc-0394"], { level: "global", primaryAreaId: null })).toEqual([]);
  });

  it("ignores blanks", () => {
    expect(cleanAdditionalLocations(["", "  ", "loc-0394"], salon)).toEqual(["loc-0394"]);
  });
});

describe("unknownAdditionalAreaIds", () => {
  it("accepts rostered salons at every level", () => {
    for (const level of ["salon", "district", "region"] as const) {
      expect(unknownAdditionalAreaIds(["loc-0394"], level), level).toEqual([]);
    }
  });

  it("rejects a salon that is not on the roster, and a display name", () => {
    expect(unknownAdditionalAreaIds(["loc-9999", "MO Kansas City Liberty"], "salon")).toEqual([
      "loc-9999",
      "MO Kansas City Liberty",
    ]);
  });

  it("accepts an area only on a scope of that kind", () => {
    expect(unknownAdditionalAreaIds(["dist-cotton-sarah"], "district")).toEqual([]);
    expect(unknownAdditionalAreaIds(["dist-cotton-sarah"], "salon")).toEqual(["dist-cotton-sarah"]);
    expect(unknownAdditionalAreaIds(["reg-patterson-madeline"], "region")).toEqual([]);
    expect(unknownAdditionalAreaIds(["reg-patterson-madeline"], "district")).toEqual([
      "reg-patterson-madeline",
    ]);
  });
});
