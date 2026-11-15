import { notAPerson } from "@/lib/forms/person-guard";
import { isFormVocabulary } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * THE ACCOUNT NAMES SOMEONE ELSE (batch K, K4; QA's design, 15 Nov 2026)
 * ============================================================================
 *
 * The shadow replay of 266 real manager chats: a manager asked for a form for <X> and pasted an account whose story
 * is <Y>'s. The right-person guard only looked for roster names in the turns, so an account about somebody not on
 * the roster, or about a roster person in the same turn as <X>, was carded for <X> without a word.
 *
 * Code informs, never reads intent: every full person name the manager's own words carry other than the card's
 * person is a fact for the model (`account_names_other_person`), with the sentence it was said in. The rules book
 * teaches the question ("This account is about <Y>. Is the form for <Y> or <X>?") for an account that is about <Y>,
 * and no question for a name that is only mentioned ("<Y> saw it", "<Y> covered her shift"). Pure.
 */

export interface OtherPersonInAccount {
  readonly name: string;
  /** The sentence the name was said in, as the manager wrote it. */
  readonly said: string;
}

/** A capitalised run of two or three words: "Odalys Fenwick", "Mary Ann Fenwick". A trailing 's is not part of it. */
const CAPITALISED_RUN = /(?<![A-Za-z'’-])([A-Z][a-z]+(?:['’-][A-Za-z]+)?(?:\s+[A-Z][a-z]+(?:['’-][A-Za-z]+)?){1,2})(?:['’]s)?(?![A-Za-z])/g;

const SENTENCES = /[^.!?\n]+[.!?]*/g;

const CALENDAR = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The full person names in `text` other than the card's person, each once, in the order said. `rosterNames` are the
 * roster's full names (preferred and legal), found in any capitalisation; every other name is a capitalised run of two
 * or three words that the app's person guard does not rule out. `same` is the app's "same person" test; `own` are
 * the names that are never another person (the signed-in manager, the card's person).
 */
export function otherPeopleInAccount(
  text: string,
  employee: string,
  rosterNames: readonly string[],
  same: (a: string, b: string) => boolean,
  own: readonly string[] = [],
): OtherPersonInAccount[] {
  const found: OtherPersonInAccount[] = [];
  const add = (name: string, sentence: string) => {
    const tidy = name.replace(/\s+/g, " ").trim();
    if (!tidy || same(tidy, employee) || own.some((mine) => same(tidy, mine))) return;
    if (found.some((known) => same(known.name, tidy))) return;
    found.push({ name: tidy, said: sentence.trim().slice(0, 300) });
  };
  const sentences = text.match(SENTENCES) ?? [];
  for (const sentence of sentences) {
    for (const full of rosterNames) {
      if (full.trim().split(/\s+/).length < 2) continue;
      if (new RegExp(`(?<![A-Za-z])${escaped(full.trim())}(?![A-Za-z])`, "i").test(sentence)) add(full, sentence);
    }
    for (const match of sentence.matchAll(CAPITALISED_RUN)) {
      const candidate = match[1]!;
      /* A date or a day is not a name ("Monday November"); the app's person guard rules out policies, metrics, places and forms. */
      if (candidate.split(/\s+/).some((word) => CALENDAR.test(word) || isFormVocabulary(word.toLowerCase())) || notAPerson(candidate)) continue;
      add(candidate, sentence);
    }
  }
  return found;
}
