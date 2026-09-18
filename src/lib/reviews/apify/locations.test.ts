import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GOOGLE_REVIEW_LOCATIONS } from "../store-codes";
import {
  chooseVerifiedCandidate,
  readPlaceIdFromInput,
  selectRunnableLocations,
  verifyPlaceCandidate,
} from "./locations";
import type { ApifyLocationMapping, ApifySourceStatus } from "./types";

/**
 * ============================================================================
 * WHICH GOOGLE LISTING EACH SALON IS — and every way that could go wrong
 * ============================================================================
 *
 * The failure this whole module exists to prevent has one shape: a stranger's
 * Google listing attached to a real salon, permanently, with nothing on the
 * dashboard looking broken. "Sun Tan City" is a franchise brand, so a name
 * match is not evidence, and two plausible candidates is not a tie to break.
 *
 * Every address below is invented.
 */

const repoRoot = process.cwd();

const migration = readFileSync(
  join(repoRoot, "supabase", "migrations", "20260918001000_google_review_apify_source.sql"),
  "utf8",
);

function mapping(overrides: Partial<ApifyLocationMapping> = {}): ApifyLocationMapping {
  return {
    storeCode: "306",
    salonNumber: "0462",
    locationName: "KS Manhattan",
    district: "Patterson, Madeline",
    googleLocationLabel: "Sun Tan City - KS Manhattan",
    listingState: "verified",
    isActive: true,
    googlePlaceId: "ChIJFIXTURE306Manhattan00",
    googleCid: null,
    googleMapsUrl: null,
    canonicalGoogleName: "Sun Tan City",
    canonicalGoogleAddress: "1234 N 3rd St, Manhattan, KS 66502",
    expectedState: "KS",
    expectedCity: "Manhattan",
    expectedStreetHint: null,
    sourceStatus: "verified",
    lastVerifiedAt: "2026-09-16T12:00:00.000Z",
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
    countingActive: true,
    reviewsTotal: 12,
    reviewsFromApify: 12,
    reviewsFromBrave: 0,
    latestPublishedAt: "2026-09-15T10:00:00.000Z",
    latestSeenAt: "2026-09-16T12:00:00.000Z",
    ...overrides,
  };
}

describe("the fifteen listings all have an expected city and state on record", () => {
  /**
   * WITHOUT AN EXPECTATION THERE IS NO VERIFICATION. A listing with no expected
   * city could only ever be checked on the brand, which would verify "some Sun
   * Tan City" — the exact outcome this is supposed to rule out. The migration's
   * seed is read AS TEXT for the same reason `store-codes.test.ts` reads the
   * other two copies: a salon added to one list and forgotten in another should
   * be a failing test, not a location that quietly stops importing.
   */
  const seeded = [
    ...migration.matchAll(/\('(\d{1,8})',\s*'([A-Z]{2})',\s*'([^']+)'\)/g),
  ].map((match) => ({ storeCode: match[1], state: match[2], city: match[3] }));

  it("seeds an expected city and state for exactly the fifteen store codes", () => {
    expect(seeded).toHaveLength(15);
    expect(seeded.map((entry) => entry.storeCode).sort()).toEqual(
      GOOGLE_REVIEW_LOCATIONS.map((entry) => entry.storeCode).sort(),
    );
  });

  it("every seeded state matches the state in the listing's own label", () => {
    for (const entry of seeded) {
      const listing = GOOGLE_REVIEW_LOCATIONS.find(
        (location) => location.storeCode === entry.storeCode,
      );
      expect(listing, `store code ${entry.storeCode}`).toBeDefined();
      /* "Sun Tan City - KS Manhattan" carries the state as its first token. */
      expect(listing?.googleLabel).toContain(`- ${entry.state} `);
    }
  });

  it("every seeded city appears in the listing's own label", () => {
    for (const entry of seeded) {
      const listing = GOOGLE_REVIEW_LOCATIONS.find(
        (location) => location.storeCode === entry.storeCode,
      );
      expect(listing?.googleLabel, `store code ${entry.storeCode}`).toContain(entry.city);
    }
  });

  it("305 is not one of them, and 306 is Manhattan rather than salon 0306", () => {
    /*
     * THE COLLISION, RESTATED HERE because this file writes the expectations a
     * Google listing is checked against, and getting it wrong would verify the
     * wrong salon's listing with full confidence.
     */
    const manhattan = seeded.find((entry) => entry.storeCode === "306");
    expect(manhattan?.city).toBe("Manhattan");
    expect(manhattan?.state).toBe("KS");
    /* ASK Sunny's 0306 is MO Kansas City Wornall, whose Google code is 140. */
    const wornall = seeded.find((entry) => entry.storeCode === "140");
    expect(wornall?.city).toBe("Kansas City");
    expect(wornall?.state).toBe("MO");
  });
});

describe("verifying one candidate against one listing", () => {
  const expected = { expectedState: "KS", expectedCity: "Manhattan", storeCode: "306" };

  it("accepts Google's own name and address when both line up", () => {
    const result = verifyPlaceCandidate(
      { title: "Sun Tan City", address: "1234 N 3rd St, Manhattan, KS 66502" },
      expected,
    );
    expect(result.outcome).toBe("verified");
  });

  it("rejects a business that is not Sun Tan City", () => {
    const result = verifyPlaceCandidate(
      { title: "Buff City Soap", address: "1234 N 3rd St, Manhattan, KS 66502" },
      expected,
    );
    expect(result.outcome).toBe("rejected");
  });

  it("REJECTS THE RIGHT BRAND IN THE WRONG STATE", () => {
    /*
     * Manhattan, Kansas and Manhattan, New York. A check on the city alone
     * passes this, which is why the state is checked as a separate word.
     */
    const result = verifyPlaceCandidate(
      { title: "Sun Tan City", address: "1234 Broadway, Manhattan, NY 10001" },
      expected,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.note).toContain("KS");
  });

  it("rejects the right brand in the right state and the wrong city", () => {
    const result = verifyPlaceCandidate(
      { title: "Sun Tan City", address: "500 Iowa St, Lawrence, KS 66044" },
      expected,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.note).toContain("Manhattan");
  });

  it("rejects rather than passes when there is nothing to check", () => {
    /*
     * "COULD NOT CHECK" AND "CHECKED AND IT WAS FINE" MUST NOT PRODUCE THE
     * SAME OUTCOME. Every one of these would otherwise verify on a technicality.
     */
    expect(verifyPlaceCandidate({ title: null, address: "…" }, expected).outcome).toBe(
      "rejected",
    );
    expect(
      verifyPlaceCandidate({ title: "Sun Tan City", address: null }, expected).outcome,
    ).toBe("rejected");
    expect(
      verifyPlaceCandidate(
        { title: "Sun Tan City", address: "1234 N 3rd St, Manhattan, KS 66502" },
        { expectedState: null, expectedCity: null, storeCode: "306" },
      ).outcome,
    ).toBe("rejected");
  });

  it("looks past punctuation and case", () => {
    const result = verifyPlaceCandidate(
      { title: "SUN TAN CITY", address: "9 N Belt Hwy, St. Joseph, MO 64506" },
      { expectedState: "MO", expectedCity: "St Joseph", storeCode: "409" },
    );
    expect(result.outcome).toBe("verified");
  });
});

describe("choosing between candidates", () => {
  const expected = { expectedState: "NE", expectedCity: "Omaha", storeCode: "147" };

  it("takes the one that passes", () => {
    const outcome = chooseVerifiedCandidate(
      [
        {
          placeId: "ChIJFIXTUREwrongbrand001",
          title: "Buff City Soap",
          address: "132nd and Maple, Omaha, NE 68164",
        },
        {
          placeId: "ChIJFIXTURE147Omaha132nd",
          title: "Sun Tan City",
          address: "3003 N 132nd St, Omaha, NE 68164",
        },
      ],
      expected,
    );
    expect(outcome.placeId).toBe("ChIJFIXTURE147Omaha132nd");
  });

  it("FAILS CLOSED WHEN TWO CANDIDATES FIT EQUALLY WELL", () => {
    /*
     * A real situation: a salon that moved, whose old listing was never
     * removed. A resolver that preferred the one with more reviews would be
     * right most of the time and silently wrong occasionally — and the occasion
     * surfaces as a stranger's one-star review in a district manager's number.
     */
    const outcome = chooseVerifiedCandidate(
      [
        {
          placeId: "ChIJFIXTURE147OmahaOldAA",
          title: "Sun Tan City",
          address: "3003 N 132nd St, Omaha, NE 68164",
        },
        {
          placeId: "ChIJFIXTURE147OmahaNewBB",
          title: "Sun Tan City",
          address: "3100 N 132nd St, Omaha, NE 68164",
        },
      ],
      expected,
    );

    expect(outcome.placeId).toBeNull();
    expect(outcome.result.outcome).toBe("rejected");
    expect(outcome.result.note).toContain("pick the right one by hand");
  });

  it("refuses when nothing matched, and says which case it was", () => {
    expect(chooseVerifiedCandidate([], expected).result.note).toContain("returned nothing");
    expect(
      chooseVerifiedCandidate(
        [{ placeId: "ChIJFIXTUREnothingfits1", title: "Somewhere Else", address: "x, IA" }],
        expected,
      ).result.note,
    ).toContain("None of the 1 candidates");
  });
});

describe("which listings a run may ask for", () => {
  const statuses: ApifySourceStatus[] = [
    "unconfigured",
    "pending_verification",
    "rejected",
  ];

  it.each(statuses)("skips a listing that is %s, and says why", (sourceStatus) => {
    const { locations, skipped } = selectRunnableLocations([
      mapping({ storeCode: "306", sourceStatus }),
    ]);

    expect(locations).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].storeCode).toBe("306");
  });

  it("skips an inactive listing without deleting anything it holds", () => {
    const { locations, skipped } = selectRunnableLocations([mapping({ isActive: false })]);
    expect(locations).toHaveLength(0);
    expect(skipped[0].reason).toBe("listing_inactive");
  });

  it("includes a verified listing and maps its place id to its store code", () => {
    const { locations, placeToStoreCode } = selectRunnableLocations([
      mapping(),
      mapping({
        storeCode: "144",
        salonNumber: "0310",
        googlePlaceId: "ChIJFIXTURE144Lincoln27th",
        expectedState: "NE",
        expectedCity: "Lincoln",
      }),
    ]);

    expect(locations.map((location) => location.storeCode)).toEqual(["306", "144"]);
    expect(placeToStoreCode.get("ChIJFIXTURE306Manhattan00")).toBe("306");
    expect(placeToStoreCode.get("ChIJFIXTURE144Lincoln27th")).toBe("144");
  });

  it("REFUSES TO LET TWO SALONS SHARE ONE GOOGLE LISTING", () => {
    /*
     * The unique constraint makes this unreachable through the normal path. It
     * is checked again because the consequence — one salon's customers showing
     * under another salon's name — is not one to leave to a constraint alone.
     */
    const { locations, skipped } = selectRunnableLocations([
      mapping({ storeCode: "306" }),
      mapping({ storeCode: "144", salonNumber: "0310" }),
    ]);

    expect(locations).toHaveLength(1);
    expect(skipped).toEqual([{ storeCode: "144", reason: "place_id_shared" }]);
  });
});

describe("reading an identifier out of what somebody pasted", () => {
  it("takes a bare Place ID", () => {
    expect(readPlaceIdFromInput("  ChIJFIXTURE306Manhattan00 ")).toBe(
      "ChIJFIXTURE306Manhattan00",
    );
  });

  it("takes one out of a URL, in either spelling Google uses", () => {
    /* A Maps share link says `place_id`; the Place ID Finder says
       `query_place_id`. Same value, so both are read. */
    expect(
      readPlaceIdFromInput("https://maps.google.com/?q=x&place_id=ChIJFIXTURE306Manhattan00"),
    ).toBe("ChIJFIXTURE306Manhattan00");
    expect(
      readPlaceIdFromInput(
        "https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJFIXTURE306Manhattan00",
      ),
    ).toBe("ChIJFIXTURE306Manhattan00");
  });

  it("REFUSES A MAPS URL THAT CARRIES A DIFFERENT KIND OF IDENTIFIER", () => {
    /*
     * A `/maps/place/…/data=…!1s0x…:0x…` URL holds an FID, which is a real,
     * stable Google identifier and NOT the one this column holds. Returning it
     * would produce a value that looks right and addresses nothing, failing at
     * run time with a message nobody can connect back to this paste.
     */
    expect(
      readPlaceIdFromInput(
        "https://www.google.com/maps/place/Sun+Tan+City/data=!4m6!3m5!1s0x87bd4c:0x9f1a2b!8m2",
      ),
    ).toBeNull();
    expect(readPlaceIdFromInput("")).toBeNull();
    expect(readPlaceIdFromInput("306")).toBeNull();
  });
});
