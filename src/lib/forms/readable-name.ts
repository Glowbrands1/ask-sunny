/**
 * ============================================================================
 * NAMES PEOPLE READ ARE WRITTEN THE WAY THE NAME IS WRITTEN (READABLE_NAMES_ENABLED)
 * ============================================================================
 *
 * Pau, 15 Nov 2026 (via QA): "all naming conventions should be readable; some have de la Torre etc." A name typed
 * off the roster went on the card exactly as typed ("maria de la torre"), and an all-caps roster row read as shouted.
 *
 * `readableName` changes CASE AND SPACING ONLY, never a letter, and only in words typed all in one case: a word with
 * its own mixed case ("LaToya", "McKenzie", "DeShawn") is the person's spelling and is kept.
 *
 *   each part capitalized             maria → Maria; smith-jones → Smith-Jones
 *   particles, not the first word     de, la, del, de la, de los, van, von, der, da, di, du, dos, das, le
 *   Mc / Mac                          mcdonald → McDonald; macdonald → MacDonald (a short list: "Macy" stays Macy)
 *   O' / D' (one letter, apostrophe)  o'brien → O'Brien; d'angelo → D'Angelo
 *   accents and apostrophes kept      josé peña → José Peña
 *   suffixes                          jr → Jr.; sr. → Sr.; ii / iii / iv → II / III / IV
 *
 * `squashedName` is the matching key that ignores case, accents, spaces, hyphens and apostrophes, so "delatorre",
 * "dela torre" and "de la Torre", or "obrien" and "O'Brien", are the same spelling.
 *
 * Pure and client-safe.
 */

const PARTICLES: ReadonlySet<string> = new Set(["de", "la", "del", "los", "las", "van", "von", "der", "da", "di", "du", "dos", "das", "le"]);
/** "Mac" surnames whose next letter is a capital; any other "mac…" word ("macy", "mack", "macias") is only capitalized. */
const MAC_NAMES: ReadonlySet<string> = new Set([
  "macdonald", "macarthur", "macgregor", "macintosh", "mackenzie", "maclean", "macleod", "macmillan", "macneil", "macpherson", "macaulay", "macdougall", "mackay", "mackinnon",
]);
/** Two-letter particles (QA, 15 Nov 2026): never initials. */
const TWO_LETTER_PARTICLES: ReadonlySet<string> = new Set(["de", "la", "le", "du", "da", "di", "do", "el"]);
/** Two-letter initials that have a vowel (QA, 15 Nov 2026). */
const INITIALS_WITH_VOWEL: ReadonlySet<string> = new Set(["aj", "jj", "ej"]);

/** A two-letter word typed in one case that is initials: no vowel (JT, DJ, KC), or AJ / JJ / EJ; never a particle. */
function isInitials(word: string): boolean {
  const lower = word.toLocaleLowerCase("en-US");
  if (!/^[a-z]{2}$/.test(lower) || TWO_LETTER_PARTICLES.has(lower) || SUFFIX_DOTTED[lower]) return false;
  return !/[aeiouy]/.test(lower) || INITIALS_WITH_VOWEL.has(lower);
}
const SUFFIX_DOTTED: Readonly<Record<string, string>> = { jr: "Jr.", sr: "Sr." };
const SUFFIX_ROMAN = /^(?:ii|iii|iv)$/;

function upperFirst(word: string): string {
  const chars = [...word];
  return chars.length === 0 ? word : chars[0]!.toLocaleUpperCase("en-US") + chars.slice(1).join("");
}

/** One letter-run of a word (between hyphens), in lower case, made readable. */
function readablePart(part: string): string {
  if (part === "") return part;
  const apostrophe = /^([a-zÀ-ɏ])(['’])(.+)$/u.exec(part);
  if (apostrophe) return `${apostrophe[1]!.toLocaleUpperCase("en-US")}${apostrophe[2]}${upperFirst(apostrophe[3]!)}`;
  if (/^mc.{2,}$/u.test(part)) return `Mc${upperFirst(part.slice(2))}`;
  if (MAC_NAMES.has(part)) return `Mac${upperFirst(part.slice(3))}`;
  return upperFirst(part);
}

/**
 * A whole word typed in one case. A particle is lowercase only BETWEEN the first name and the last word: the last word
 * is the surname, so "thanh le", "kim du" and "LINH DA" read "Thanh Le", "Kim Du", "Linh Da" (QA's review, 15 Nov 2026).
 */
function readableWord(word: string, first: boolean, last: boolean): string {
  const lower = word.toLocaleLowerCase("en-US");
  const bare = lower.replace(/\.$/, "");
  if (!first && SUFFIX_DOTTED[bare]) return SUFFIX_DOTTED[bare]!;
  if (!first && SUFFIX_ROMAN.test(lower)) return lower.toUpperCase();
  if (!first && !last && PARTICLES.has(lower)) return lower;
  return lower.split("-").map(readablePart).join("-");
}

/** Whether a word is typed all in one case (so its case says nothing about the name). */
function oneCase(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters !== "" && (letters === letters.toLocaleLowerCase("en-US") || letters === letters.toLocaleUpperCase("en-US"));
}

/** A person's name with readable case and single spaces. Letters are never changed; mixed-case words are kept. */
export function readableName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // The surname is the last word that is not a suffix ("maria de la torre jr" ends on "torre").
  let last = words.length - 1;
  while (last > 0 && (SUFFIX_DOTTED[words[last]!.toLocaleLowerCase("en-US").replace(/\.$/, "")] || SUFFIX_ROMAN.test(words[last]!.toLocaleLowerCase("en-US")))) last -= 1;
  return words
    .map((word, index) => {
      if (!oneCase(word)) return word;
      // QA, 15 Nov 2026: a two-letter word with no vowel ("JT", "DJ", "KC") or on the initials list ("AJ", "JJ", "EJ") is
      // initials and stays upper case; any other ("AL", "ED", "JO", "BO", "TY") is a name ("Al"). A two-letter particle as
      // the last word is the surname ("LE" → "Le"). Mixed-case words (a roster row's own casing) never reach here.
      // The last word is the surname, never initials ("kim ng" → "Kim Ng"; QA's re-review, 15 Nov 2026).
      if (index !== last && isInitials(word)) return word.toLocaleUpperCase("en-US");
      return readableWord(word, index === 0, index === last);
    })
    .join(" ");
}

/** A surname particle ("de", "la", "van", "der", …): part of a name, never a name part of its own when counting them. */
export function isNameParticle(word: string): boolean {
  return PARTICLES.has(word.toLowerCase());
}

/** Whether a whole name is written all in one case (an all-caps or all-lowercase roster row). */
export function nameInOneCase(name: string): boolean {
  const letters = name.replace(/[^\p{L}]/gu, "");
  return letters !== "" && (letters === letters.toLocaleLowerCase("en-US") || letters === letters.toLocaleUpperCase("en-US"));
}

/** The matching key: letters only, no case, no accents ("De la Torre" = "delatorre", "O'Brien" = "obrien"). */
export function squashedName(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Whether a typed name is a roster person's spelling once spaces, hyphens, apostrophes, accents and case are set aside:
 * the whole name ("maria delatorre"), the first name and surname apart ("Maria dela torre"), or the surname alone
 * ("obrien"). Exact only; a typo is the close-spelling check's.
 */
export function squashedSpellingMatches(
  typed: string,
  person: { readonly firstName: string; readonly preferredFirstName?: string | null; readonly lastName: string },
): boolean {
  const all = squashedName(typed);
  const last = squashedName(person.lastName);
  if (all.length < 3 || last === "") return false;
  const firsts = [person.firstName, person.preferredFirstName ?? ""].map(squashedName).filter(Boolean);
  if (all === last || firsts.some((first) => all === first + last)) return true;
  const [firstWord, ...rest] = typed.trim().split(/\s+/);
  return rest.length > 0 && firsts.includes(squashedName(firstWord ?? "")) && squashedName(rest.join("")) === last;
}

