import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { salonByNumber } from "@/data/salons";
import { GOOGLE_REVIEW_LOCATIONS } from "../store-codes";
import {
  buildSearchQuery,
  candidateMatchesLocation,
  readPlaceCandidate,
  resolveDiscovery,
  safeMatches,
} from "./discovery";
import type { ApifyLocationMapping } from "./types";

/**
 * ============================================================================
 * DISCOVERING THE FIFTEEN — and every way it must refuse to guess
 * ============================================================================
 *
 * One failure matters more than all the others: a stranger's Google listing
 * attached to a real salon, permanently, with nothing on the dashboard looking
 * wrong. "Sun Tan City" is a franchise brand, so the tests below are mostly
 * about the cases where a plausible answer must be REFUSED rather than taken.
 *
 * Every address and place id below is invented.
 */

const repoRoot = process.cwd();

const discoveryMigration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20260918002000_google_review_apify_discovery.sql"),
  "utf8",
);

function location(overrides: Partial<ApifyLocationMapping> = {}): ApifyLocationMapping {
  return {
    storeCode: "306",
    salonNumber: "0462",
    locationName: "KS Manhattan",
    district: "Patterson, Madeline",
    googleLocationLabel: "Sun Tan City - KS Manhattan",
    listingState: "verified",
    isActive: true,
    googlePlaceId: null,
    googleCid: null,
    googleMapsUrl: null,
    canonicalGoogleName: null,
    canonicalGoogleAddress: null,
    expectedState: "KS",
    expectedCity: "Manhattan",
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

function place(overrides: Record<string, unknown> = {}) {
  return {
    placeId: "ChIJFIXTURE306Manhattan00",
    title: "Sun Tan City",
    address: "1234 N 3rd St, Manhattan, KS 66502",
    city: "Manhattan",
    state: "KS",
    postalCode: "66502",
    ...overrides,
  };
}

/* ------------------------------------------------------------ the roster -- */

describe("the roster discovery searches from", () => {
  const seededHints = [
    ...discoveryMigration.matchAll(
      /\('(\d{1,8})',\s*(array\[[^\]]*\]|null::text\[\])\)/g,
    ),
  ].map((match) => ({ storeCode: match[1], hint: match[2] }));

  it("seeds a street hint decision for exactly the fifteen store codes", () => {
    /*
     * FIFTEEN DECISIONS, not fifteen values — `null` is a decision too, and it
     * means "the city alone identifies this salon". A listing missing from this
     * seed would silently fall back to city-only matching in a city that might
     * hold three salons.
     */
    expect(seededHints).toHaveLength(15);
    expect(seededHints.map((entry) => entry.storeCode).sort()).toEqual(
      GOOGLE_REVIEW_LOCATIONS.map((entry) => entry.storeCode).sort(),
    );
  });

  it("gives every salon that shares a city with another a street hint", () => {
    /*
     * THREE SALONS IN LINCOLN AND THREE IN OMAHA. Without a hint all three
     * match "Sun Tan City Lincoln NE" and the honest answer for every one of
     * them is `ambiguous` — which is safe and useless. The hint is what makes
     * automatic discovery possible at all.
     */
    for (const storeCode of ["144", "145", "146", "147", "148", "254", "140"]) {
      const entry = seededHints.find((seeded) => seeded.storeCode === storeCode);
      expect(entry?.hint, `store code ${storeCode}`).toContain("array[");
    }
  });

  it("keeps store code 306 pointing at salon 0462, not 0306", () => {
    /*
     * THE COLLISION, RESTATED WHERE DISCOVERY CAN REACH IT. A discovery that
     * wrote its result against a salon number derived from the store code would
     * file KS Manhattan's Google listing against MO Kansas City Wornall.
     */
    const manhattan = GOOGLE_REVIEW_LOCATIONS.find((entry) => entry.storeCode === "306");
    expect(manhattan?.salonNumber).toBe("0462");
    expect(salonByNumber("0462")?.name).toBe("KS Manhattan");
    expect(salonByNumber("0306")?.name).toBe("MO Kansas City Wornall");
  });
});

describe("the search query", () => {
  it("is built from the roster: brand, street hint, city, state", () => {
    expect(
      buildSearchQuery(
        location({
          storeCode: "144",
          expectedCity: "Lincoln",
          expectedState: "NE",
          expectedStreetHint: ["27th"],
        }),
      ),
    ).toBe("Sun Tan City 27th Lincoln NE");
  });

  it("omits a hint that does not exist rather than inventing one", () => {
    expect(buildSearchQuery(location())).toBe("Sun Tan City Manhattan KS");
  });

  it("REFUSES TO SEARCH FOR A LISTING IT COULD NOT CHECK", () => {
    /* No expectations means no way to verify the answer, so no question. */
    expect(buildSearchQuery(location({ expectedCity: null }))).toBeNull();
    expect(buildSearchQuery(location({ expectedState: null }))).toBeNull();
  });
});

/* ---------------------------------------------------------- the matching -- */

describe("matching one candidate to one salon", () => {
  it("accepts a Sun Tan City in the expected city and state", () => {
    const verdict = candidateMatchesLocation(readPlaceCandidate(place())!, location());
    expect(verdict.matches).toBe(true);
    expect(verdict.reason).toBe("matched");
  });

  it("REJECTS BUFF CITY SOAP, which shares the Google account", () => {
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(place({ title: "Buff City Soap" }))!,
      location(),
    );
    expect(verdict.matches).toBe(false);
    expect(verdict.reason).toBe("excluded_business");
  });

  it("rejects any other business, whatever else lines up", () => {
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(place({ title: "Palm Beach Tan" }))!,
      location(),
    );
    expect(verdict.matches).toBe(false);
    expect(verdict.reason).toBe("not_sun_tan_city");
  });

  it("REJECTS THE RIGHT BRAND IN THE WRONG STATE", () => {
    /* Manhattan, Kansas and Manhattan, New York. */
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(
        place({ address: "1234 Broadway, Manhattan, NY 10001", state: "NY", city: "Manhattan" }),
      )!,
      location(),
    );
    expect(verdict.matches).toBe(false);
    expect(verdict.reason).toBe("wrong_state");
  });

  it("rejects the right brand in the right state and the wrong city", () => {
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(
        place({ address: "500 Iowa St, Lawrence, KS 66044", city: "Lawrence" }),
      )!,
      location(),
    );
    expect(verdict.matches).toBe(false);
    expect(verdict.reason).toBe("wrong_city");
  });

  it("rejects the right city and the wrong street, where a hint exists", () => {
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(
        place({ address: "5000 O St, Lincoln, NE 68510", city: "Lincoln", state: "NE" }),
      )!,
      location({
        storeCode: "144",
        expectedCity: "Lincoln",
        expectedState: "NE",
        expectedStreetHint: ["27th"],
      }),
    );
    expect(verdict.matches).toBe(false);
    expect(verdict.reason).toBe("wrong_street");
  });

  it("accepts on any one of a salon's hint tokens", () => {
    /* "132nd and Maple" is two tokens because Google carries one or the other. */
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(
        place({ address: "3003 N 132nd St, Omaha, NE 68164", city: "Omaha", state: "NE" }),
      )!,
      location({
        storeCode: "147",
        expectedCity: "Omaha",
        expectedState: "NE",
        expectedStreetHint: ["132nd", "maple"],
      }),
    );
    expect(verdict.matches).toBe(true);
  });

  it("rejects a listing Google says is closed", () => {
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(place({ permanentlyClosed: true }))!,
      location(),
    );
    expect(verdict.matches).toBe(false);
    expect(verdict.reason).toBe("closed");
  });

  it("REJECTS RATHER THAN PASSES WHEN THERE IS NOTHING TO CHECK", () => {
    expect(
      candidateMatchesLocation(readPlaceCandidate(place({ title: null }))!, location()).reason,
    ).toBe("no_name");
    expect(
      candidateMatchesLocation(
        readPlaceCandidate(
          place({ address: null, city: null, state: null, postalCode: null }),
        )!,
        location(),
      ).reason,
    ).toBe("no_address");
    expect(
      candidateMatchesLocation(readPlaceCandidate(place())!, location({ expectedCity: null }))
        .reason,
    ).toBe("no_expectations");
  });

  it("looks past punctuation and case", () => {
    const verdict = candidateMatchesLocation(
      readPlaceCandidate(
        place({
          title: "SUN TAN CITY",
          address: "9 N Belt Hwy, St. Joseph, MO 64506",
          city: "St. Joseph",
          state: "MO",
        }),
      )!,
      location({ storeCode: "409", expectedCity: "St Joseph", expectedState: "MO" }),
    );
    expect(verdict.matches).toBe(true);
  });
});

/* ------------------------------------------------ resolving a whole run --- */

describe("resolving a dataset against the roster", () => {
  const manhattan = location();
  const lincoln27 = location({
    storeCode: "144",
    salonNumber: "0310",
    locationName: "NE Lincoln 27th Street",
    expectedCity: "Lincoln",
    expectedState: "NE",
    expectedStreetHint: ["27th"],
  });
  const lincolnO = location({
    storeCode: "145",
    salonNumber: "0311",
    locationName: "NE Lincoln O Street",
    expectedCity: "Lincoln",
    expectedState: "NE",
    expectedStreetHint: ["o st", "o street"],
  });

  it("matches each salon to its own listing where the street separates them", () => {
    const outcomes = resolveDiscovery(
      [lincoln27, lincolnO],
      [
        place({
          placeId: "ChIJFIXTURE144Lincoln27th",
          address: "2650 N 27th St, Lincoln, NE 68521",
          city: "Lincoln",
          state: "NE",
        }),
        place({
          placeId: "ChIJFIXTURE145LincolnOSt",
          address: "5000 O St, Lincoln, NE 68510",
          city: "Lincoln",
          state: "NE",
        }),
      ],
    );

    expect(outcomes.map((outcome) => [outcome.storeCode, outcome.status])).toEqual([
      ["144", "candidate_found"],
      ["145", "candidate_found"],
    ]);
    expect(outcomes[0].candidate?.placeId).toBe("ChIJFIXTURE144Lincoln27th");
    expect(outcomes[1].candidate?.placeId).toBe("ChIJFIXTURE145LincolnOSt");
  });

  it("REFUSES WHEN TWO CANDIDATES FIT ONE SALON EQUALLY WELL", () => {
    /*
     * A salon that moved and whose old listing was never removed. Preferring
     * the one with more reviews would be right most of the time and invisibly
     * wrong occasionally.
     */
    const outcomes = resolveDiscovery(
      [manhattan],
      [
        place({ placeId: "ChIJFIXTURE306ManhattanA" }),
        place({ placeId: "ChIJFIXTURE306ManhattanB", address: "9 Poyntz Ave, Manhattan, KS 66502" }),
      ],
    );

    expect(outcomes[0].status).toBe("ambiguous");
    expect(outcomes[0].candidate).toBeNull();
    expect(outcomes[0].candidateCount).toBe(2);
    expect(outcomes[0].note).toContain("by hand");
  });

  it("REFUSES WHEN ONE CANDIDATE FITS TWO SALONS", () => {
    /*
     * The other direction of ambiguity, and the one a per-query implementation
     * would miss entirely: a single Lincoln listing with no street in its
     * address matches both Lincoln salons' city and state.
     */
    const noHint = location({ storeCode: "144", expectedCity: "Lincoln", expectedState: "NE" });
    const alsoNoHint = location({
      storeCode: "145",
      expectedCity: "Lincoln",
      expectedState: "NE",
    });

    const outcomes = resolveDiscovery(
      [noHint, alsoNoHint],
      [
        place({
          placeId: "ChIJFIXTURELincolnShared",
          address: "Lincoln, NE 68510",
          city: "Lincoln",
          state: "NE",
        }),
      ],
    );

    expect(outcomes.every((outcome) => outcome.status === "ambiguous")).toBe(true);
    expect(outcomes.every((outcome) => outcome.candidate === null)).toBe(true);
  });

  it("reports a salon Google returned nothing for", () => {
    const outcomes = resolveDiscovery([manhattan], []);
    expect(outcomes[0].status).toBe("not_found");
    expect(outcomes[0].candidate).toBeNull();
    expect(outcomes[0].query).toBe("Sun Tan City Manhattan KS");
  });

  it("reports a closed listing as a profile issue rather than as nothing found", () => {
    const outcomes = resolveDiscovery(
      [manhattan],
      [place({ permanentlyClosed: true })],
    );

    expect(outcomes[0].status).toBe("profile_issue");
    /* The candidate is carried so a person can go and look at it. */
    expect(outcomes[0].candidate?.placeId).toBe("ChIJFIXTURE306Manhattan00");
    expect(outcomes[0].note).toContain("closed");
  });

  it("ignores a dataset record with no usable place id", () => {
    const outcomes = resolveDiscovery([manhattan], ["nonsense", {}, place({ placeId: "no" })]);
    expect(outcomes[0].status).toBe("not_found");
  });

  it("collapses the same place returned twice", () => {
    const outcomes = resolveDiscovery([manhattan], [place(), place()]);
    expect(outcomes[0].status).toBe("candidate_found");
    expect(outcomes[0].candidateCount).toBe(1);
  });
});

/* ----------------------------------------------- what may be promoted ----- */

describe("which discoveries may be accepted", () => {
  it("offers exactly the unambiguous ones", () => {
    const codes = safeMatches([
      location({
        storeCode: "306",
        discoveryStatus: "candidate_found",
        discoveredPlaceId: "ChIJFIXTURE306Manhattan00",
        discoveredName: "Sun Tan City",
        discoveredAddress: "1234 N 3rd St, Manhattan, KS 66502",
      }),
      location({ storeCode: "144", discoveryStatus: "ambiguous" }),
      location({ storeCode: "145", discoveryStatus: "not_found" }),
      location({ storeCode: "146", discoveryStatus: "profile_issue" }),
      location({ storeCode: "147", discoveryStatus: "searching" }),
    ]);

    expect(codes).toEqual(["306"]);
  });

  it("refuses a candidate with no evidence behind it", () => {
    /* `verified` means Google's own name and address were checked. */
    expect(
      safeMatches([
        location({
          discoveryStatus: "candidate_found",
          discoveredPlaceId: "ChIJFIXTURE306Manhattan00",
          discoveredName: null,
          discoveredAddress: null,
        }),
      ]),
    ).toEqual([]);
  });

  it("NEVER RE-POINTS A LISTING THAT IS ALREADY VERIFIED", () => {
    /*
     * A verified mapping is persisted and reused. Discovery must not be able to
     * replace it as a side effect of somebody pressing Discover twice.
     */
    expect(
      safeMatches([
        location({
          sourceStatus: "verified",
          googlePlaceId: "ChIJFIXTUREalreadyverified",
          discoveryStatus: "candidate_found",
          discoveredPlaceId: "ChIJFIXTUREsomethingelse01",
          discoveredName: "Sun Tan City",
          discoveredAddress: "somewhere else",
        }),
      ]),
    ).toEqual([]);
  });
});

/* ------------------------------------------- what discovery may not do ---- */

describe("discovery proposes and never disposes", () => {
  const source = readFileSync(join(repoRoot, "src", "lib", "reviews", "apify", "discovery.ts"), "utf8");

  it("touches no review and no database at all", () => {
    /*
     * The matcher is a pure function. It has no client, so "discovery altered a
     * review" is not a thing that can happen at this layer — and the layer that
     * writes uses a function that can only reach the discovered_* columns.
     *
     * Comments are stripped first: the file NAMES these things in prose, to
     * explain why it does not reach them. What must not appear is a line of
     * code that does.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("getSupabaseAdmin");
    expect(code).not.toContain("google_reviews");
    expect(code).not.toContain("server-only");

    /*
     * AND IT IMPORTS NOTHING THAT COULD REACH A DATABASE. The only import in
     * the file is a type, which is erased at compile time — so there is no
     * runtime dependency here at all, which is what makes "discovery altered a
     * review" impossible rather than merely unintended.
     */
    const imports = [...code.matchAll(/^import .*$/gm)].map((match) => match[0]);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("import type");
  });

  it("records a discovery through a function that cannot write the accepted mapping", () => {
    const recorder = discoveryMigration.slice(
      discoveryMigration.indexOf("function public.google_review_apify_record_discovery"),
      discoveryMigration.indexOf("revoke all on function public.google_review_apify_record_discovery"),
    );

    expect(recorder).toContain("discovered_place_id");

    /*
     * THE ACCEPTED MAPPING AND THE RUNNABLE STATUS ARE OUT OF ITS REACH — and
     * what is checked is the SET clause, not the whole body. The function READS
     * `apify_source_status` to refuse an already-verified listing, which is the
     * opposite of writing it.
     */
    const assignments = recorder.slice(
      recorder.indexOf("update public.google_review_locations"),
      recorder.indexOf("where l.id = v_location.id"),
    );
    expect(assignments).not.toContain("google_place_id");
    expect(assignments).not.toContain("apify_source_status");
    expect(assignments).not.toContain("canonical_google_name");

    /* And it refuses a listing somebody already signed off. */
    expect(recorder).toContain("already_verified");
  });

  it("promotes only through a gate that refuses anything unsafe", () => {
    const promoter = discoveryMigration.slice(
      discoveryMigration.indexOf("function public.google_review_apify_promote_discovered"),
      discoveryMigration.indexOf("revoke all on function public.google_review_apify_promote_discovered"),
    );

    expect(promoter).toContain("v_row.discovery_status <> 'candidate_found'");
    expect(promoter).toContain("not_a_safe_match");
    expect(promoter).toContain("no_evidence");
    expect(promoter).toContain("place_already_mapped");
    expect(promoter).toContain("already_verified");
  });

  it("writes nothing to any review table", () => {
    expect(discoveryMigration).not.toMatch(/insert\s+into\s+public\.google_reviews/i);
    expect(discoveryMigration).not.toMatch(/update\s+public\.google_reviews\b/i);
    expect(discoveryMigration).not.toMatch(/delete\s+from/i);
    expect(discoveryMigration).not.toMatch(/truncate/i);
  });
});
