import { describe, expect, it } from "vitest";

import {
  addressChanges,
  normaliseState,
  parseGoogleAddress,
  UNITED_STATES,
} from "./address-parse";

/**
 * ============================================================================
 * SPLITTING ONE PASTED LINE INTO FIVE FIELDS, AND REFUSING WHEN IT CANNOT
 * ============================================================================
 *
 * Seventy-five fields of typing for information that is already on the
 * clipboard is the thing this removes. What it must not do is guess.
 *
 * A wrong street here is not a typo: it is what the Google search is BUILT from
 * and what every candidate is CHECKED against, so a plausible mis-parse
 * produces a confident wrong mapping and files a stranger's reviews into a
 * district manager's weekly number. Every test below is either "it read this
 * correctly" or "it refused and said why".
 *
 * Every address below is invented except for the shapes Google actually emits.
 */

describe("the shapes Google actually returns", () => {
  it("reads the full four-part address", () => {
    const parsed = parseGoogleAddress("2624 Iowa St Ste B, Lawrence, KS 66046, United States");

    expect(parsed).toMatchObject({
      streetAddress: "2624 Iowa St Ste B",
      city: "Lawrence",
      state: "KS",
      postalCode: "66046",
      country: UNITED_STATES,
      confident: true,
    });
    expect(parsed.issues).toEqual([]);
  });

  it("reads it without the country, which is how Maps usually copies", () => {
    const parsed = parseGoogleAddress("2624 Iowa St Ste B, Lawrence, KS 66046");

    expect(parsed.streetAddress).toBe("2624 Iowa St Ste B");
    expect(parsed.city).toBe("Lawrence");
    expect(parsed.state).toBe("KS");
    expect(parsed.postalCode).toBe("66046");
    /*
     * NO COUNTRY IS INVENTED. The form fills "United States" for a salon
     * already on record as trading there; a parser that assumed one would be
     * asserting a fact about a place it just failed to read.
     */
    expect(parsed.country).toBeNull();
    expect(parsed.confident).toBe(true);
  });

  it("accepts the USA spellings", () => {
    for (const country of ["USA", "U.S.A.", "US", "United States of America"]) {
      const parsed = parseGoogleAddress(`100 Main St, Topeka, KS 66603, ${country}`);
      expect(parsed.country, country).toBe(UNITED_STATES);
    }
  });

  it("KEEPS THE SUITE, because it is part of what a person typed", () => {
    /*
     * The MATCHER ignores the suite when comparing — Google omits it more often
     * than it carries it — but that is a different job in a different place.
     * Dropping it here would lose it from the record as well as the comparison.
     */
    expect(parseGoogleAddress("100 Main St Ste 200, Omaha, NE 68102").streetAddress).toBe(
      "100 Main St Ste 200",
    );
    expect(parseGoogleAddress("100 Main St #4, Omaha, NE 68102").streetAddress).toBe(
      "100 Main St #4",
    );
  });

  it("rejoins a suite Google split onto its own segment", () => {
    /*
     * "2624 Iowa St, Ste B, Lawrence, KS 66046" is four segments, and taking
     * only the first as the street would quietly drop the suite.
     */
    const parsed = parseGoogleAddress("2624 Iowa St, Ste B, Lawrence, KS 66046");

    expect(parsed.streetAddress).toBe("2624 Iowa St, Ste B");
    expect(parsed.city).toBe("Lawrence");
    expect(parsed.confident).toBe(true);
  });

  it("reads a block pasted across lines", () => {
    const parsed = parseGoogleAddress(
      "2624 Iowa St Ste B\nLawrence, KS 66046\nUnited States",
    );

    expect(parsed.streetAddress).toBe("2624 Iowa St Ste B");
    expect(parsed.city).toBe("Lawrence");
    expect(parsed.state).toBe("KS");
    expect(parsed.country).toBe(UNITED_STATES);
    expect(parsed.confident).toBe(true);
  });

  it("supports ZIP and ZIP+4, exactly as pasted", () => {
    expect(parseGoogleAddress("100 Main St, Omaha, NE 68102").postalCode).toBe("68102");
    expect(parseGoogleAddress("100 Main St, Omaha, NE 68102-1234").postalCode).toBe(
      "68102-1234",
    );
  });

  it("tolerates loose spacing and a trailing comma", () => {
    const parsed = parseGoogleAddress("  100   Main St ,  Omaha ,  NE  68102 ,  ");
    expect(parsed.streetAddress).toBe("100 Main St");
    expect(parsed.city).toBe("Omaha");
    expect(parsed.postalCode).toBe("68102");
  });
});

describe("the state, normalised where it is safe to", () => {
  it("takes the two-letter code as it stands", () => {
    expect(normaliseState("KS")).toBe("KS");
    expect(normaliseState("ks")).toBe("KS");
    expect(normaliseState("Ne.")).toBe("NE");
  });

  it("converts a spelled-out state, which autofill produces", () => {
    expect(normaliseState("Kansas")).toBe("KS");
    expect(normaliseState("nebraska")).toBe("NE");
    expect(normaliseState("District of Columbia")).toBe("DC");
    expect(normaliseState("New Hampshire")).toBe("NH");
  });

  it("REFUSES A TWO-LETTER TOKEN THAT IS NOT A REAL STATE", () => {
    /*
     * Upper-casing whatever turned up would put a state on the record that does
     * not exist, and the search would then look for a place in it.
     */
    expect(normaliseState("XQ")).toBeNull();
    expect(normaliseState("Kansa")).toBeNull();
    expect(normaliseState("")).toBeNull();
  });

  it("normalises the state inside a full parse", () => {
    const parsed = parseGoogleAddress("100 Main St, Lawrence, Kansas 66046");
    expect(parsed.state).toBe("KS");
    expect(parsed.confident).toBe(true);
  });
});

describe("what it refuses to guess at", () => {
  it("says so when nothing was pasted", () => {
    const parsed = parseGoogleAddress("   ");
    expect(parsed.confident).toBe(false);
    expect(parsed.issues[0]).toContain("Nothing was pasted");
  });

  it("REFUSES A PLUS-CODE, which is a location and not an address", () => {
    /*
     * "QX7V+2M Lawrence" is what Maps shows for a place with no street number.
     * It cannot become a street address, and a search built from one matches
     * nothing while looking like it should.
     */
    const parsed = parseGoogleAddress("QX7V+2M Lawrence, KS, United States");

    expect(parsed.confident).toBe(false);
    expect(parsed.streetAddress).toBeNull();
    expect(parsed.issues[0]).toContain("plus-code");
  });

  it("asks for the whole line when given one segment", () => {
    const parsed = parseGoogleAddress("2624 Iowa St");

    expect(parsed.confident).toBe(false);
    /* What it did read is still returned, so the person can see how far it got. */
    expect(parsed.streetAddress).toBe("2624 Iowa St");
    expect(parsed.issues[0]).toContain("at least a street and a city");
  });

  it("NAMES A BUSINESS NAME COPIED IN FRONT OF THE ADDRESS", () => {
    /*
     * "Sun Tan City, 2624 Iowa St, Lawrence, KS 66046" is the single most
     * likely bad paste, because it is what selecting the whole Maps panel
     * gives. Accepting it would search for the brand twice and the building
     * never. It is reported rather than trimmed: an unnumbered street address
     * is a real thing and this cannot tell the two apart.
     */
    const parsed = parseGoogleAddress("Sun Tan City, 2624 Iowa St, Lawrence, KS 66046");

    expect(parsed.confident).toBe(false);
    expect(parsed.issues.join(" ")).toContain("does not begin with a street number");
    expect(parsed.city).toBe("Lawrence");
  });

  it("leaves the state blank and says so when it cannot read one", () => {
    const parsed = parseGoogleAddress("100 Main St, Lawrence, Kanas 66046");

    expect(parsed.confident).toBe(false);
    expect(parsed.state).toBeNull();
    /* Everything it COULD read is still offered. */
    expect(parsed.streetAddress).toBe("100 Main St");
    expect(parsed.city).toBe("Lawrence");
    expect(parsed.postalCode).toBe("66046");
    expect(parsed.issues.join(" ")).toContain("not a state this recognises");
  });

  it("names a number that is not a ZIP rather than storing it as one", () => {
    const parsed = parseGoogleAddress("100 Main St, Lawrence, KS 660");

    expect(parsed.postalCode).toBeNull();
    expect(parsed.state).toBe("KS");
    expect(parsed.issues.join(" ")).toContain("not a five-digit ZIP");
    expect(parsed.confident).toBe(false);
  });

  it("keeps an unfamiliar country verbatim rather than correcting it", () => {
    /*
     * The roster is American today. The day it is not, an unfamiliar string
     * somebody can see and fix beats a confident wrong guess.
     */
    const parsed = parseGoogleAddress("12 Bay St, Toronto, ON M5H 4A1, Canada");
    expect(parsed.country).toBe("Canada");
  });
});

describe("what applying a parse would change", () => {
  const blank = {
    streetAddress: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  };

  it("lists every field it would fill", () => {
    const parsed = parseGoogleAddress("2624 Iowa St, Lawrence, KS 66046, United States");
    const changes = addressChanges(parsed, blank);

    expect(changes.map((change) => change.field)).toEqual([
      "streetAddress",
      "city",
      "state",
      "postalCode",
      "country",
    ]);
    expect(changes.every((change) => change.overwrites === false)).toBe(true);
  });

  it("MARKS THE ONES THAT WOULD REPLACE SOMETHING SOMEBODY TYPED", () => {
    /*
     * They put it there on purpose. A paste that quietly overwrote it would be
     * a data loss nobody saw, so the form holds these behind a confirmation.
     */
    const parsed = parseGoogleAddress("2624 Iowa St, Lawrence, KS 66046");
    const changes = addressChanges(parsed, {
      ...blank,
      city: "Manhattan",
      state: "KS",
    });

    const city = changes.find((change) => change.field === "city");
    expect(city?.overwrites).toBe(true);
    expect(city?.from).toBe("Manhattan");
    expect(city?.to).toBe("Lawrence");

    /* A field that already agrees is not a change at all. */
    expect(changes.some((change) => change.field === "state")).toBe(false);
  });

  it("NEVER CLEARS A FIELD THE PARSE COULD NOT READ", () => {
    /*
     * Null means "I did not read this", never "empty what is there" —
     * otherwise a partial paste would wipe the fields it failed on.
     */
    const parsed = parseGoogleAddress("100 Main St, Lawrence, Kanas 66046");
    const changes = addressChanges(parsed, { ...blank, state: "KS" });

    expect(parsed.state).toBeNull();
    expect(changes.some((change) => change.field === "state")).toBe(false);
  });

  it("ignores a difference that is only whitespace", () => {
    const parsed = parseGoogleAddress("100 Main St, Lawrence, KS 66046");
    const changes = addressChanges(parsed, { ...blank, streetAddress: "  100 Main St " });

    expect(changes.some((change) => change.field === "streetAddress")).toBe(false);
  });
});
