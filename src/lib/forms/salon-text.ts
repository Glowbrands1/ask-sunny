import { PRODUCTION_SALONS } from "@/data/salons";
import { storeNameKey } from "@/lib/reporting/store-identity";

/**
 * ============================================================================
 * A SALON AS A MANAGER TYPES IT
 * ============================================================================
 *
 * "salon 12", "STC 12", "sun tan city 12", "lawrence", "KS Lawrence", "#468".
 * None of these should be refused, and none should be rewritten into a salon
 * the manager did not mean.
 *
 * TWO OUTCOMES, AND NO THIRD:
 *
 *   A ROSTER MATCH, which must be UNIQUE. The whole name ("ks lawrence"), the
 *   name without its state prefix ("lawrence"), or the salon number, padded
 *   the way reporting pads it ("468", "#0468", "salon 468"). Compared through
 *   `storeNameKey`, reporting's own normalisation, so case, spacing and the
 *   punctuation the sources disagree on do not matter. The display value is
 *   the roster's name.
 *
 *   ANYTHING ELSE IS KEPT AS TYPED, cleaned: whitespace collapsed, words
 *   capitalised, "STC" in capitals. "salon 12" is not a roster number, so it
 *   prints as "Salon 12" — the manager's words, legible — rather than as a
 *   guess at which of the fifteen they meant. The field stays editable.
 */

const ABBREVIATIONS = new Set(["stc", "ks", "mo", "ne", "sd", "asd", "tsd", "dm", "tc"]);

/** Capitalises each word, keeping known abbreviations in capitals. */
export function tidyWords(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (ABBREVIATIONS.has(lower)) return lower.toUpperCase();
      // Leave words the manager already capitalised mid-word ("McKenzie").
      if (/[A-Z]/.test(word.slice(1))) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function withoutPrefix(name: string): string {
  return name.replace(/^[A-Z]{2}\s+/, "");
}

/**
 * The roster salon a typed phrase names, when it names exactly one.
 */
export function rosterSalonFor(text: string): (typeof PRODUCTION_SALONS)[number] | null {
  const key = storeNameKey(text.replace(/^(?:the|our)\s+/i, "").replace(/\s+(?:salon|store|location)$/i, ""));
  if (!key) return null;

  const number = /^(?:(?:salon|store|stc|sun tan city|location|loc)\s*)?#?\s*(\d{1,4})$/.exec(key)?.[1];
  if (number) {
    const padded = number.padStart(4, "0");
    return PRODUCTION_SALONS.find((salon) => salon.salonNumber === padded) ?? null;
  }

  const byName = PRODUCTION_SALONS.filter(
    (salon) => storeNameKey(salon.name) === key || storeNameKey(withoutPrefix(salon.name)) === key,
  );
  return byName.length === 1 ? byName[0]! : null;
}

/** The salon as it should print: the roster name when unique, otherwise the tidied text. */
export function resolveSalonText(text: string): string | null {
  const cleaned = text
    .replace(/^[\s,:;-]+|[\s,.;:!?]+$/g, "")
    .replace(/^(?:the|our)\s+/i, "")
    .trim();
  if (!cleaned) return null;
  const salon = rosterSalonFor(cleaned);
  if (salon) return salon.name;
  return tidyWords(cleaned);
}

/**
 * A regular-expression fragment matching a salon as typed: a numbered salon
 * ("salon 12", "STC #12", "sun tan city 12", "#12") or a roster name, with or
 * without its state prefix, longest first so "Lincoln O Street" is not read as
 * "Lincoln".
 */
export const SALON_PHRASE: string = (() => {
  const names = PRODUCTION_SALONS.flatMap((salon) => [salon.name, withoutPrefix(salon.name)])
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"))
    .sort((a, b) => b.length - a.length);
  return `(?:(?:salon|store|stc|sun\\s+tan\\s+city|location|loc)\\s*#?\\s*\\d{1,4}|#\\s?\\d{1,4}|${names.join("|")})`;
})();
