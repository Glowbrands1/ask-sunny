/**
 * ============================================================================
 * ONE PASTED ADDRESS, SPLIT INTO THE FIVE FIELDS THE SEARCH NEEDS
 * ============================================================================
 *
 * Typing a street, a city, a state, a ZIP and a country fifteen times is
 * seventy-five fields for information that is already on the clipboard in one
 * line. This takes the line.
 *
 * ============================================================================
 * IT REFUSES RATHER THAN GUESSES, AND THAT IS THE WHOLE DESIGN
 * ============================================================================
 *
 * A wrong street here is not a typo — it is what the Google search is built
 * from and what every candidate is checked against, so a plausible-looking
 * mis-parse produces a confident wrong mapping and files a stranger's reviews
 * into a district manager's weekly number.
 *
 * So every field this returns is one it could READ, and anything it could not
 * read comes back null with a sentence saying why. `confident` is false the
 * moment any part is doubtful, and the form then shows the pasted text and asks
 * for a correction instead of filling anything in.
 *
 * ============================================================================
 * WHAT IT DOES NOT DO
 * ============================================================================
 *
 * NO COUNTRY DEFAULT. "United States" is filled in by the caller, and only for
 * a salon already on record as trading in the United States. A parser that
 * assumed a country would be asserting a fact about a place it just failed to
 * read.
 *
 * NO SUITE STRIPPING. "Ste B" is part of what a person typed and is kept
 * verbatim. The MATCHER ignores the suite when comparing, which is a different
 * job done in a different place — dropping it here would lose it from the
 * record as well as from the comparison.
 *
 * Client-safe: pure functions of their inputs. No database client, no secret,
 * no `server-only` import, no network.
 */

/** The five fields, as the form holds them. Null is "could not read this". */
export interface ParsedAddress {
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  /**
   * WHETHER THE FORM MAY FILL FIELDS FROM THIS WITHOUT BEING ASKED TWICE.
   *
   * False does not mean nothing was read — the partial values are still
   * returned, because showing somebody "we got the city and not the street" is
   * more useful than showing them nothing. It means the form must present what
   * it read and wait.
   */
  confident: boolean;
  /** Plain sentences, in the order a person should read them. Never a code. */
  issues: string[];
}

/**
 * USPS codes, and the names that map to them.
 *
 * FULL NAMES ARE ACCEPTED BECAUSE GOOGLE RETURNS BOTH. A Maps copy is usually
 * "KS"; a browser's address autofill is often "Kansas". Neither should be the
 * one that fails.
 */
const STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const STATE_CODES = new Set(Object.values(STATES));

/** How the United States is written when it is written at all. */
const US_ALIASES = new Set([
  "united states",
  "united states of america",
  "usa",
  "us",
  "u s a",
  "u s",
]);

export const UNITED_STATES = "United States";

/** ZIP, or ZIP+4. Both are kept exactly as pasted. */
const POSTAL = /^(\d{5})(-\d{4})?$/;

/**
 * A Google plus-code, which is a location and NOT an address.
 *
 * "QX7V+2M Lawrence" is what Maps gives for a place with no street number. It
 * cannot become a street address, and turning one into a search string would
 * produce a query that matches nothing while looking like it should.
 */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

/** A street line has to start with a number, at least in the US roster. */
const STARTS_WITH_NUMBER = /^\d/;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** The two-letter code for a state written either way, or null. */
export function normaliseState(value: string): string | null {
  const cleaned = tidy(value).replace(/\.$/, "");
  if (cleaned.length === 0) return null;

  /*
   * A TWO-LETTER TOKEN IS ACCEPTED ONLY IF IT IS A REAL CODE. "Ks" is Kansas;
   * "Xq" is a misreading of something else, and returning it uppercased would
   * put a state on the record that does not exist.
   */
  if (cleaned.length === 2 && STATE_CODES.has(cleaned.toUpperCase())) {
    return cleaned.toUpperCase();
  }

  return STATES[cleaned.toLowerCase()] ?? null;
}

/**
 * Split one pasted address into its parts.
 *
 * ============================================================================
 * IT READS FROM THE RIGHT, BECAUSE THE RIGHT IS THE PART THAT IS REGULAR
 * ============================================================================
 *
 * A US address ends "city, STATE ZIP, country". Those three are recognisable by
 * shape: a country from a short list, a state from a fixed set, a ZIP from five
 * digits. The street is whatever is left — which is the right way round, because
 * the street is the part with no rules at all ("2624 Iowa St Ste B", "Hwy 24 &
 * Seth Child", "Unit 3, The Pavilion").
 *
 * So the country comes off the end, then the state and ZIP, then the city, and
 * everything still standing is the street. Reading left to right would mean
 * deciding where the street stops, which is the one judgement nothing can make
 * reliably.
 */
export function parseGoogleAddress(raw: string): ParsedAddress {
  const empty: ParsedAddress = {
    streetAddress: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
    confident: false,
    issues: [],
  };

  /*
   * THE NEWLINES BECOME COMMAS BEFORE ANYTHING ELSE TOUCHES THEM. A pasted
   * block of lines is the same address with line breaks where the commas go,
   * and `tidy` collapses all whitespace — so tidying first would turn the line
   * breaks into spaces and leave one unsplittable segment.
   */
  const text = tidy((raw ?? "").replace(/[\r\n]+/g, ","));
  if (text.length === 0) {
    return { ...empty, issues: ["Nothing was pasted."] };
  }

  const segments = text
    .split(",")
    .map(tidy)
    .filter((segment) => segment.length > 0);

  /*
   * A PLUS-CODE ARRIVES WITH ITS TOWN ATTACHED — "QX7V+2M Lawrence" — so the
   * test is on the first word of a segment rather than the whole of it.
   */
  if (segments.some((segment) => PLUS_CODE.test(segment.split(" ")[0]))) {
    return {
      ...empty,
      issues: [
        "That looks like a Google plus-code rather than a street address. Open the listing in Google Maps and copy the address line beneath the name.",
      ],
    };
  }

  if (segments.length < 2) {
    return {
      ...empty,
      streetAddress: segments[0] ?? null,
      issues: [
        "An address needs at least a street and a city, separated by commas. Paste the whole line as Google shows it.",
      ],
    };
  }

  const issues: string[] = [];
  const rest = [...segments];

  /* ------------------------------------------------------ the country -- */

  let country: string | null = null;
  const last = rest[rest.length - 1];

  if (US_ALIASES.has(last.toLowerCase().replace(/\./g, ""))) {
    country = UNITED_STATES;
    rest.pop();
  } else if (rest.length >= 4 && !/\d/.test(last) && normaliseState(last) === null) {
    /*
     * A FOURTH SEGMENT WITH NO DIGITS AND NO STATE IN IT is a country we do not
     * recognise. It is kept verbatim rather than discarded or corrected: the
     * roster is American today, and the day it is not, a wrong guess here would
     * be worse than an unfamiliar string somebody can see and fix.
     */
    country = last;
    rest.pop();
  }

  /* ------------------------------------------------- the state and ZIP -- */

  if (rest.length < 2) {
    return {
      ...empty,
      country,
      streetAddress: rest[0] ?? null,
      issues: [
        "The city and state could not be read. Paste the whole address, for example: 2624 Iowa St Ste B, Lawrence, KS 66046, United States.",
      ],
    };
  }

  const stateSegment = rest.pop() as string;
  const words = stateSegment.split(" ");

  let postalCode: string | null = null;
  let stateWords = words;

  const tail = words[words.length - 1];
  if (POSTAL.test(tail)) {
    postalCode = tail;
    stateWords = words.slice(0, -1);
  } else if (/^\d+$/.test(tail)) {
    /* Digits that are not a ZIP are named rather than silently dropped. */
    issues.push(`"${tail}" is not a five-digit ZIP, so no postcode was filled in.`);
    stateWords = words.slice(0, -1);
  }

  const state = stateWords.length > 0 ? normaliseState(stateWords.join(" ")) : null;

  if (state === null) {
    issues.push(
      stateWords.length > 0
        ? `"${stateWords.join(" ")}" is not a state this recognises, so the state was left blank.`
        : "No state could be read from the pasted address.",
    );
  }

  /* -------------------------------------------- the city and the street -- */

  const city = rest.length > 0 ? (rest.pop() as string) : null;
  if (city === null) issues.push("No city could be read from the pasted address.");

  /*
   * EVERYTHING LEFT IS THE STREET, rejoined with the commas it was split on.
   * Google splits a suite onto its own segment often enough that treating only
   * the first as the street would quietly drop it.
   */
  const streetAddress = rest.length > 0 ? rest.join(", ") : null;

  if (streetAddress === null) {
    issues.push("No street address could be read from the pasted address.");
  } else if (!STARTS_WITH_NUMBER.test(streetAddress)) {
    /*
     * A STREET THAT DOES NOT START WITH A NUMBER is usually a business name
     * Google put in front of the address — "Sun Tan City, 2624 Iowa St, …" —
     * and accepting it would search for the brand twice and the building never.
     * It is reported rather than trimmed, because a genuine unnumbered address
     * exists and this cannot tell the two apart.
     */
    issues.push(
      `"${streetAddress}" does not begin with a street number. If the listing's name got copied along with the address, remove it and paste again.`,
    );
  }

  return {
    streetAddress,
    city,
    state,
    postalCode,
    country,
    confident: issues.length === 0 && streetAddress !== null && city !== null && state !== null,
    issues,
  };
}

/** One field's before and after, for the preview a person confirms. */
export interface AddressFieldChange {
  field: keyof Omit<ParsedAddress, "confident" | "issues">;
  label: string;
  from: string;
  to: string;
  /** True when this would replace something a person had already put there. */
  overwrites: boolean;
}

const FIELD_LABELS: { field: AddressFieldChange["field"]; label: string }[] = [
  { field: "streetAddress", label: "Street address" },
  { field: "city", label: "City" },
  { field: "state", label: "State" },
  { field: "postalCode", label: "ZIP" },
  { field: "country", label: "Country" },
];

/**
 * What applying a parse would actually change.
 *
 * ============================================================================
 * NOTHING IS REPLACED WITHOUT BEING SHOWN FIRST
 * ============================================================================
 *
 * The form fills empty fields from a confident parse straight away, because
 * that is the whole point and the result is visible in the fields themselves.
 * REPLACING SOMETHING SOMEBODY ALREADY TYPED IS DIFFERENT: they put it there on
 * purpose, and a paste that quietly overwrote it would be a data loss nobody
 * saw. So this reports every change, marks the ones that overwrite, and the
 * form holds those behind a confirmation.
 *
 * A FIELD THE PARSE COULD NOT READ IS NOT A CHANGE. Null means "I did not read
 * this", never "clear what is there" — otherwise a partial paste would empty
 * the fields it failed on.
 */
export function addressChanges(
  parsed: ParsedAddress,
  current: Record<AddressFieldChange["field"], string>,
): AddressFieldChange[] {
  const changes: AddressFieldChange[] = [];

  for (const { field, label } of FIELD_LABELS) {
    const to = parsed[field];
    if (to === null) continue;

    const from = current[field] ?? "";
    if (tidy(from) === tidy(to)) continue;

    changes.push({ field, label, from, to, overwrites: tidy(from).length > 0 });
  }

  return changes;
}
