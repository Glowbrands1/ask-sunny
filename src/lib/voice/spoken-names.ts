import { foldName } from "@/lib/forms/fold-name";
import { closeWordDistance, editDistance } from "@/lib/forms/close-spelling";
import type { RosterEmployee } from "@/lib/forms/employee-match";

/**
 * ============================================================================
 * NAMES SPELLED AS THE DIRECTORY SPELLS THEM (VOICE_INPUT_ENABLED)
 * ============================================================================
 *
 * The owner, 27 Nov 2026: "i said Curt, it spelled it as Kurt", and "make sure sunny bubble and leadership hub know the
 * spelling of all employee ... so when it hears it, it can reference to the right person", "also salon names too".
 * (The tests use invented people of the same shape: a directory "Cyrus" heard as "Sirus", "Cade" heard as "Kade".)
 *
 * Two halves, both on the server, both built from the people and salons this manager may already see:
 *
 *   `spokenNameKeyterms` — the hint list AssemblyAI is given, so the name is heard right in the first place.
 *   `correctSpokenNames` — after the transcript comes back, a heard word that SOUNDS like exactly one directory
 *                          spelling and is not already one is rewritten to it: "Sirus" → "Cyrus".
 *
 * WHAT THE CORRECTION NEVER DOES:
 *
 *   CHANGE A NAME THE DIRECTORY HAS. A real "Kurt" on the roster is left as "Kurt", even when a "Curt" works there too.
 *   CHOOSE BETWEEN SPELLINGS. "Marisa" with both a "Marissa" and a "Morris" in scope is left as heard.
 *   INVENT A NAME. Every replacement is a spelling from the list it was given; nothing outside it.
 *   TOUCH A LOWER-CASE OR EVERYDAY WORD. Only capitalised words are read (the provider capitalises names), and words
 *                          like "Mark", "Will" or "Grace" are never rewritten, because they are usually not names.
 *
 * Two people who share a spelling (two "Cyrus"es) do not make the SPELLING ambiguous, so "Sirus" still becomes "Cyrus":
 * the word is spelled right, and who is meant is for the manager and the form's own name check, as when typing.
 *
 * The text stays in the box for the manager to read and edit before sending, exactly as before. Pure: no I/O, no logs.
 */

/** One salon or store, by the names a manager says it by. */
export interface SpokenPlace {
  readonly id: string;
  /** Its full name and the short names the app already knows, best first. */
  readonly names: readonly string[];
}

interface Entry {
  /** The spelling to write, as the directory or salon list spells it. */
  readonly spelling: string;
  readonly folded: string;
  readonly normalized: string;
  readonly key: string;
}

export interface SpokenVocabulary {
  /** Folded lower-case word → its directory spelling. */
  readonly exact: ReadonlyMap<string, Entry>;
  readonly entries: readonly Entry[];
}

/*
 * Words that are everyday English as often as they are names. A heard word on this list is never rewritten (a directory
 * spelling of the same word is still left as it is, because it is then an exact match).
 */
const EVERYDAY = new Set(
  [
    // Sentence starters and small words the provider capitalises.
    "the", "this", "that", "these", "those", "there", "then", "they", "them", "she", "her", "his", "him", "you", "your",
    "can", "could", "would", "should", "will", "please", "what", "when", "where", "which", "who", "why", "how", "hey",
    "hello", "okay", "yes", "and", "but", "for", "with", "about", "after", "before", "also", "just", "make", "create",
    "send", "write", "show", "tell", "give", "find", "need", "want", "add", "change", "draft", "file", "open", "start",
    // Names that are also words.
    "mark", "will", "bill", "may", "june", "april", "august", "grace", "joy", "hope", "faith", "dawn", "rose", "summer",
    "art", "jack", "pat", "rob", "sue", "don", "ray", "max", "sky", "star", "sunny", "bubbles", "hunter", "carter",
    "mason", "taylor", "page", "paige", "chase", "drew", "lane", "reed", "wade", "frank", "earnest", "ernest", "bob",
    "penny", "sandy", "rusty", "dusty", "holly", "ivy", "iris", "lily", "daisy", "violet", "ruby", "amber", "crystal",
    "angel", "april", "autumn", "winter", "storm", "river", "brook", "brooks", "stone", "king", "young", "white",
    "black", "brown", "green", "gray", "grey", "long", "short", "little", "baker", "cook", "miller", "smith", "price",
    // Days and months, and the words of this business.
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march",
    "july", "september", "october", "november", "december", "salon", "store", "form", "forms", "manager", "director",
    "district", "region", "regional", "corrective", "action", "coaching", "policy", "employee", "team", "shift",
    // Everyday words in salon and store names: a place name is matched on its distinctive words.
    "grand", "island", "street", "center", "centre", "park", "pacific", "mission", "maple", "pine", "lake", "liberty",
    "city", "plaza", "square", "market", "village", "crossing", "commons", "station", "north", "south", "east", "west",
  ],
);

function fold(word: string): string {
  return foldName(word).toLowerCase().replace(/[^a-z]/g, "");
}

/** Letters respelled the way they sound: C/K, Ph/F, -y/-ie/-i, doubled letters. */
export function soundSpelling(word: string): string {
  let s = fold(word);
  if (!s) return "";
  s = s
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^ps/, "s")
    .replace(/^x/, "s")
    .replace(/ph/g, "f")
    .replace(/sch/g, "sk")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/z/g, "s")
    .replace(/dg/g, "j")
    .replace(/gh/g, "")
    .replace(/(ie|ey|ee|y)$/, "i")
    .replace(/y/g, "i");
  return s.replace(/(.)\1+/g, "$1");
}

/** A short sound key: the first sound, then the consonants (vowels, h and w dropped), no repeats. */
export function soundKey(word: string): string {
  const s = soundSpelling(word);
  if (!s) return "";
  return (s[0]! + s.slice(1).replace(/[aeiouhw]/g, "")).replace(/(.)\1+/g, "$1");
}

function entryOf(spelling: string): Entry | null {
  const folded = fold(spelling);
  if (folded.length < 3) return null;
  return { spelling, folded, normalized: soundSpelling(spelling), key: soundKey(spelling) };
}

/** The single words of a name: "Mary-Kate O'Neil" → "Mary-Kate", "O'Neil". */
function wordsOf(name: string | null | undefined): string[] {
  return (name ?? "").split(/\s+/).map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter(Boolean);
}

/** The vocabulary the correction reads: every word of every scoped person's names, and of every scoped place's names. */
export function spokenVocabulary(roster: readonly RosterEmployee[], places: readonly SpokenPlace[] = []): SpokenVocabulary {
  const exact = new Map<string, Entry>();
  const add = (word: string) => {
    const entry = entryOf(word);
    if (!entry || exact.has(entry.folded)) return;
    exact.set(entry.folded, entry);
  };
  for (const person of roster) {
    for (const name of [person.firstName, person.preferredFirstName, person.lastName]) for (const word of wordsOf(name)) add(word);
  }
  for (const place of places) for (const name of place.names) for (const word of wordsOf(name)) add(word);
  return { exact, entries: [...exact.values()] };
}

/** Is `heard` close to `entry`: the same sound key and nearly the same sounds, or a near spelling? */
function soundsLike(heard: Entry, entry: Entry): boolean {
  if (heard.key && heard.key === entry.key) {
    const limit = Math.min(heard.normalized.length, entry.normalized.length) >= 6 ? 2 : 1;
    if (editDistance(heard.normalized, entry.normalized, limit) <= limit) return true;
  }
  return closeWordDistance(heard.folded, entry.folded) !== null;
}

/** The one directory spelling a heard word should be, or null (exact already, everyday word, nothing close, or two). */
export function directorySpellingFor(word: string, vocabulary: SpokenVocabulary): string | null {
  const heard = entryOf(word);
  if (!heard) return null;
  if (vocabulary.exact.has(heard.folded)) return null;
  if (EVERYDAY.has(heard.folded)) return null;
  const spellings = new Set<string>();
  for (const entry of vocabulary.entries) {
    if (soundsLike(heard, entry)) spellings.add(entry.folded);
    if (spellings.size > 1) return null;
  }
  if (spellings.size !== 1) return null;
  return vocabulary.exact.get([...spellings][0]!)!.spelling;
}

/** The transcript with each confidently misheard name written as the directory writes it. Everything else unchanged. */
export function correctSpokenNames(text: string, vocabulary: SpokenVocabulary): string {
  if (!text || vocabulary.entries.length === 0) return text;
  return text.replace(/\p{L}[\p{L}'’-]*/gu, (word) => {
    // Only a capitalised word is read as a name; "curt" in "a curt reply" is left alone.
    if (word[0] !== word[0]!.toUpperCase() || word[0] === word[0]!.toLowerCase()) return word;
    const spelling = directorySpellingFor(word, vocabulary);
    if (!spelling) return word;
    // An all-capitals word stays all capitals.
    return word === word.toUpperCase() && word.length > 1 ? spelling.toUpperCase() : spelling;
  });
}

/*
 * ============================================================================
 * THE HINT LIST
 * ============================================================================
 */

function fullNames(person: RosterEmployee): string[] {
  const last = person.lastName.trim();
  const firsts = [person.preferredFirstName, person.firstName].map((first) => (first ?? "").trim()).filter(Boolean);
  return [...new Set(firsts.map((first) => `${first} ${last}`))];
}

/**
 * The scoped places and people as hint terms, most useful first. Places: the manager's own salons first, each by its
 * full name and the short names the app knows. People: those of the manager's own salons first (full names, preferred
 * first name first), then everyone else in scope, then lone first names. The caller bounds the list (100 terms), so on a
 * large scope the manager's own salons are the ones that fit.
 */
export function spokenNameKeyterms(
  roster: readonly RosterEmployee[],
  places: readonly SpokenPlace[],
  ownSalonIds: readonly string[] = [],
): { readonly places: string[]; readonly people: string[] } {
  const own = new Set(ownSalonIds);
  const isOwn = (person: RosterEmployee) => person.salonIds.some((id) => own.has(id));
  const ordered = [...roster.filter(isOwn), ...roster.filter((person) => !isOwn(person))];
  return {
    places: [...places.filter((place) => own.has(place.id)), ...places.filter((place) => !own.has(place.id))].flatMap((place) => place.names),
    people: [
      ...ordered.flatMap(fullNames),
      ...ordered.flatMap((person) => [person.preferredFirstName, person.firstName].map((first) => (first ?? "").trim()).filter(Boolean)),
    ],
  };
}
