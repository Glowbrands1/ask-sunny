import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  addressMatch,
  addressMatchLabel,
  buildSearchQuery,
  candidateStreetLine,
  normaliseStreet,
  resolveDiscovery,
  storedAddressMatch,
  unresolvedForRediscovery,
} from "./discovery";
import type { ApifyLocationMapping, ApifyPlaceCandidate } from "./types";

/**
 * ============================================================================
 * FINDING A SALON BY ITS ADDRESS, WHICH IS THE THING A PERSON ACTUALLY KNOWS
 * ============================================================================
 *
 * Discovery used to search on a brand, a city, a state and — for six salons — a
 * street token lifted out of the salon's own name. When that was not enough the
 * honest answer was `ambiguous`, and `ambiguous` sent an operator to a fallback
 * form asking for a Google Place ID: a value only Google holds, that nobody can
 * check by looking, and that nobody should have to find fifteen times.
 *
 * So an expected address can now be typed in, and these are the tests that say
 * what it is allowed to change:
 *
 *   IT MAKES THE SEARCH SHARPER, never the acceptance looser. Every check that
 *   existed still runs; the address is an ADDITIONAL hurdle where one is on
 *   record, and the pre-address behaviour is preserved exactly where one is not.
 *
 *   IT BREAKS TIES, and only real ones. A candidate matching the expected
 *   street beats one matching the city — but two candidates matching the street
 *   equally well is still `ambiguous`, because that is two listings for one door
 *   and a person has to look.
 *
 *   IT FAILS CLOSED ON A CONTRADICTION. Two postcodes that disagree is a
 *   rejection even when the street line reads the same.
 *
 * Every address, salon name and place id below is invented.
 */

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260919001000_google_review_expected_addresses.sql"),
  "utf8",
);

function location(overrides: Partial<ApifyLocationMapping> = {}): ApifyLocationMapping {
  return {
    storeCode: "306",
    salonNumber: "0462",
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
    expectedStreetAddress: "2624 Iowa St Ste B",
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

function candidate(overrides: Partial<ApifyPlaceCandidate> = {}): ApifyPlaceCandidate {
  return {
    placeId: "ChIJinvented0000000000001",
    title: "Sun Tan City",
    address: "2624 Iowa St, Lawrence, KS 66046, United States",
    street: null,
    city: null,
    state: null,
    postalCode: null,
    cid: null,
    mapsUrl: null,
    permanentlyClosed: false,
    temporarilyClosed: false,
    searchString: null,
    ...overrides,
  };
}

/* ------------------------------------------------------ normalising a street */

describe("reducing two spellings of one street to one", () => {
  it("drops the suite, which Google omits far more often than it carries", () => {
    /*
     * THE FAILURE THIS PREVENTS is the common case, not the exotic one: an
     * operations manager types the suite because it is on the lease, Google
     * returns the street without it, and a literal comparison calls the salon's
     * own address a different place.
     */
    expect(normaliseStreet("2624 Iowa St Ste B")).toEqual(
      normaliseStreet("2624 Iowa Street"),
    );
    expect(normaliseStreet("100 Main St Unit 4")).toEqual(normaliseStreet("100 Main St"));
    expect(normaliseStreet("100 Main St #4")).toEqual(normaliseStreet("100 Main St"));
  });

  it("spells out the suffix and the directional, whichever side abbreviated", () => {
    expect(normaliseStreet("18 W 6th Ave")).toEqual(normaliseStreet("18 West 6th Avenue"));
    expect(normaliseStreet("7 Pine Lake Rd")).toEqual(normaliseStreet("7 Pine Lake Road"));
    expect(normaliseStreet("90 N 132nd Blvd")).toEqual(
      normaliseStreet("90 North 132nd Boulevard"),
    );
  });

  it("KEEPS THE HOUSE NUMBER EXACT, because it is the part with no synonyms", () => {
    /*
     * Two Sun Tan City salons on one road differ by this and nothing else.
     * Normalising it away would be the one "helpful" simplification that merges
     * two real salons.
     */
    expect(normaliseStreet("2624 Iowa St").houseNumber).toBe("2624");
    expect(normaliseStreet("2626 Iowa St").houseNumber).toBe("2626");
    expect(normaliseStreet("2624 Iowa St")).not.toEqual(normaliseStreet("2626 Iowa St"));
  });

  it("does not turn Saint into Street at the front of a name", () => {
    /* "St Joseph" is a city this business trades in. */
    expect(normaliseStreet("St Joseph Ave").street).toContain("st joseph");
    expect(normaliseStreet("St Joseph Ave").street).not.toContain("street joseph");
  });

  it("reads the street out of a formatted address, and stops at the first comma", () => {
    expect(
      candidateStreetLine(candidate({ address: "2624 Iowa St, Lawrence, KS 66046" })),
    ).toBe("2624 Iowa St");
    /* The Actor's own field wins when it filled one. */
    expect(candidateStreetLine(candidate({ street: "2624 Iowa St Ste B" }))).toBe(
      "2624 Iowa St Ste B",
    );
  });
});

/* -------------------------------------------------------- the search query */

describe("what Google is asked for", () => {
  it("asks for the door once an address is on record", () => {
    expect(buildSearchQuery(location())).toBe(
      "Sun Tan City 2624 Iowa St Ste B Lawrence KS 66046",
    );
  });

  it("falls back to the old brand-hint-city-state query when no address is typed", () => {
    /* The six salons the street hint already resolves keep working untouched. */
    const query = buildSearchQuery(
      location({
        expectedStreetAddress: null,
        expectedPostalCode: null,
        expectedCity: "Lincoln",
        expectedStreetHint: ["27th"],
      }),
    );
    expect(query).toBe("Sun Tan City 27th Lincoln KS");
  });

  it("still searches for nothing when there is no city and state to check against", () => {
    expect(buildSearchQuery(location({ expectedCity: null }))).toBeNull();
  });
});

/* ------------------------------------------------------------ the matching */

describe("how strongly an address matched", () => {
  it("is exact only when the postcode confirms the street", () => {
    expect(addressMatch(candidate(), location()).strength).toBe("exact");
  });

  it("is strong when the street agrees and no postcode is there to confirm it", () => {
    expect(
      addressMatch(candidate({ address: "2624 Iowa St, Lawrence, KS" }), location()).strength,
    ).toBe("strong");
    expect(
      addressMatch(candidate(), location({ expectedPostalCode: null })).strength,
    ).toBe("strong");
  });

  it("IS NONE WHEN THE POSTCODES DISAGREE, even though the street reads the same", () => {
    /*
     * "The street matched so the zip must be a typo" is exactly the reasoning
     * that files one salon's customers under another salon's name. Two
     * addresses in one city with different postcodes are two different places.
     */
    const verdict = addressMatch(
      candidate({ address: "2624 Iowa St, Lawrence, KS 66044, United States" }),
      location(),
    );
    expect(verdict.strength).toBe("none");
    expect(verdict.reason).toBe("postal_conflict");
  });

  it("is none for the same street name at a different number", () => {
    const verdict = addressMatch(
      candidate({ address: "2626 Iowa St, Lawrence, KS 66046" }),
      location(),
    );
    expect(verdict.strength).toBe("none");
    expect(verdict.reason).toBe("wrong_street_address");
  });

  it("treats ZIP+4 as the same postcode", () => {
    expect(
      addressMatch(candidate({ address: "2624 Iowa St, Lawrence, KS 66046-1234" }), location())
        .strength,
    ).toBe("exact");
  });

  it("falls back to searching the whole blob when the Actor gave no street line", () => {
    /* Some place records carry the address as one unstructured string. */
    const verdict = addressMatch(
      candidate({ address: "Lawrence KS — 2624 Iowa St — open late" }),
      location(),
    );
    expect(verdict.strength).toBe("strong");
  });

  it("is weak, exactly as before, when no street address has been typed", () => {
    const verdict = addressMatch(
      candidate(),
      location({ expectedStreetAddress: null, expectedPostalCode: null }),
    );
    expect(verdict.strength).toBe("weak");
    expect(verdict.reason).toBe("matched");
  });

  it("still refuses the wrong city and the wrong state first", () => {
    expect(
      addressMatch(candidate({ address: "2624 Iowa St, Topeka, KS 66046" }), location())
        .reason,
    ).toBe("wrong_city");
    expect(
      addressMatch(candidate({ address: "2624 Iowa St, Lawrence, MO 66046" }), location())
        .reason,
    ).toBe("wrong_state");
  });
});

/* --------------------------------------------------------- the resolution */

describe("choosing between candidates", () => {
  const lawrence = location({ storeCode: "306" });

  it("PREFERS THE ADDRESS MATCH OVER A BRAND-AND-CITY MATCH", () => {
    /*
     * The requirement in one test: two Sun Tan City listings in Lawrence, one
     * at the expected door. Before addresses this was `ambiguous` and a person
     * went hunting for a Place ID. Now the address decides it.
     */
    const [outcome] = resolveDiscovery(
      [lawrence],
      [
        { placeId: "ChIJright000000000000001", title: "Sun Tan City", address: "2624 Iowa St, Lawrence, KS 66046" },
        { placeId: "ChIJother000000000000002", title: "Sun Tan City", address: "999 Clinton Pkwy, Lawrence, KS 66047" },
      ],
    );

    expect(outcome.status).toBe("candidate_found");
    expect(outcome.candidate?.placeId).toBe("ChIJright000000000000001");
    expect(outcome.strength).toBe("exact");
  });

  it("STAYS AMBIGUOUS WHEN TWO CANDIDATES MATCH THE ADDRESS EQUALLY WELL", () => {
    /*
     * Not a near miss to be broken by review count or by order — two listings
     * for one door, which somebody has to look at.
     */
    const [outcome] = resolveDiscovery(
      [lawrence],
      [
        { placeId: "ChIJone00000000000000001", title: "Sun Tan City", address: "2624 Iowa St, Lawrence, KS 66046" },
        { placeId: "ChIJtwo00000000000000002", title: "Sun Tan City", address: "2624 Iowa Street Ste B, Lawrence, KS 66046" },
      ],
    );

    expect(outcome.status).toBe("ambiguous");
    expect(outcome.candidate).toBeNull();
  });

  it("gives one candidate to the salon whose address it matches, not to both", () => {
    /*
     * THE CROSS-LISTING CASE, settled by strength. One listing on Iowa St fits
     * store 306 at its exact address and store 307 only on brand and city.
     * Declaring both ambiguous would throw away the evidence that separates
     * them; 306 gets it and 307 is told it has nothing.
     */
    const sibling = location({
      storeCode: "307",
      locationName: "KS Lawrence West",
      expectedStreetAddress: null,
      expectedPostalCode: null,
      expectedStreetHint: null,
    });

    const outcomes = resolveDiscovery(
      [lawrence, sibling],
      [
        { placeId: "ChIJshared00000000000001", title: "Sun Tan City", address: "2624 Iowa St, Lawrence, KS 66046" },
      ],
    );

    const first = outcomes.find((entry) => entry.storeCode === "306");
    const second = outcomes.find((entry) => entry.storeCode === "307");

    expect(first?.status).toBe("candidate_found");
    expect(second?.status).toBe("ambiguous");
  });

  it("keeps the old behaviour when neither salon has an address on record", () => {
    /* Two weak claims are still equal, and equal is still ambiguous. */
    const a = location({ storeCode: "306", expectedStreetAddress: null, expectedPostalCode: null });
    const b = location({
      storeCode: "307",
      expectedStreetAddress: null,
      expectedPostalCode: null,
      locationName: "KS Lawrence West",
    });

    const outcomes = resolveDiscovery(
      [a, b],
      [{ placeId: "ChIJshared00000000000001", title: "Sun Tan City", address: "1 Any St, Lawrence, KS" }],
    );

    expect(outcomes.every((outcome) => outcome.status === "ambiguous")).toBe(true);
  });

  it("names the missing address when it found nothing", () => {
    const [outcome] = resolveDiscovery(
      [location({ expectedStreetAddress: null, expectedPostalCode: null })],
      [],
    );
    expect(outcome.status).toBe("not_found");
    expect(outcome.note).toContain("street address");
  });

  it("still refuses a franchise listing that is not this salon's", () => {
    /* Every pre-existing guard is untouched: brand, exclusion, closure. */
    const [outcome] = resolveDiscovery(
      [lawrence],
      [
        { placeId: "ChIJsoap00000000000000001", title: "Buff City Soap", address: "2624 Iowa St, Lawrence, KS 66046" },
      ],
    );
    expect(outcome.status).toBe("not_found");
  });

  it("reports a closed listing at the right address rather than mapping it", () => {
    const [outcome] = resolveDiscovery(
      [lawrence],
      [
        {
          placeId: "ChIJclosed0000000000001",
          title: "Sun Tan City",
          address: "2624 Iowa St, Lawrence, KS 66046",
          permanentlyClosed: true,
        },
      ],
    );
    expect(outcome.status).toBe("profile_issue");
  });
});

/* ------------------------------------------------------- the second pass */

describe("which listings a rediscovery pays for", () => {
  it("searches only what is genuinely unanswered", () => {
    const codes = unresolvedForRediscovery([
      location({ storeCode: "140", discoveryStatus: "not_searched" }),
      location({ storeCode: "141", discoveryStatus: "ambiguous" }),
      location({ storeCode: "142", discoveryStatus: "not_found" }),
    ]).map((entry) => entry.storeCode);

    expect(codes).toEqual(["140", "141", "142"]);
  });

  it("LEAVES A VERIFIED SALON ALONE, because a signed-off mapping is not re-opened by a button", () => {
    expect(
      unresolvedForRediscovery([
        location({ sourceStatus: "verified", discoveryStatus: "not_searched" }),
      ]),
    ).toHaveLength(0);
  });

  it("leaves a candidate already waiting to be accepted alone", () => {
    /* Searching again would spend credits to produce the same proposal twice. */
    expect(
      unresolvedForRediscovery([location({ discoveryStatus: "candidate_found" })]),
    ).toHaveLength(0);
  });

  it("leaves a pasted identifier waiting on its check alone", () => {
    expect(
      unresolvedForRediscovery([
        location({ sourceStatus: "pending_verification", discoveryStatus: "not_searched" }),
      ]),
    ).toHaveLength(0);
  });

  it("leaves a listing Google says is closed alone, because asking again will not change it", () => {
    expect(
      unresolvedForRediscovery([location({ discoveryStatus: "profile_issue" })]),
    ).toHaveLength(0);
  });

  it("leaves an inactive listing alone", () => {
    expect(unresolvedForRediscovery([location({ isActive: false })])).toHaveLength(0);
  });

  it("RESCUES A LISTING STRANDED BY AN ABORTED SEARCH", () => {
    /*
     * A discovery marks its listings `searching` before it starts. When the run
     * ends as ABORTED nothing moved them back, and `searching` is not one of
     * the unresolved states — so the button that exists to retry the failure
     * was offered zero listings. The problem disabled its own fix, on all
     * fifteen salons at once.
     *
     * Counting it here cannot start a duplicate search: every control that
     * begins a run is closed while one is live.
     */
    expect(
      unresolvedForRediscovery([location({ discoveryStatus: "searching" })]),
    ).toHaveLength(1);
  });
});

/* ---------------------------------------------------- what the table says */

describe("the address match a person reads on the table", () => {
  it("reports the stored candidate through the same function the matcher used", () => {
    const verified = location({
      googlePlaceId: "ChIJstored00000000000001",
      canonicalGoogleName: "Sun Tan City",
      canonicalGoogleAddress: "2624 Iowa St, Lawrence, KS 66046, United States",
    });
    expect(storedAddressMatch(verified)).toBe("exact");
  });

  it("says there is no match when nothing has been proposed or accepted", () => {
    expect(storedAddressMatch(location())).toBe("none");
  });

  it("surfaces a stored mapping that no longer matches a corrected address", () => {
    /*
     * Worth seeing rather than hiding: somebody fixed the expected address
     * under a mapping made before it, and the two now disagree.
     */
    const drifted = location({
      googlePlaceId: "ChIJstored00000000000001",
      canonicalGoogleAddress: "999 Clinton Pkwy, Lawrence, KS 66047",
    });
    expect(storedAddressMatch(drifted)).toBe("none");
  });

  it("writes each verdict in words rather than as a code", () => {
    expect(addressMatchLabel("exact")).toContain("postcode");
    expect(addressMatchLabel("strong")).toContain("Street");
    expect(addressMatchLabel("weak")).toContain("City and state");
    expect(addressMatchLabel("none")).toContain("No address");
  });
});

/* ------------------------------------------------------------- the schema */

describe("the migration that stores the address", () => {
  it("reuses the columns that already exist rather than adding a second record", () => {
    /* `expected_city` and `expected_state` have been here since the first
       migration and are seeded for all fifteen. A second address table would
       immediately raise the question of which one discovery reads. */
    expect(migration).toContain("add column if not exists expected_street_address");
    expect(migration).toContain("add column if not exists expected_postal_code");
    expect(migration).toContain("add column if not exists expected_country");
    expect(migration).not.toContain("create table");
  });

  it("DROPS THE VIEW BEFORE RECREATING IT, because replace can only append columns", () => {
    /* Postgres 42P16. The previous migration in this series learned it the
       expensive way, and the address columns are inserted mid-list. */
    const dropAt = migration.indexOf("drop view if exists public.google_review_apify_locations");
    const createAt = migration.indexOf("create view public.google_review_apify_locations");

    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
    /* No cascade: a dependent object must fail loudly, not vanish. */
    expect(migration).not.toContain("drop view if exists public.google_review_apify_locations cascade");
  });

  it("CANNOT WRITE AN IDENTIFIER OR A STATUS, which is what makes it safe to expose", () => {
    /*
     * The whole safety argument for letting an address be edited freely: the
     * setter's update list is address columns and a note. If it could reach
     * `google_place_id` or `apify_source_status`, editing an address would be a
     * path to re-pointing a salon or promoting a listing nobody checked.
     */
    const start = migration.indexOf("create or replace function public.google_review_apify_set_expected_address");
    const end = migration.indexOf("comment on function public.google_review_apify_set_expected_address");

    /*
     * THE SET CLAUSE ONLY. The function READS `apify_source_status` — that is
     * how it knows to leave a verified listing's note alone — and asserting
     * over the whole body would flag that read as if it were a write, which is
     * the opposite of what this test is for.
     */
    const body = migration.slice(start, end);
    const setClause = body.slice(
      body.indexOf("update public.google_review_locations"),
      body.indexOf("where l.id = v_row.id"),
    );

    /*
     * ASSIGNMENTS ONLY. Inside the set clause the function still READS
     * `l.apify_source_status`, which is how it knows to leave a verified
     * listing's note alone. Reads are qualified with the table alias and
     * assignments are written bare, so stripping every `l.<column>` leaves
     * exactly the columns this function writes.
     */
    const assignments = setClause.replace(/\bl\.[a-z_]+/g, "");

    expect(assignments.length).toBeGreaterThan(0);
    expect(assignments).toContain("expected_street_address =");
    expect(assignments).not.toMatch(/google_place_id\s*=/);
    expect(assignments).not.toMatch(/apify_source_status\s*=/);
    expect(assignments).not.toMatch(/canonical_google_(name|address)\s*=/);
    expect(assignments).not.toMatch(/discovered_(place_id|name|address)\s*=/);
    expect(assignments).not.toMatch(/counted_through_external_review_id\s*=/);
  });

  it("keeps the function away from the browser's own roles", () => {
    expect(migration).toContain(
      "revoke all on function public.google_review_apify_set_expected_address",
    );
    expect(migration).toContain(
      "revoke all on public.google_review_apify_locations from anon, authenticated",
    );
  });

  it("WRITES NOTHING TO A REVIEW, A PERIOD OR AN ANCHOR", () => {
    /*
     * `google_reviews` appears once, inside the rebuilt view's per-transport
     * count — a read. What must not appear anywhere is a write to it, or to
     * anything the reporting model depends on.
     */
    expect(migration).not.toMatch(/insert\s+into\s+public\.google_reviews/i);
    expect(migration).not.toMatch(/update\s+public\.google_reviews\b/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.google_reviews/i);
    expect(migration).not.toMatch(/\bdrop\s+table\b/i);
    expect(migration).not.toContain("google_review_periods");
    expect(migration).not.toContain("counted_through_external_review_id =");
    expect(migration).not.toContain("ingest_google_reviews");
  });
});
