import { describe, expect, it } from "vitest";

import { addressMatch, resolveDiscovery, stripBrandPrefix } from "./discovery";
import type { ApifyLocationMapping } from "./types";

/**
 * ============================================================================
 * THE FIFTEEN REAL SALONS, AGAINST THE REAL DATASET THAT MATCHED NONE OF THEM
 * ============================================================================
 *
 * Apify run `EcV1gU3LYUWfarNfO` returned nineteen place records: the fifteen
 * Sun Tan City salons ASK Sunny covers, and four in New Hampshire and Maine
 * that this business does not operate. The matcher returned ZERO.
 *
 * Every address below is the real one, and every one of them failed. The trace
 * found four separate defects stacked on top of each other, each of which was
 * on its own enough to reject all fifteen:
 *
 *   THE STATE. The roster stores "MO"; the Actor returns "Missouri". The old
 *   check compared them as text and searched the address for `\bmo\b`, so both
 *   arms failed on every record — and the state is tested BEFORE the street, so
 *   fifteen perfect address matches were refused as `wrong_state` and reported
 *   as "not found". This was the bug.
 *
 *   THE BRAND IN THE EXPECTED STREET. Copying a listing out of Maps takes the
 *   name with it: "Sun Tan City, 8420 Wornall Rd" normalises to a street with
 *   NO HOUSE NUMBER, which can never equal "8420 wornall road".
 *
 *   THE HOUSE NUMBER READ AS A POSTCODE. "13110 Birch Dr #120, Omaha, Nebraska"
 *   carries no postcode, but a five-digit search found 13110 and compared it
 *   against 68164. Three salons on streets numbered in the ten thousands were
 *   refused for a contradiction that did not exist.
 *
 *   THE TRAILING SUITE LETTER. "2624 Iowa St B" and "2624 Iowa St" are one
 *   door; Google prints the letter sometimes and omits it others.
 *
 * The store codes, salon numbers and addresses here are real. GOOGLE 306 IS
 * SALON 0462, never 0306 — no arithmetic connects the two systems.
 */

interface Salon {
  storeCode: string;
  salonNumber: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string | null;
}

/** The roster, with expected addresses as they now stand after the cleanup. */
const ROSTER: Salon[] = [
  { storeCode: "140", salonNumber: "0306", name: "MO Kansas City Wornall", street: "8420 Wornall Rd", city: "Kansas City", state: "MO", zip: "64114" },
  { storeCode: "141", salonNumber: "0307", name: "NE Grand Island", street: "201 Wilmar Ave", city: "Grand Island", state: "NE", zip: "68803" },
  { storeCode: "143", salonNumber: "0308", name: "NE Kearney", street: "5012 3rd Ave Ste 130", city: "Kearney", state: "NE", zip: "68845" },
  { storeCode: "144", salonNumber: "0310", name: "NE Lincoln 27th Street", street: "2720 Dan Ave", city: "Lincoln", state: "NE", zip: "68521" },
  { storeCode: "145", salonNumber: "0311", name: "NE Lincoln O Street", street: "6900 O St Ste 111", city: "Lincoln", state: "NE", zip: "68510" },
  { storeCode: "146", salonNumber: "0312", name: "NE Lincoln Pine Lake", street: "1501 Pine Lake Rd #6", city: "Lincoln", state: "NE", zip: "68512" },
  { storeCode: "147", salonNumber: "0313", name: "NE Omaha 132nd and Maple", street: "13110 Birch Dr #120", city: "Omaha", state: "NE", zip: "68164" },
  { storeCode: "148", salonNumber: "0314", name: "NE Omaha 144th and Center", street: "14516 W Center Rd", city: "Omaha", state: "NE", zip: "68144" },
  { storeCode: "231", salonNumber: "0409", name: "MO Kansas City Liberty", street: "8646 NE Flintlock Rd", city: "Kansas City", state: "MO", zip: "64158" },
  { storeCode: "254", salonNumber: "0431", name: "NE Omaha Pacific", street: "1110 S 71st St G", city: "Omaha", state: "NE", zip: "68106" },
  { storeCode: "306", salonNumber: "0462", name: "KS Manhattan", street: "1100 Westloop Pl", city: "Manhattan", state: "KS", zip: "66502" },
  { storeCode: "307", salonNumber: "0463", name: "KS Shawnee Mission Pkwy", street: "12268 Shawnee Mission Pkwy", city: "Shawnee", state: "KS", zip: null },
  { storeCode: "314", salonNumber: "0466", name: "KS Lawrence", street: "2624 Iowa St B", city: "Lawrence", state: "KS", zip: "66046" },
  { storeCode: "373", salonNumber: "0480", name: "KS Overland Park", street: "13737 Metcalf Ave", city: "Overland Park", state: "KS", zip: "66223" },
  { storeCode: "409", salonNumber: "0495", name: "MO St Joseph", street: "409 N Belt Hwy B", city: "St Joseph", state: "MO", zip: "64506" },
];

/**
 * The dataset as the extractor returns it.
 *
 * FULL STATE NAMES AND NO POSTCODE — that is what the Actor gives, and both
 * facts are what the old matcher could not survive. The Place ID lives only in
 * the URL.
 */
const STATE_NAMES: Record<string, string> = { KS: "Kansas", MO: "Missouri", NE: "Nebraska" };

function record(salon: Salon, index: number): Record<string, unknown> {
  return {
    title: index % 3 === 0 ? "Sun Tan City" : `Sun Tan City - ${salon.name}`,
    address: `${salon.street}, ${salon.city}, ${STATE_NAMES[salon.state]}`,
    street: salon.street,
    city: salon.city,
    state: STATE_NAMES[salon.state],
    countryCode: "US",
    url: `https://www.google.com/maps/search/?api=1&query=Sun%20Tan%20City&query_place_id=ChIJreal${String(index).padStart(15, "0")}`,
  };
}

/** The four the business does not operate, which must never attach. */
const ELSEWHERE: Record<string, unknown>[] = [
  { title: "Sun Tan City", address: "20 Ash Brook Rd, Keene, New Hampshire", city: "Keene", state: "New Hampshire", url: "https://www.google.com/maps/search/?api=1&query_place_id=ChIJkeene00000000000001" },
  { title: "Sun Tan City", address: "440 Alfred St, Biddeford, Maine", city: "Biddeford", state: "Maine", url: "https://www.google.com/maps/search/?api=1&query_place_id=ChIJbiddeford000000001" },
  { title: "Sun Tan City", address: "419 S Broadway, Salem, New Hampshire", city: "Salem", state: "New Hampshire", url: "https://www.google.com/maps/search/?api=1&query_place_id=ChIJsalem00000000000001" },
  { title: "Sun Tan City", address: "1364 Main St, Sanford, Maine", city: "Sanford", state: "Maine", url: "https://www.google.com/maps/search/?api=1&query_place_id=ChIJsanford0000000001" },
];

function location(salon: Salon): ApifyLocationMapping {
  return {
    storeCode: salon.storeCode,
    salonNumber: salon.salonNumber,
    locationName: salon.name,
    district: null,
    googleLocationLabel: `Sun Tan City - ${salon.name}`,
    listingState: "verified",
    isActive: true,
    googlePlaceId: null,
    googleCid: null,
    googleMapsUrl: null,
    canonicalGoogleName: null,
    canonicalGoogleAddress: null,
    expectedStreetAddress: salon.street,
    expectedCity: salon.city,
    expectedState: salon.state,
    expectedPostalCode: salon.zip,
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
  };
}

const LOCATIONS = ROSTER.map(location);
const DATASET = [...ROSTER.map(record), ...ELSEWHERE];

/* ------------------------------------------------- the whole nineteen -- */

describe("the real dataset, against the real roster", () => {
  const outcomes = resolveDiscovery(LOCATIONS, DATASET);

  it("MATCHES ALL FIFTEEN", () => {
    const found = outcomes.filter((outcome) => outcome.status === "candidate_found");
    expect(found).toHaveLength(15);
  });

  for (const [index, salon] of ROSTER.entries()) {
    it(`maps ${salon.storeCode} — ${salon.name}`, () => {
      const outcome = outcomes.find((item) => item.storeCode === salon.storeCode);

      expect(outcome?.status).toBe("candidate_found");
      expect(outcome?.candidate?.placeId).toBe(`ChIJreal${String(index).padStart(15, "0")}`);
      expect(outcome?.candidate?.address).toContain(salon.street);
    });
  }

  it("REJECTS ALL FOUR NEW HAMPSHIRE AND MAINE LISTINGS", () => {
    /*
     * "Sun Tan City" is a franchise brand. Attaching one of these to a real
     * salon would file a stranger's reviews into a district manager's weekly
     * number, permanently, with nothing on the dashboard looking wrong.
     */
    const attached = outcomes
      .map((outcome) => outcome.candidate?.placeId)
      .filter((id): id is string => typeof id === "string");

    for (const stranger of ["ChIJkeene00000000000001", "ChIJbiddeford000000001", "ChIJsalem00000000000001", "ChIJsanford0000000001"]) {
      expect(attached, stranger).not.toContain(stranger);
    }
  });

  it("separates the three Lincoln salons, which share a city and a state", () => {
    const ids = ["144", "145", "146"].map(
      (code) => outcomes.find((outcome) => outcome.storeCode === code)?.candidate?.placeId,
    );

    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
  });

  it("separates the three Omaha salons", () => {
    const ids = ["147", "148", "254"].map(
      (code) => outcomes.find((outcome) => outcome.storeCode === code)?.candidate?.placeId,
    );

    expect(new Set(ids).size).toBe(3);
  });

  it("separates the two Kansas City salons", () => {
    const ids = ["140", "231"].map(
      (code) => outcomes.find((outcome) => outcome.storeCode === code)?.candidate?.placeId,
    );

    expect(new Set(ids).size).toBe(2);
  });
});

/* ------------------------------------------ each defect, on its own ----- */

describe("the state, spelled either way", () => {
  const salon = ROSTER.find((entry) => entry.storeCode === "140") as Salon;

  it("MATCHES \"MO\" AGAINST \"Missouri\" — the predicate that rejected all fifteen", () => {
    const verdict = addressMatch(
      {
        placeId: "ChIJstate0000000000001",
        title: "Sun Tan City",
        address: "8420 Wornall Rd, Kansas City, Missouri",
        street: "8420 Wornall Rd",
        city: "Kansas City",
        state: "Missouri",
        postalCode: null,
        cid: null,
        mapsUrl: null,
        permanentlyClosed: false,
        temporarilyClosed: false,
        searchString: null,
      },
      location(salon),
    );

    expect(verdict.reason).not.toBe("wrong_state");
    expect(verdict.strength).toBe("strong");
  });

  it("still refuses a genuinely different state", () => {
    const verdict = addressMatch(
      {
        placeId: "ChIJstate0000000000002",
        title: "Sun Tan City",
        address: "8420 Wornall Rd, Kansas City, Kansas",
        street: "8420 Wornall Rd",
        city: "Kansas City",
        state: "Kansas",
        postalCode: null,
        cid: null,
        mapsUrl: null,
        permanentlyClosed: false,
        temporarilyClosed: false,
        searchString: null,
      },
      location(salon),
    );

    expect(verdict.reason).toBe("wrong_state");
  });
});

describe("the brand in front of an expected street", () => {
  it("strips it when a house number follows", () => {
    expect(stripBrandPrefix("Sun Tan City, 8420 Wornall Rd")).toBe("8420 Wornall Rd");
    expect(stripBrandPrefix("Sun Tan City - NE Kearney, 5012 3rd Ave Ste 130")).toBe(
      "5012 3rd Ave Ste 130",
    );
  });

  it("LEAVES A SUITE AFTER A COMMA ALONE, which is not a brand prefix", () => {
    expect(stripBrandPrefix("2624 Iowa St, Ste B")).toBe("2624 Iowa St, Ste B");
  });

  it("leaves an address with no brand in it alone", () => {
    expect(stripBrandPrefix("Wendover House, 12 High St")).toBe("Wendover House, 12 High St");
  });

  it("leaves it alone when what follows is not a street number", () => {
    expect(stripBrandPrefix("Sun Tan City, near the mall")).toBe("Sun Tan City, near the mall");
  });
});

describe("a missing postcode is not a mismatch", () => {
  const salon = ROSTER.find((entry) => entry.storeCode === "147") as Salon;

  const candidate = (address: string, postalCode: string | null) => ({
    placeId: "ChIJpostal000000000001",
    title: "Sun Tan City",
    address,
    street: "13110 Birch Dr #120",
    city: "Omaha",
    state: "Nebraska",
    postalCode,
    cid: null,
    mapsUrl: null,
    permanentlyClosed: false,
    temporarilyClosed: false,
    searchString: null,
  });

  it("DOES NOT READ THE HOUSE NUMBER AS A POSTCODE", () => {
    /*
     * 13110 is the building, not the ZIP. Three salons on streets numbered in
     * the ten thousands were refused for a contradiction that did not exist.
     */
    const verdict = addressMatch(
      candidate("13110 Birch Dr #120, Omaha, Nebraska", null),
      location(salon),
    );

    expect(verdict.reason).not.toBe("postal_conflict");
    expect(verdict.strength).toBe("strong");
  });

  it("still refuses two postcodes that genuinely disagree", () => {
    const verdict = addressMatch(
      candidate("13110 Birch Dr #120, Omaha, Nebraska 68999", "68999"),
      location(salon),
    );

    expect(verdict.reason).toBe("postal_conflict");
  });

  it("counts a postcode that agrees as the stronger evidence", () => {
    const verdict = addressMatch(
      candidate("13110 Birch Dr #120, Omaha, Nebraska 68164", "68164"),
      location(salon),
    );

    expect(verdict.strength).toBe("exact");
  });
});

describe("the suite, however it is written", () => {
  const salon = ROSTER.find((entry) => entry.storeCode === "314") as Salon;

  const candidate = (street: string) => ({
    placeId: "ChIJsuite0000000000001",
    title: "Sun Tan City",
    address: `${street}, Lawrence, Kansas`,
    street,
    city: "Lawrence",
    state: "Kansas",
    postalCode: null,
    cid: null,
    mapsUrl: null,
    permanentlyClosed: false,
    temporarilyClosed: false,
    searchString: null,
  });

  for (const spelling of ["2624 Iowa St B", "2624 Iowa St Ste B", "2624 Iowa St Suite B", "2624 Iowa St #B", "2624 Iowa Street"]) {
    it(`accepts "${spelling}"`, () => {
      expect(addressMatch(candidate(spelling), location(salon)).strength).toBe("strong");
    });
  }

  it("STILL REFUSES A DIFFERENT BUILDING ON THE SAME STREET", () => {
    /* The house number is the one part of an address with no synonyms. */
    expect(addressMatch(candidate("2626 Iowa St B"), location(salon)).reason).toBe(
      "wrong_street_address",
    );
  });
});

describe("the title only has to establish the brand", () => {
  const salon = ROSTER.find((entry) => entry.storeCode === "306") as Salon;

  const candidate = (title: string) => ({
    placeId: "ChIJtitle0000000000001",
    title,
    address: "1100 Westloop Pl, Manhattan, Kansas",
    street: "1100 Westloop Pl",
    city: "Manhattan",
    state: "Kansas",
    postalCode: null,
    cid: null,
    mapsUrl: null,
    permanentlyClosed: false,
    temporarilyClosed: false,
    searchString: null,
  });

  for (const title of ["Sun Tan City", "Sun Tan City - KS Manhattan", "Sun Tan City — Manhattan"]) {
    it(`accepts the title "${title}"`, () => {
      expect(addressMatch(candidate(title), location(salon)).strength).toBe("strong");
    });
  }
});
