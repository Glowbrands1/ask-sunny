import "server-only";

import { PRODUCTION_SALONS, type ProductionSalon } from "@/data/salons";
import { storeNameKey } from "@/lib/reporting/store-identity";

import { salonForTypedNumber, salonsForTypedNumber } from "./salon-text";

/**
 * ============================================================================
 * WHICH SALON THE MANAGER NAMED, READ FROM THEIR OWN WORDS
 * ============================================================================
 *
 * A CANDIDATE SET, NEVER A DECISION. This module says which roster salons a
 * mention could mean; `proposeLocation` intersects that with the salons the
 * AUTHENTICATED SCOPE proves, and `POST /api/forms/instances` re-authorizes
 * whatever comes back. Nothing here widens who may file where.
 *
 * NORMALIZED THE WAY REPORTING NORMALIZES. `storeNameKey` is the same key the
 * reporting ingest matches store names on — case, spacing, `&`/`and`, commas,
 * periods — so "Lincoln O. Street" and "lincoln o street" are one salon here
 * exactly as they are one salon in a report. On top of it, only the
 * abbreviations managers actually type: KC, St/Saint, Pkwy/Parkway, St/Street.
 *
 * CONSERVATIVE ABOUT SHORT NAMES. "Lawrence", "Liberty" and "Manhattan" are
 * also people, "27th Street" and "Pine Lake" are also roads, and "at liberty
 * to" is an idiom. So anything short of the full roster name counts only where
 * the sentence says it is the salon: behind the state prefix every roster name
 * carries ("KS Lawrence"), before "salon"/"store"/"location" ("the Lawrence
 * salon"), or after "at"/"in" when the sentence then carries on as a sentence
 * ("at Liberty today", never "at liberty to", "in Pacific time" or "at Kearney
 * High"). "From" is not a cue: where somebody came from is not where the form
 * is filed. A
 * city several salons share ("Lincoln", "Omaha", "Kansas City") is a mention
 * of ALL of them, which is what makes it ambiguous rather than wrong — but
 * only where it stands alone as a place: "at Lincoln South" names no salon in
 * the roster, and reading it as the three Lincoln salons would ask a question
 * about a place nobody mentioned.
 */

export interface SalonMention {
  /** The roster salons this mention could mean. One when it is specific. */
  readonly salonIds: readonly string[];
}

/** Abbreviations normalized on BOTH sides, so the roster and the chat agree. */
function key(text: string): string {
  return ` ${storeNameKey(text)} `
    .replace(/\bkc\b/g, "kansas city")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/\s+/g, " ");
}

/** Leading words several roster salons share — a city, not a salon. */
const SHARED_CITIES: readonly string[] = (() => {
  const counts = new Map<string, number>();
  for (const salon of PRODUCTION_SALONS) {
    const words = key(salon.name.slice(3)).trim().split(" ");
    for (let length = 1; length < words.length; length += 1) {
      const head = words.slice(0, length).join(" ");
      counts.set(head, (counts.get(head) ?? 0) + 1);
    }
  }
  const shared = [...counts].filter(([, count]) => count > 1).map(([head]) => head);
  // "kansas" alone is not a city anybody names; keep only the longest heads.
  return shared.filter((head) => !shared.some((other) => other !== head && other.startsWith(`${head} `)));
})();

/**
 * REVIEWED SHORT NAMES, each with the reason it is safe.
 *
 * Kept small on purpose, in the spirit of `STORE_NAME_ALIASES`: a short name
 * goes in here because it names exactly one salon in the roster, never because
 * a fuzzy match would have found it.
 */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  // The only salon on Shawnee Mission Parkway; managers drop the rest.
  shawnee: "0463",
  "shawnee mission": "0463",
  // Local shorthand for St. Joseph, MO — the only St Joseph in the roster.
  "st joe": "0495",
  /*
   * PRODUCTION, 21 OCTOBER 2026. Lincoln managers drop "Street" ("at lincoln
   * 27th") and put the street first ("O St Lincoln"). Each still names one
   * salon, and each still needs a place cue like every other short name —
   * "the 27th" on its own is a date, so it is never one.
   */
  "lincoln 27th": "0310",
  "o st lincoln": "0311",
};

interface Alias {
  readonly phrase: string;
  readonly salonIds: readonly string[];
  /** One-word names need a place cue; see the module note. */
  readonly needsCue: boolean;
  /**
   * The salon's name without its city — "o st", "27th st", "pine lake" — which
   * is also a road. Never read from punctuation alone (`SET_OFF_BEFORE`).
   */
  readonly road?: boolean;
}

const ALIASES: readonly Alias[] = (() => {
  const aliases: Alias[] = [];
  const add = (phrase: string, salonIds: string[], road = false) => {
    const trimmed = phrase.trim();
    if (!trimmed) return;
    aliases.push({ phrase: trimmed, salonIds, needsCue: true, ...(road ? { road } : {}) });
  };

  for (const salon of PRODUCTION_SALONS) {
    const full = key(salon.name).trim();
    const local = key(salon.name.slice(3)).trim();
    // The full roster name carries the state prefix, which is its own cue.
    aliases.push({ phrase: full, salonIds: [salon.id], needsCue: false });
    add(local, [salon.id]);
    const city = SHARED_CITIES.find((head) => local.startsWith(`${head} `));
    if (city) add(local.slice(city.length), [salon.id], true);
  }

  for (const [phrase, salonNumber] of Object.entries(SHORT_NAMES)) {
    const salon = PRODUCTION_SALONS.find((entry) => entry.salonNumber === salonNumber);
    if (salon) add(phrase, [salon.id]);
  }

  // Longest first, so "lincoln o st" is read before "lincoln" can claim it.
  return aliases.sort((a, b) => b.phrase.length - a.phrase.length);
})();

/**
 * Words that may follow "at <salon>" for the sentence to still be about a
 * place: the rest of an account ("at Wornall today", "at Liberty and she…").
 * Deliberately excludes "to", "time", "high" and the like, which is what
 * separates "at Liberty" from "at liberty to" and "at Kearney High".
 */
const CARRIES_ON =
  "salon|store|location|studio|and|but|or|on|today|yesterday|tonight|this|last|at|she|he|they|i|we|for|with|where|when|while|because|so|again|during|after|before|around|since|until|was|is|has|had|" +
  /*
   * "…at kearney about bed cleaning" (production, 21 October 2026): what the
   * form is about, who it concerns, what is needed. None of these continues a
   * place's name the way "High", "South" or "time" does.
   */
  "about|regarding|concerning|re|who|that|then|every|her|his|their|need|needs|" +
  /*
   * "at Grand Island out of dress code" often has no comma. "out" ends the
   * place the way "on" and "about" do. "outlet" is a different word.
   */
  "out";

// Not "for": "a coaching form for Lawrence" is a person. Not "from": where
// somebody came from is not where the form is filed.
const ROSTER_STATES = [...new Set(PRODUCTION_SALONS.map((salon) => salon.state.toLowerCase()))];
const STATE_BEFORE = new RegExp(`\\b(?:${ROSTER_STATES.join("|")})\\s+$`);
const AT_BEFORE = /\b(?:at|in)\s+(?:the\s+)?$/;
const PLACE_AFTER = /^\s*(?:salon|store|location|studio)\b/;
const CARRIES_ON_AFTER = new RegExp(`^\\s*$|^\\s+;|^\\s+(?:${CARRIES_ON})\\b`);

/*
 * ============================================================================
 * PUNCTUATION ENDS A PLACE'S NAME
 * ============================================================================
 *
 * The roster key drops commas, so "works at kearney, need a coaching form"
 * read as "at kearney need" and the salon was lost to the word after it. Before
 * keying, each comma, semicolon, colon, bracket, "!" and "?" becomes a
 * standalone ";" — a token no salon name contains — so the cues below can see
 * where the manager's own punctuation closed the phrase.
 */
const SEPARATORS = /[,;:()[\]!?]+/g;
const SEPARATOR = " ; ";

/*
 * A SALON NAME SET OFF BY PUNCTUATION ON ITS OWN — "Avery Testperson, lincoln
 * 27th st", "Avery Testperson (Overland Park)" — is a place. Several words
 * only: "Wren, Lawrence, today" could still be a person called Lawrence, but
 * nobody is called "Grand Island" or "Lincoln 27th St".
 */
const SET_OFF_BEFORE = /(?:^|;)\s*$/;
const SET_OFF_AFTER = /^\s*(?:$|;)/;

/*
 * "CORINNE VALDEZ ASD LINCOLN O ST": NAME, ROLE, SALON. Managers sign a person
 * off the way the paperwork does, and the role is what says a place follows.
 * Only for a name of two or more words — "SD Lawrence" can be the salon
 * director called Lawrence, but nobody is called "Lincoln O St".
 */
const ROLE_BEFORE = /\b(?:sd|asd|tsd|sdit|dmit|fttc|pttc|tc|dm|rm|gm|mgr)\s+(?:;\s+)?$/;

/** Whether a short name, at this position, is being used as the salon. */
function cued(before: string, after: string, phrase: string, road = false): boolean {
  if (STATE_BEFORE.test(before) || PLACE_AFTER.test(after)) return true;
  if (phrase.includes(" ") && ROLE_BEFORE.test(before)) return true;
  if (!road && phrase.includes(" ") && SET_OFF_BEFORE.test(before) && SET_OFF_AFTER.test(after)) return true;
  return AT_BEFORE.test(before) && CARRIES_ON_AFTER.test(after);
}

/**
 * What may follow a city for it to be the city ALONE: the end of a clause, a
 * word saying it is a salon, or a word that starts the rest of the sentence.
 * Anything else ("Lincoln South", "Omaha West") is a name this roster does not
 * carry, and is left alone.
 */
const CITY_ENDS = `(?=\\s*$|\\s*[,.;:!?)]|\\s+(?:${CARRIES_ON})\\b)`;

const CITY_PATTERNS: readonly { pattern: RegExp; salonIds: readonly string[] }[] =
  SHARED_CITIES.map((city) => {
    const words = city.split(" ").join("\\s+");
    const spelled = city === "kansas city" ? `(?:${words}|kc)` : words;
    return {
      pattern: new RegExp(
        `(?:\\b(?:at|in)\\s+(?:the\\s+)?${spelled}${CITY_ENDS}|\\b${spelled}\\s+(?:salon|store|location|studio)\\b)`,
        "i",
      ),
      salonIds: PRODUCTION_SALONS.filter((salon) =>
        key(salon.name.slice(3)).trim().startsWith(`${city} `),
      ).map((salon) => salon.id),
    };
  });

/**
 * `store 373`, `salon #0306`, `#0306`, and a bare `at 0306`. Read through
 * `salonForTypedNumber`: a zero-padded number is a salon number, a
 * three-digit one is a salon number OR a Google store code and counts only
 * when the two readings do not disagree ("306" names two salons, so none).
 *
 * A NUMBER IS A SALON ONLY WHEN SOMETHING SAYS SO (QA F-05, 22 Oct 2026). A
 * bare "at <number>" used to be read as a salon unless a clock word came
 * first, so "she got here at 410 today", "she sold a package at 140" (Google
 * code 140 → Wornall), "rang up a sale at 231 dollars" and "we met at 409 for
 * lunch" each filed a salon nobody named. A time, a price, a quantity or a
 * date is far more often what follows "at" than a salon. Now a number counts
 * only with a location word ("salon 410", "store #373", "location 0306", "#0410")
 * or, after "at", only in the zero-padded form salons print ("at 0306").
 */
const SALON_NUMBER = /(?:\b(?:salon|store|location)\s*#?\s*|#\s*)(\d{3,4})\b/gi;
const AT_NUMBER = /\bat\s+(0\d{3})\b(?!\s*(?::|\.\d|am\b|pm\b|a\.m|p\.m|o['’]?clock))/gi;
/*
 * "SHE WAS LATE AT 310" IS A TIME. A bare number after "at" is a salon only
 * where the words before it are not about a clock: arriving, leaving, a shift.
 */
const TIME_BEFORE =
  /\b(?:late|early|arrived?|came\s+in|come\s+in|clock(?:ed)?\s+(?:in|out)|left|leave|showed\s+up|show\s+up|start(?:s|ed)?|open(?:s|ed)?|close[sd]?|shift|until|till|by|around|about|before|after|scheduled|due|back|lunch|break)\s+$/i;

/**
 * Every roster salon the manager's text names, one entry per mention.
 *
 * `text` is the manager's own turns — the same bounded window the employee and
 * the date are read from — never the assistant's.
 */
export function readSalonMentions(text: string): SalonMention[] {
  const mentions: SalonMention[] = [];

  for (const match of text.matchAll(SALON_NUMBER)) {
    const salon = salonForTypedNumber(match[1]!);
    if (salon) mentions.push({ salonIds: [salon.id] });
  }
  for (const match of text.matchAll(AT_NUMBER)) {
    if (TIME_BEFORE.test(text.slice(0, match.index))) continue;
    const salon = salonForTypedNumber(match[1]!);
    if (salon) mentions.push({ salonIds: [salon.id] });
  }

  let haystack = key(text.replace(SEPARATORS, SEPARATOR));
  for (const alias of ALIASES) {
    const pattern = new RegExp(`(?<= )${alias.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= )`, "g");
    let found = false;
    haystack = haystack.replace(pattern, (phrase, offset: number) => {
      const before = haystack.slice(0, offset);
      const after = haystack.slice(offset + phrase.length);
      if (alias.needsCue && !cued(before, after, phrase, alias.road)) {
        return phrase;
      }
      found = true;
      // Blanked so a shorter alias inside it ("lincoln") is not read again.
      return "_".repeat(phrase.length);
    });
    if (found) mentions.push({ salonIds: alias.salonIds });
  }

  const spaced = text.replace(/\s+/g, " ");
  for (const city of CITY_PATTERNS) {
    if (city.pattern.test(spaced)) mentions.push({ salonIds: city.salonIds });
  }

  return mentions;
}

/**
 * The salons each AMBIGUOUS number the manager typed with a location word can
 * mean — "salon 306", "store 307", "#314" — one list per number. These name
 * no salon in `readSalonMentions` (each is one salon's number and another's
 * Google store code), and are listed here so the manager can be ASKED between
 * them rather than have the number dropped (owner decision, 22 Oct 2026:
 * "ask the manager to clarify. Never guess").
 */
export function ambiguousSalonNumbers(text: string): string[][] {
  const found: string[][] = [];
  for (const match of text.matchAll(SALON_NUMBER)) {
    const salons = salonsForTypedNumber(match[1]!);
    if (salons.length > 1) found.push(salons.map((salon) => salon.id));
  }
  return found;
}

/**
 * Whether a run of words IS one of the salon names above, of two words or
 * more — "Lincoln O St", "O St Lincoln", "Grand Island" — read with the same
 * abbreviations (St = Street). For the employee reader, which must never offer
 * a salon as a second person. One-word names ("Lawrence", "Liberty") are also
 * first names and are deliberately not answered here.
 */
export function isMultiWordSalonName(candidate: string): boolean {
  const phrase = key(candidate).trim();
  return phrase.includes(" ") && ALIASES.some((alias) => alias.phrase === phrase);
}

/** The roster name for a salon id, for telling a manager what they named. */
export function rosterSalonName(id: string): string | null {
  return PRODUCTION_SALONS.find((salon: ProductionSalon) => salon.id === id)?.name ?? null;
}
