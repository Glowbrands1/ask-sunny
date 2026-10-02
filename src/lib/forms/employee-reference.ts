import { NOT_A_NAME } from "./name-words";
import { TEAM_SUBJECT_LABEL } from "./team-subject";

/**
 * ============================================================================
 * THE EMPLOYEE IS CALLED BY THEIR NAME ON THEIR OWN RECORD
 * ============================================================================
 *
 * HR feedback, 3 Oct 2026: "Stop using pronouns in verbiage for forms — site
 * employee first name." A form is read later, by people who were not in the
 * room, and often next to other forms about other people; "she failed to
 * follow the attendance policy" makes the reader work out who "she" is, and a
 * pronoun the manager never chose is one more thing on an HR record nobody
 * signed up to.
 *
 *   BAD   "She failed to follow the attendance policy."
 *   GOOD  "Jessica failed to follow the attendance policy."
 *
 * TWO HALVES, AND THE FIRST DOES THE WORK. Every drafting prompt carries
 * `employeeNameRules` — write the first name, never a pronoun — which is what
 * makes the text right in the first place. This module's rewrite is the
 * backstop for the occasional pronoun that comes back anyway, and it is
 * deliberately CONSERVATIVE: a pronoun is only replaced where it cannot mean
 * anybody but the employee. When a sentence also mentions a client, a
 * coworker, another named person, or both "he" and "she", it is left exactly
 * as written — a pronoun left in place is a style problem, and a pronoun
 * rewritten onto the wrong person is a false statement about an employee.
 *
 * WHAT IT NEVER TOUCHES.
 *   Text inside quotation marks — somebody's own words, or a passage quoted
 *   from a manual, are evidence and are reproduced as they were.
 *   Policy fields — `policyGrounded` lines and the server-derived citations —
 *   are the approved manual's own wording; the caller holds them out.
 *   A team-wide coaching form, whose subject is not a person.
 *   Reflexives ("herself") — "Jessica should give Jessica extra time" is
 *   worse than the pronoun; the prompt rule is what keeps them out.
 *
 * Pure and browser-safe.
 */

/**
 * The employee's first name, or null when the subject is not a nameable
 * person — empty, the team label, or a first word that is not a name.
 */
export function employeeFirstName(employeeName: string | null | undefined): string | null {
  const name = (employeeName ?? "").trim();
  if (name === "" || name === TEAM_SUBJECT_LABEL) return null;
  const first = name.split(/\s+/)[0]!.replace(/[,.;:]+$/, "");
  if (!/^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*$/.test(first)) return null;
  if (NOT_A_NAME.has(first.toLowerCase())) return null;
  // A name typed as "colene" or "COLENE" is still written "Colene" on the form;
  // one with its own mixed case ("McKenna", "DeShawn") is left as given.
  const single = first === first.toLowerCase() || first === first.toUpperCase();
  return single ? first[0]!.toUpperCase() + first.slice(1).toLowerCase() : first;
}

/**
 * The drafting rule, for every prompt that writes onto a form. Empty when the
 * subject has no first name to use, so a team form gets no instruction about
 * a person.
 */
export function employeeNameRules(employeeName: string | null | undefined): string[] {
  const first = employeeFirstName(employeeName);
  if (!first) return [];
  return [
    `Refer to the employee by their first name, "${first}", every time — never by a pronoun.`,
    `Do not write he, she, him, her, his, hers, they, them, their, theirs, himself, herself or themselves for the employee. Use "${first}" as the subject (for example "${first} failed to follow the attendance policy", not "She failed to follow the attendance policy").`,
    `Write naturally rather than repeating the name: once "${first}" is named in a sentence, write the rest of it so no pronoun is needed — "${first} submitted a resignation", not "${first} provided ${first}'s resignation" or "${first} provided her resignation"; "${first} arrived late and did not call", not "${first} arrived late and she did not call"; "for the scheduled shift", not "for her scheduled shift".`,
    "Text you quote word for word — a policy passage or somebody's own words, in quotation marks — stays exactly as it was written.",
  ];
}

/* ------------------------------------------------------------ rewriting --- */

/**
 * People who are not the employee. A sentence naming one is left alone, since
 * "he" or "they" in it could be them.
 *
 * `her manager` / `his supervisor` are the employee's own manager and do not
 * count — see `otherPeople` — because a possessive pronoun right before the
 * role already says whose it is.
 */
const OTHER_PERSON =
  /\b(?:clients?|guests?|customers?|members?|co-?workers?|colleagues?|team\s?mates?|associates?|someone|somebody|anyone|anybody|everyone|everybody|person|people|another|other|managers?|supervisors?|directors?|leaders?|consultants?|trainees?|trainers?|mom|dad|mother|father|sons?|daughters?|child|children|kids?|boyfriend|girlfriend|husband|wife|partner|friends?|family|parents?|sister|brother)\b/gi;

/** Groups that can be "they" but never "he" or "she". */
const COLLECTIVE = /\b(?:team|staff|management|leadership|employees|everyone|people|crew|salon|company)\b/i;

/**
 * Capitalised words that are not a person — form vocabulary, the calendar and
 * the business's own names — so they do not read as somebody else named in
 * the sentence. Anything not here makes the sentence ineligible, which is the
 * safe direction to be wrong in.
 */
const NOT_A_PERSON = new Set(
  [
    "observed", "expectation", "going", "forward", "moving", "next", "step", "management",
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep",
    "sept", "oct", "nov", "dec", "monday", "tuesday", "wednesday", "thursday", "friday",
    "saturday", "sunday", "sun", "tan", "city", "jba", "woven", "spa", "club", "close",
    "policy", "policies", "manual", "standards", "standard", "conduct", "dress", "code",
    "attendance", "company", "corrective", "action", "form", "plan", "coaching", "verbal",
    "written", "warning", "epp", "ppta", "upta", "lpsva", "bonus", "viewer", "uv", "sunless",
    "hr", "ok", "i", "tc", "asd", "sd", "sdit", "tsd", "dmit", "fttc", "dm", "salon", "future",
    "none", "first", "occurrence", "signed", "termination", "employment", "source",
  ],
);

/**
 * Ordinary words a sentence opens with. Any OTHER capitalised first word may
 * be somebody's name — "Sarah clocked in late after her break" on Jordan's
 * form is about Sarah — so it holds the sentence back like a name mid-sentence
 * would. Wrong in the safe direction: an unlisted opener only means a pronoun
 * is left for the prompt rule to have prevented.
 */
const SENTENCE_OPENERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "its", "there", "here", "then",
  "on", "in", "at", "after", "before", "during", "since", "until", "when", "while", "if",
  "as", "because", "although", "though", "however", "additionally", "also", "again", "both",
  "each", "every", "all", "any", "some", "no", "not", "per", "for", "from", "with", "without",
  "to", "by", "of", "over", "under", "today", "yesterday", "tonight", "this", "please",
  "moving", "going", "following", "expectation", "observed", "next", "employees", "staff",
  "our", "my", "we", "she", "he", "they", "her", "his", "their", "she's", "he's", "they're",
  "is", "was", "has", "had", "did", "does", "will", "would", "should", "must", "can", "could",
  "upon", "throughout", "despite", "instead", "once", "twice", "first", "second", "third",
  "finally", "currently", "previously", "recently", "overall", "going", "continued",
  "repeated", "failure", "arriving", "being", "management", "leadership",
]);

/**
 * Words ending in "s" that are not plurals, and plurals that are never "they"
 * (a unit of time cannot arrive late). Any OTHER word ending in "s" could be
 * what "they" refers to, and holds the they-family back for that sentence.
 */
const NOT_A_PLURAL_REFERENT = new Set([
  "is", "was", "has", "does", "his", "hers", "this", "thus", "its", "us", "as", "yes", "plus",
  "minus", "less", "unless", "always", "across", "process", "business", "status", "bonus",
  "focus", "address", "class", "guess", "perhaps", "sometimes", "besides", "towards",
  "afterwards", "regardless", "various", "serious", "previous", "obvious", "nervous",
  "minutes", "hours", "days", "weeks", "months", "years", "times", "seconds", "standards",
  "expectations", "policies", "results", "sales", "goals", "metrics", "numbers", "tasks",
  "duties", "responsibilities", "procedures", "steps", "instructions", "directions",
]);

/** Verbs after "they" and what they become after a singular name. */
const THEY_VERB: Record<string, string> = {
  are: "is",
  were: "was",
  have: "has",
  do: "does",
  "don't": "doesn't",
  "aren't": "isn't",
  "weren't": "wasn't",
  "haven't": "hasn't",
};

/** Verbs that read the same after a singular name. */
const THEY_SAME = new Set([
  "had", "did", "didn't", "will", "would", "should", "must", "can", "could", "may", "might",
  "won't", "wouldn't", "shouldn't", "can't", "cannot", "couldn't", "hadn't",
]);

/**
 * What follows an OBJECT "her" — "told her the schedule", "spoke to her about
 * it", "asked her." — as opposed to a possessive one, "her shift".
 */
const AFTER_OBJECT_HER = new Set([
  "the", "a", "an", "to", "that", "this", "these", "those", "and", "or", "but", "for", "with",
  "about", "on", "in", "at", "of", "by", "from", "as", "if", "when", "while", "before", "after",
  "again", "today", "yesterday", "tonight", "know", "up", "down", "out", "off", "back", "over",
  "how", "what", "why", "where", "it", "so", "until", "because", "during", "into", "than",
  "directly", "privately", "personally", "twice", "once", "not", "is", "was", "has", "had",
  "will", "would", "should", "must", "can", "could",
]);

function words(text: string): string[] {
  return text.match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g) ?? [];
}

/** Whether the sentence names somebody who is not the employee. */
function otherPeople(sentence: string, nameParts: ReadonlySet<string>, known: ReadonlySet<string>): boolean {
  for (const match of sentence.matchAll(OTHER_PERSON)) {
    const before = sentence.slice(0, match.index).toLowerCase();
    const word = match[0].toLowerCase();
    // "her manager", "his team mates' — whose they are is already stated.
    if (/\b(?:her|his|their)\s+$/.test(before) && /^(?:managers?|supervisors?|directors?|leaders?|trainers?)$/.test(word)) {
      continue;
    }
    return true;
  }

  // Another person's name: a capitalised word that is not the first word of
  // the sentence (or of a clause after a colon or dash), not the employee's,
  // and not form or calendar vocabulary.
  const tokens = [...sentence.matchAll(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]*/g)];
  for (const token of tokens) {
    const word = token[0];
    if (word[0] !== word[0]!.toUpperCase() || word[0] === word[0]!.toLowerCase()) continue;
    const lead = sentence.slice(0, token.index).trim();
    const bare = word.replace(/['’](?:s|ll|re|ve|d)$/i, "").toLowerCase();
    const opens = lead === "" || /[:—–-]$/.test(lead);
    if (opens && (SENTENCE_OPENERS.has(word.toLowerCase()) || SENTENCE_OPENERS.has(bare))) continue;
    if (PRONOUN_WORDS.has(bare)) continue;
    if (nameParts.has(bare) || known.has(bare) || NOT_A_PERSON.has(bare)) continue;
    // An acronym is a thing, not a person.
    if (word === word.toUpperCase() && word.length > 1) continue;
    return true;
  }
  return false;
}

const PRONOUN_WORDS = new Set(["she", "he", "her", "him", "his", "hers", "they", "them", "their", "theirs"]);

function pluralReferent(sentence: string): boolean {
  return words(sentence).some((word) => {
    const lower = word.toLowerCase();
    return /^[a-z]{3,}s$/.test(lower) && !NOT_A_PLURAL_REFERENT.has(lower) && !lower.endsWith("ss");
  });
}

interface SentenceResult {
  text: string;
  replaced: number;
}

/**
 * Nouns that read naturally with "a" rather than "the" once the possessive is
 * gone — "Colene submitted a resignation", not "the resignation".
 */
const INDEFINITE_NOUNS = new Set([
  "resignation", "request", "complaint", "letter", "apology", "explanation", "statement",
  "message", "email", "note", "excuse", "reason", "text",
]);

/** "and she did not call" — a conjunction the pronoun can simply be dropped after. */
const DROPPABLE_AFTER = /(,\s*)?\b(and|but|then|or)\s+$/i;

/** Every pronoun this module may rewrite, with an optional contraction. */
const PRONOUN_TOKEN = /\b(she|he|him|his|hers|her|they|them|their|theirs)(?:['’](s|ll|re|ve))?\b/gi;

/**
 * ============================================================================
 * NATURAL, NOT MECHANICAL
 * ============================================================================
 *
 * Swapping every pronoun for the name produces "Colene provided Colene's
 * resignation" — no pronoun, and no person would write it. So the sentence is
 * read left to right, knowing whether the employee has ALREADY been named in
 * it, and each pronoun is restructured rather than substituted:
 *
 *   POSSESSIVE, name not yet in the sentence   the name, once
 *     "Her last day was Sept 26."            -> "Jane's last day was Sept 26."
 *   POSSESSIVE, name already in the sentence   an article — whose it is, is
 *                                              already said
 *     "Colene provided her resignation."     -> "Colene provided a resignation."
 *     "Jessica did not clock in for her shift." -> "... for the shift."
 *   SUBJECT after "and" / "but" / "then", name already the subject
 *                                              dropped — one subject, two verbs
 *     "Jessica arrived late and she did not call." -> "Jessica arrived late and did not call."
 *   SUBJECT of a later clause that cannot share it  left as written
 *     "Jessica was late because she overslept."  (the prompt rule prevents it;
 *     "...because Jessica overslept" is the repetition HR does not want)
 *   ANY OTHER subject or object               the name
 *     "She arrived late."                    -> "Jessica arrived late."
 *
 * The prompt rule asks the model to write this way in the first place; this is
 * the same grammar, applied to whatever came back anyway.
 */
function rewriteSentence(
  sentence: string,
  first: string,
  nameParts: ReadonlySet<string>,
  known: ReadonlySet<string>,
): SentenceResult {
  const lower = sentence.toLowerCase();
  const feminine = /\b(?:she|her|hers)\b/.test(lower);
  const masculine = /\b(?:he|him|his)\b/.test(lower);
  const plural = /\b(?:they|them|their|theirs)\b/.test(lower);
  if (!feminine && !masculine && !plural) return { text: sentence, replaced: 0 };

  if (otherPeople(sentence, nameParts, known)) return { text: sentence, replaced: 0 };

  // TWO GENDERS IN ONE SENTENCE ARE TWO PEOPLE, so neither is rewritten.
  const gendered = (feminine || masculine) && !(feminine && masculine);
  // THE THEY-FAMILY needs no other plural in the sentence, and a verb it can
  // agree with; anything else is left as written.
  const they =
    plural &&
    !COLLECTIVE.test(sentence) &&
    !pluralReferent(sentence.replace(/\b(?:they|them|their|theirs)\b/gi, ""));
  if (!gendered && !they) return { text: sentence, replaced: 0 };

  const nameWords = [...nameParts].filter((part) => part !== "");
  const named = (text: string) =>
    nameWords.some((part) => new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));

  let out = "";
  let cursor = 0;
  let replaced = 0;
  PRONOUN_TOKEN.lastIndex = 0;

  for (let match = PRONOUN_TOKEN.exec(sentence); match; match = PRONOUN_TOKEN.exec(sentence)) {
    const token = match[0];
    const pronoun = match[1]!.toLowerCase();
    const contraction = match[2]?.toLowerCase() ?? null;
    const family = ["they", "them", "their", "theirs"].includes(pronoun) ? "they" : "gendered";
    if ((family === "gendered" && !gendered) || (family === "they" && !they)) continue;

    let prefix = out + sentence.slice(cursor, match.index);
    const rest = sentence.slice(match.index + token.length);
    const following = /^(\s*)([A-Za-z'’]+)?/.exec(rest)!;
    const gap = following[1] ?? "";
    const nextWord = following[2] ?? "";
    const next = nextWord.toLowerCase().replace(/’/g, "'");
    const isNamed = named(prefix);
    const atStart = prefix.trim() === "" || /[:—–-]\s*$/.test(prefix);
    const cap = (word: string) => (atStart || token[0] === token[0]!.toUpperCase() ? word[0]!.toUpperCase() + word.slice(1) : word);

    /**
     * The subject: the name, nothing when the clause can share the earlier
     * subject, or "keep" when the name is already in the sentence and the
     * clause cannot share it ("Jessica was late because she overslept") —
     * repeating the name there is the awkwardness this pass exists to avoid,
     * so that sentence is left for the prompt rule to have prevented.
     */
    const subject = (): string | null | "keep" => {
      if (isNamed && !DROPPABLE_AFTER.test(prefix)) return "keep";
      if (isNamed) {
        // ", and she" -> " and": one subject, two verbs, no comma between.
        prefix = prefix.replace(DROPPABLE_AFTER, (_m, _comma, conjunction: string) => ` ${conjunction} `).replace(/\s+ (and|but|then|or) $/i, " $1 ");
        return null;
      }
      return first;
    };

    let replacement: string | null = null;
    let skip = 0; // characters of `rest` consumed by the replacement

    if (pronoun === "she" || pronoun === "he") {
      const verb =
        contraction === "s"
          ? /^\s+been\b/i.test(rest) ? "has" : "is"
          : contraction === "ll"
            ? "will"
            : null;
      if (contraction && !verb) continue;
      const who = subject();
      if (who === "keep") continue;
      if (who === null) {
        replacement = verb ?? "";
        if (!verb) skip = gap.length;
      } else {
        replacement = verb ? `${cap(who)} ${verb}` : cap(who);
      }
    } else if (pronoun === "they") {
      const verb = contraction
        ? { re: "is", ve: "has", ll: "will" }[contraction as "re" | "ve" | "ll"] ?? null
        : null;
      if (contraction && !verb) continue;
      let agreed: string | null = verb;
      if (!contraction) {
        if (next in THEY_VERB) agreed = THEY_VERB[next]!;
        else if (THEY_SAME.has(next) || /^[a-z]{3,}ed$/.test(next)) agreed = nextWord;
        else continue; // a verb it cannot agree with: left as written
        skip = gap.length + nextWord.length;
      }
      const who = subject();
      if (who === "keep") continue;
      replacement = who === null ? agreed! : `${cap(who)} ${agreed}`;
    } else if (pronoun === "him" || pronoun === "them") {
      replacement = first;
    } else if (pronoun === "hers" || pronoun === "theirs") {
      replacement = `${first}'s`;
    } else {
      // his / her / their: possessive, unless "her" is an object.
      const objective =
        pronoun === "her" &&
        (nextWord === "" || AFTER_OBJECT_HER.has(next) || /ly$/i.test(next) || /^[^\sA-Za-z]/.test(rest));
      if (objective) {
        replacement = first;
      } else if (!isNamed) {
        replacement = cap(`${first}'s`);
      } else {
        // Whose it is is already said: an article, and "own" goes with the possessive.
        let noun = next;
        if (next === "own") {
          skip = gap.length + nextWord.length;
          noun = (/^\s+([A-Za-z'’]+)/.exec(rest.slice(skip))?.[1] ?? "").toLowerCase();
        }
        replacement = cap(INDEFINITE_NOUNS.has(noun) ? (/^[aeiou]/.test(noun) ? "an" : "a") : "the");
      }
    }

    replaced++;
    out = prefix + replacement;
    cursor = match.index + token.length + skip;
    PRONOUN_TOKEN.lastIndex = cursor;
  }

  if (replaced === 0) return { text: sentence, replaced: 0 };
  return { text: (out + sentence.slice(cursor)).replace(/ {2,}/g, " "), replaced };
}

/** Quoted spans — straight or curly double quotes — held out of the rewrite. */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;

export interface EmployeeNameResult {
  text: string;
  /** How many pronouns were replaced. */
  replaced: number;
}

/**
 * The text with pronouns for the employee replaced by their first name, where
 * that is unambiguous. See the header for what is never touched.
 *
 * `knownWords` are capitalised words that are not people in this form's
 * context — the brand, the salon — so naming them does not hold a sentence
 * back.
 */
export function nameInsteadOfPronouns(
  text: string,
  employeeName: string | null | undefined,
  knownWords: readonly string[] = [],
): EmployeeNameResult {
  const first = employeeFirstName(employeeName);
  if (!first || typeof text !== "string" || text.trim() === "") return { text, replaced: 0 };

  const nameParts = new Set(
    (employeeName ?? "").toLowerCase().split(/\s+/).map((part) => part.replace(/[^a-zÀ-ɏ'’-]/g, "")),
  );
  const known = new Set(knownWords.flatMap((word) => word.toLowerCase().split(/\s+/)));

  // Mask the quotations so nothing inside them can be rewritten.
  const quotes: string[] = [];
  const masked = text.replace(QUOTED, (quote) => {
    quotes.push(quote);
    return `\u0000${quotes.length - 1}\u0000`;
  });

  let replaced = 0;
  const rewritten = masked
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])(\s+)/)
        .map((piece) => {
          if (/^\s*$/.test(piece)) return piece;
          const result = rewriteSentence(piece, first, nameParts, known);
          replaced += result.replaced;
          return result.text;
        })
        .join(""),
    )
    .join("\n");

  if (replaced === 0) return { text, replaced: 0 };
  return {
    text: rewritten.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => quotes[Number(index)]!),
    replaced,
  };
}

/** The fields a pronoun rewrite may run on. */
export interface NameableField {
  key: string;
  input: string;
  responsibility: string;
  policyGrounded?: boolean;
}

/**
 * Applies `nameInsteadOfPronouns` across drafted values.
 *
 * ONLY THE ASSISTANT'S PROSE. Fields the version marks `ai`, not dates, not
 * policy-grounded, and not the keys the caller holds out (the server-derived
 * policy citations). A manager's own typing is theirs and is never rewritten.
 */
export function applyEmployeeName(input: {
  values: Record<string, string>;
  fields: readonly NameableField[];
  employeeName: string | null | undefined;
  skipKeys?: ReadonlySet<string>;
  knownWords?: readonly string[];
}): { values: Record<string, string>; adjusted: string[] } {
  if (!employeeFirstName(input.employeeName)) return { values: input.values, adjusted: [] };

  const eligible = new Set(
    input.fields
      .filter(
        (field) =>
          field.responsibility === "ai" &&
          field.input !== "date" &&
          field.policyGrounded !== true &&
          !input.skipKeys?.has(field.key),
      )
      .map((field) => field.key),
  );

  const values = { ...input.values };
  const adjusted: string[] = [];
  for (const [key, value] of Object.entries(input.values)) {
    if (!eligible.has(key) || typeof value !== "string") continue;
    const result = nameInsteadOfPronouns(value, input.employeeName, input.knownWords);
    if (result.replaced > 0) {
      values[key] = result.text;
      adjusted.push(key);
    }
  }
  return { values, adjusted };
}
