import "server-only";

import { PRODUCTION_SALONS, type ProductionSalon } from "@/data/salons";
import { storeNameKey } from "@/lib/reporting/store-identity";

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
};

interface Alias {
  readonly phrase: string;
  readonly salonIds: readonly string[];
  /** One-word names need a place cue; see the module note. */
  readonly needsCue: boolean;
}

const ALIASES: readonly Alias[] = (() => {
  const aliases: Alias[] = [];
  const add = (phrase: string, salonIds: string[]) => {
    const trimmed = phrase.trim();
    if (!trimmed) return;
    aliases.push({ phrase: trimmed, salonIds, needsCue: true });
  };

  for (const salon of PRODUCTION_SALONS) {
    const full = key(salon.name).trim();
    const local = key(salon.name.slice(3)).trim();
    // The full roster name carries the state prefix, which is its own cue.
    aliases.push({ phrase: full, salonIds: [salon.id], needsCue: false });
    add(local, [salon.id]);
    const city = SHARED_CITIES.find((head) => local.startsWith(`${head} `));
    if (city) add(local.slice(city.length), [salon.id]);
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
  "salon|store|location|studio|and|but|or|on|today|yesterday|tonight|this|last|at|she|he|they|i|we|for|with|where|when|while|because|so|again|during|after|before|around|since|until|was|is|has|had";

// Not "for": "a coaching form for Lawrence" is a person. Not "from": where
// somebody came from is not where the form is filed.
const ROSTER_STATES = [...new Set(PRODUCTION_SALONS.map((salon) => salon.state.toLowerCase()))];
const STATE_BEFORE = new RegExp(`\\b(?:${ROSTER_STATES.join("|")})\\s+$`);
const AT_BEFORE = /\b(?:at|in)\s+(?:the\s+)?$/;
const PLACE_AFTER = /^\s*(?:salon|store|location|studio)\b/;
const CARRIES_ON_AFTER = new RegExp(`^\\s*$|^\\s+(?:${CARRIES_ON})\\b`);

/** Whether a short name, at this position, is being used as the salon. */
function cued(before: string, after: string): boolean {
  if (STATE_BEFORE.test(before) || PLACE_AFTER.test(after)) return true;
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

/** `salon 306`, `store #0306`, `#0306`. The number reporting joins on. */
const SALON_NUMBER = /(?:\b(?:salon|store|location)\s*#?\s*|#\s*)0?(\d{3,4})\b/gi;

/**
 * Every roster salon the manager's text names, one entry per mention.
 *
 * `text` is the manager's own turns — the same bounded window the employee and
 * the date are read from — never the assistant's.
 */
export function readSalonMentions(text: string): SalonMention[] {
  const mentions: SalonMention[] = [];

  for (const match of text.matchAll(SALON_NUMBER)) {
    const number = match[1]!.padStart(4, "0");
    const salon = PRODUCTION_SALONS.find((entry) => entry.salonNumber === number);
    if (salon) mentions.push({ salonIds: [salon.id] });
  }

  let haystack = key(text);
  for (const alias of ALIASES) {
    const pattern = new RegExp(`(?<= )${alias.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= )`, "g");
    let found = false;
    haystack = haystack.replace(pattern, (phrase, offset: number) => {
      const before = haystack.slice(0, offset);
      const after = haystack.slice(offset + phrase.length);
      if (alias.needsCue && !cued(before, after)) {
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

/** The roster name for a salon id, for telling a manager what they named. */
export function rosterSalonName(id: string): string | null {
  return PRODUCTION_SALONS.find((salon: ProductionSalon) => salon.id === id)?.name ?? null;
}
