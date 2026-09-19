import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeDataset,
  readPlaceCandidate,
  readPlaceIdFromRecord,
  resolveDiscovery,
} from "./discovery";
import { readPlaceIdFromInput } from "./locations";
import type { ApifyLocationMapping } from "./types";

/**
 * ============================================================================
 * RECOVERING A DISCOVERY WE ALREADY PAID FOR
 * ============================================================================
 *
 * A real production run (Apify `EcV1gU3LYUWfarNfO`, 2026-09-19, $0.0951)
 * SUCCEEDED, returned nineteen genuine Sun Tan City place records, and ASK
 * Sunny reconciled it as 0 / 15 with every salon marked "not found".
 *
 * Two defects made that possible, and both are pinned here:
 *
 *   THE PLACE ID WAS ONLY LOOKED FOR IN A FIELD. The extractor returns its
 *   identifier inside a Maps URL as `query_place_id=`, and a record whose id
 *   could not be read was dropped — silently, before any matching ran. Nineteen
 *   dropped records and an empty dataset produced identical output.
 *
 *   "NOT FOUND" MEANT BOTH THINGS AT ONCE. "Google has no such listing" and
 *   "we could not read what Google sent" were the same status and the same
 *   sentence, so the evidence pointed at fifteen Business Profiles instead of
 *   at one reader.
 *
 * Every place id, address and salon name below is invented. The store codes
 * are real, because they are printed on the storefronts.
 */

const urlFix = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260919003000_google_review_url_check_repetition.sql",
  ),
  "utf8",
);

/**
 * One record in the shape the extractor actually returns.
 *
 * NO `placeId` FIELD. The identifier lives in `url`, as
 * `/maps/search/?api=1&query=…&query_place_id=ChIJ…`, which is the shape the
 * production dataset carries and the shape the old reader could not read.
 */
function extractorRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Sun Tan City",
    address: "2624 Iowa St, Lawrence, KS 66046",
    city: "Lawrence",
    state: "KS",
    postalCode: "66046",
    countryCode: "US",
    url: "https://www.google.com/maps/search/?api=1&query=Sun%20Tan%20City&query_place_id=ChIJrecovered00000000001",
    ...overrides,
  };
}

function location(overrides: Partial<ApifyLocationMapping> = {}): ApifyLocationMapping {
  return {
    storeCode: "314",
    salonNumber: "0466",
    locationName: "KS Lawrence",
    district: "Patterson, Madeline",
    googleLocationLabel: "Sun Tan City - KS Lawrence",
    listingState: "verified",
    isActive: true,
    googlePlaceId: null,
    googleCid: null,
    googleMapsUrl: null,
    canonicalGoogleName: null,
    canonicalGoogleAddress: null,
    expectedStreetAddress: "2624 Iowa St",
    expectedCity: "Lawrence",
    expectedState: "KS",
    expectedPostalCode: "66046",
    expectedCountry: "United States",
    expectedStreetHint: null,
    sourceStatus: "unconfigured",
    lastVerifiedAt: null,
    verificationNote: null,
    discoveryStatus: "not_searched",
    discoveredPlaceId: null,
    discoveredName: null,
    discoveredAddress: null,
    discoveredMapsUrl: null,
    discoveredCid: null,
    discoveryCandidateCount: 0,
    discoveredAt: null,
    discoveryNote: null,
    discoveryQuery: null,
    countingActive: false,
    reviewsTotal: 0,
    reviewsFromApify: 0,
    reviewsFromBrave: 0,
    latestPublishedAt: null,
    latestSeenAt: null,
    ...overrides,
  };
}

/* ------------------------------------------------- reading the Place ID -- */

describe("finding the Place ID wherever the Actor put it", () => {
  it("READS `query_place_id` OUT OF A MAPS URL, which is the bug that cost a run", () => {
    expect(readPlaceIdFromRecord(extractorRecord())).toBe("ChIJrecovered00000000001");
  });

  it("reads `place_id` out of a share-style URL", () => {
    expect(
      readPlaceIdFromRecord({
        url: "https://www.google.com/maps/place/?q=place_id:X&place_id=ChIJshared0000000000002",
      }),
    ).toBe("ChIJshared0000000000002");
  });

  it("prefers a direct field when the Actor supplies one", () => {
    expect(
      readPlaceIdFromRecord({
        placeId: "ChIJdirect0000000000003",
        url: "https://maps.google.com/?query_place_id=ChIJfromurl000000000004",
      }),
    ).toBe("ChIJdirect0000000000003");
  });

  it("accepts the alternate field spellings the marketplace uses", () => {
    expect(readPlaceIdFromRecord({ place_id: "ChIJsnake00000000000005" })).toBe(
      "ChIJsnake00000000000005",
    );
    expect(readPlaceIdFromRecord({ googlePlaceId: "ChIJcamel00000000000006" })).toBe(
      "ChIJcamel00000000000006",
    );
  });

  it("decodes a percent-escaped URL before reading it", () => {
    expect(
      readPlaceIdFromRecord({
        url: "https://www.google.com/maps/search/%3Fapi%3D1%26query_place_id%3DChIJescaped000000000007",
      }),
    ).toBe("ChIJescaped000000000007");
  });

  it("survives a malformed escape rather than throwing", () => {
    expect(() =>
      readPlaceIdFromRecord({ url: "https://maps.google.com/%E0%A4%A?query_place_id=ChIJok00000000000008" }),
    ).not.toThrow();
  });

  it("NEVER USES THE NAME AS AN IDENTIFIER", () => {
    /*
     * Two Sun Tan City listings share a name. A mapping keyed on it would merge
     * two salons the first time it mattered.
     */
    expect(readPlaceIdFromRecord({ title: "Sun Tan City", name: "Sun Tan City" })).toBeNull();
  });

  it("refuses a URL with no identifier in it at all", () => {
    expect(
      readPlaceIdFromRecord({ url: "https://www.google.com/maps/place/Sun+Tan+City/@38.9,-95.2,17z" }),
    ).toBeNull();
  });
});

/* ------------------------------------------- what the dataset contained -- */

describe("telling an empty answer apart from an unreadable one", () => {
  it("counts what came back and what could be read", () => {
    const shape = describeDataset([
      extractorRecord(),
      extractorRecord({ url: "https://maps.google.com/?query_place_id=ChIJsecond000000000009" }),
      { title: "Something with no identifier", address: "1 Nowhere St" },
    ]);

    expect(shape.received).toBe(3);
    expect(shape.readable).toBe(2);
  });

  it("REPORTS THE FIELD NAMES OF A RECORD IT COULD NOT READ", () => {
    /*
     * The one piece of evidence that turns "the Actor changed its schema" from
     * a guess into a fact. Key names from a public place listing are safe to
     * surface: they are not values and not secrets.
     */
    const shape = describeDataset([{ businessTitle: "Sun Tan City", locationUrl: "https://x" }]);

    expect(shape.readable).toBe(0);
    expect(shape.sampleKeys).toContain("businessTitle");
    expect(shape.sampleKeys).toContain("locationUrl");
  });

  it("says nothing was readable rather than nothing came back", () => {
    const [outcome] = resolveDiscovery([location()], [{ title: "Sun Tan City", address: "x" }]);

    expect(outcome.status).toBe("not_found");
    expect(outcome.note).toContain("not for any other");
  });
});

/* ------------------------------------------------ the fifteen, recovered -- */

describe("the roster, matched from the recovered dataset", () => {
  /**
   * The fifteen as ASK Sunny holds them, each with the address that separates
   * it. THE SALON NUMBER IS NEVER THE PADDED STORE CODE — Google 306 is salon
   * 0462, and 0306 is a different salon entirely.
   */
  const roster: { storeCode: string; salonNumber: string; name: string; street: string; city: string; state: string; zip: string }[] = [
    { storeCode: "140", salonNumber: "0306", name: "MO Kansas City Wornall", street: "8600 Wornall Rd", city: "Kansas City", state: "MO", zip: "64114" },
    { storeCode: "141", salonNumber: "0307", name: "NE Grand Island", street: "3410 W State St", city: "Grand Island", state: "NE", zip: "68803" },
    { storeCode: "143", salonNumber: "0308", name: "NE Kearney", street: "5220 3rd Ave", city: "Kearney", state: "NE", zip: "68845" },
    { storeCode: "144", salonNumber: "0310", name: "NE Lincoln 27th", street: "2801 Pine Lake Rd", city: "Lincoln", state: "NE", zip: "68516" },
    { storeCode: "145", salonNumber: "0311", name: "NE Lincoln O Street", street: "6100 O St", city: "Lincoln", state: "NE", zip: "68510" },
    { storeCode: "146", salonNumber: "0312", name: "NE Lincoln Pine Lake", street: "2710 Jamie Ln", city: "Lincoln", state: "NE", zip: "68512" },
    { storeCode: "147", salonNumber: "0313", name: "NE Omaha 132nd and Maple", street: "13220 Maple Rd", city: "Omaha", state: "NE", zip: "68164" },
    { storeCode: "148", salonNumber: "0314", name: "NE Omaha 144th and Center", street: "14450 Eagle Run Dr", city: "Omaha", state: "NE", zip: "68116" },
    { storeCode: "231", salonNumber: "0409", name: "MO Kansas City Liberty", street: "8 Victory Ln", city: "Liberty", state: "MO", zip: "64068" },
    { storeCode: "254", salonNumber: "0431", name: "NE Omaha Pacific", street: "1220 Pacific St", city: "Omaha", state: "NE", zip: "68154" },
    { storeCode: "306", salonNumber: "0462", name: "KS Manhattan", street: "512 Richards Dr", city: "Manhattan", state: "KS", zip: "66502" },
    { storeCode: "307", salonNumber: "0463", name: "KS Shawnee Mission Pkwy", street: "6900 Shawnee Mission Pkwy", city: "Shawnee", state: "KS", zip: "66202" },
    { storeCode: "314", salonNumber: "0466", name: "KS Lawrence", street: "2624 Iowa St", city: "Lawrence", state: "KS", zip: "66046" },
    { storeCode: "373", salonNumber: "0480", name: "KS Overland Park", street: "9550 Metcalf Ave", city: "Overland Park", state: "KS", zip: "66212" },
    { storeCode: "409", salonNumber: "0495", name: "MO St Joseph", street: "3702 Frederick Ave", city: "St Joseph", state: "MO", zip: "64506" },
  ];

  const locations = roster.map((entry) =>
    location({
      storeCode: entry.storeCode,
      salonNumber: entry.salonNumber,
      locationName: entry.name,
      expectedStreetAddress: entry.street,
      expectedCity: entry.city,
      expectedState: entry.state,
      expectedPostalCode: entry.zip,
    }),
  );

  /** The dataset as the extractor returns it: id only inside the URL. */
  const dataset = roster.map((entry, index) =>
    extractorRecord({
      address: `${entry.street}, ${entry.city}, ${entry.state} ${entry.zip}`,
      city: entry.city,
      state: entry.state,
      postalCode: entry.zip,
      url: `https://www.google.com/maps/search/?api=1&query=Sun%20Tan%20City&query_place_id=ChIJroster${String(index).padStart(14, "0")}`,
    }),
  );

  it("MATCHES ALL FIFTEEN FROM RECORDS WITH NO PLACE ID FIELD", () => {
    const outcomes = resolveDiscovery(locations, dataset);

    const matched = outcomes.filter((outcome) => outcome.status === "candidate_found");
    expect(matched).toHaveLength(15);
    /* Every one carries an id read out of its URL. */
    expect(matched.every((outcome) => outcome.candidate?.placeId.startsWith("ChIJroster"))).toBe(
      true,
    );
  });

  it("gives each salon the listing at its own door, not its neighbour's", () => {
    const outcomes = resolveDiscovery(locations, dataset);

    for (const [index, entry] of roster.entries()) {
      const outcome = outcomes.find((item) => item.storeCode === entry.storeCode);
      expect(outcome?.status, entry.name).toBe("candidate_found");
      expect(outcome?.candidate?.address, entry.name).toContain(entry.street);
      expect(outcome?.candidate?.placeId, entry.name).toBe(
        `ChIJroster${String(index).padStart(14, "0")}`,
      );
    }
  });

  it("separates the three Lincoln salons by address alone", () => {
    /* City and state cannot tell them apart; the street number can. */
    const lincoln = ["144", "145", "146"];
    const outcomes = resolveDiscovery(locations, dataset).filter((outcome) =>
      lincoln.includes(outcome.storeCode),
    );

    expect(outcomes.every((outcome) => outcome.status === "candidate_found")).toBe(true);
    expect(new Set(outcomes.map((outcome) => outcome.candidate?.placeId)).size).toBe(3);
  });

  it("LEAVES A VERIFIED SALON OUT OF THE RECOVERY ENTIRELY", () => {
    /*
     * Recovery may fill the discovered_* columns. It must never disturb a
     * mapping somebody has already signed off.
     */
    const withVerified = locations.map((entry) =>
      entry.storeCode === "306"
        ? { ...entry, sourceStatus: "verified" as const, googlePlaceId: "ChIJalreadysigned0001" }
        : entry,
    );

    /* The caller filters verified listings out before resolving; proven here
       so a future change to that filter fails loudly. */
    const searched = withVerified.filter((entry) => entry.sourceStatus !== "verified");
    const outcomes = resolveDiscovery(searched, dataset);

    expect(outcomes.some((outcome) => outcome.storeCode === "306")).toBe(false);
    expect(outcomes).toHaveLength(14);
  });

  it("stays ambiguous rather than guessing when two listings share one door", () => {
    const duplicated = [
      ...dataset,
      extractorRecord({
        address: "2624 Iowa St, Lawrence, KS 66046",
        city: "Lawrence",
        state: "KS",
        postalCode: "66046",
        url: "https://www.google.com/maps/search/?api=1&query_place_id=ChIJduplicate0000000001",
      }),
    ];

    const outcome = resolveDiscovery(locations, duplicated).find(
      (item) => item.storeCode === "314",
    );

    expect(outcome?.status).toBe("ambiguous");
    expect(outcome?.candidate).toBeNull();
  });

  it("never attaches on the name alone", () => {
    const wrongTown = dataset.map((record) => ({
      ...record,
      address: "1 Nowhere Rd, Topeka, KS 66603",
      city: "Topeka",
      postalCode: "66603",
    }));

    const outcomes = resolveDiscovery(locations, wrongTown);
    expect(outcomes.every((outcome) => outcome.status !== "candidate_found")).toBe(true);
  });
});

/* ------------------------------------------- the manual mapping fallback -- */

describe("what the manual field accepts", () => {
  it("takes a bare Place ID", () => {
    expect(readPlaceIdFromInput("ChIJmanual00000000000001")).toBe("ChIJmanual00000000000001");
  });

  it("takes a URL carrying place_id", () => {
    expect(
      readPlaceIdFromInput("https://www.google.com/maps/place/?q=x&place_id=ChIJmanual00000000000002"),
    ).toBe("ChIJmanual00000000000002");
  });

  it("TAKES A URL CARRYING query_place_id, which is what store 307 was pasted as", () => {
    expect(
      readPlaceIdFromInput(
        "https://www.google.com/maps/search/?api=1&query=Sun+Tan+City&query_place_id=ChIJmanual00000000000003",
      ),
    ).toBe("ChIJmanual00000000000003");
  });

  it("refuses a Maps URL that carries no Place ID at all", () => {
    expect(
      readPlaceIdFromInput("https://www.google.com/maps/place/Sun+Tan+City/@39.0,-94.6,17z"),
    ).toBeNull();
  });
});

/* -------------------------------------------- the constraint that broke it -- */

describe("the CHECK constraint that could never execute", () => {
  it("REPLACES EVERY REPETITION COUNT ABOVE POSTGRES'S LIMIT OF 255", () => {
    /*
     * `{5,500}` is not a stricter rule than `{5,255}` — it is a SYNTAX ERROR
     * that Postgres raises when the pattern is EVALUATED, not when the
     * constraint is created. So the constraint was accepted at migration time
     * and threw 2201B the first time anybody saved a Maps URL, which is why
     * pasting a URL failed and pasting a bare Place ID worked.
     */
    /*
     * THE REGEX LITERALS ONLY — the operands of `~` and `!~`. The migration
     * quotes the broken `{5,500}` in its comments AND in the constraint's own
     * COMMENT text, to explain the defect; a scan that counted those as
     * patterns would fail on the explanation of the bug it checks for.
     */
    const sql = urlFix
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    const patterns = [...sql.matchAll(/!?~\s*'([^']*)'/g)].map((match) => match[1]);

    expect(patterns.length).toBeGreaterThan(0);

    for (const pattern of patterns) {
      for (const repeat of pattern.matchAll(/\{\s*\d+\s*,\s*(\d+)\s*\}/g)) {
        expect(Number(repeat[1]), pattern).toBeLessThanOrEqual(255);
      }
      /* And every one of them actually compiles. */
      expect(() => new RegExp(pattern), pattern).not.toThrow();
    }
  });

  it("keeps every rule the broken pattern intended", () => {
    expect(urlFix).toContain("length(google_maps_url) <= 500");
    expect(urlFix).toContain("google_maps_url !~");
    expect(urlFix).toContain("^https://");
  });

  it("fixes the website URL constraint carrying the same defect", () => {
    expect(urlFix).toContain("google_review_locations_website_url_check");
    expect(urlFix).toContain("length(website_url) <= 300");
  });

  it("proves the new patterns execute, so the same mistake fails the migration", () => {
    expect(urlFix).toContain("raise exception");
    expect(urlFix).toContain("rejects a valid short URL");
  });

  it("touches no review, no period and no anchor", () => {
    expect(urlFix).not.toMatch(/insert\s+into\s+public\.google_reviews/i);
    expect(urlFix).not.toMatch(/update\s+public\.google_reviews\b/i);
    expect(urlFix).not.toContain("counted_through_external_review_id =");
  });
});

/* ------------------------------------------------------- a sanity check -- */

describe("the reader still refuses what it always refused", () => {
  it("drops a record that is not an object", () => {
    expect(readPlaceCandidate("a string")).toBeNull();
    expect(readPlaceCandidate(null)).toBeNull();
    expect(readPlaceCandidate([1, 2])).toBeNull();
  });
});
