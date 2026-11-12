import { PRODUCTION_SALONS } from "@/data/salons";
import { titleBeforeNameEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A JOB TITLE BEFORE THE NAME IS NOT PART OF IT (TITLE_BEFORE_NAME_ENABLED; ported from Ask Bubbles, 11 Nov 2026)
 * ============================================================================
 *
 * QA's Ask Bubbles 17h live test: "Corrective action for Team Member <name>" gave no card. Here the same happens with
 * this app's titles ("Corrective action for Tanning Consultant <name>", "… for Salon Director <name>"): the words after
 * "for" count as a name only when the first could be one. A job title in front of the name says who the person is,
 * not what they are called. The state code of a roster salon is never read as one ("for NE Kearney" names a place);
 * "SD" is no roster salon's state here, so it is Salon Director, as `extractJobTitle` reads it. A title with no word
 * after it names nobody.
 */
const STATE_CODES = new Set(PRODUCTION_SALONS.map((salon) => salon.state.toLowerCase()));

/*
 * This app's job titles, in full and short, as `JOB_TITLES` in `forms/proposal.ts` reads them. Kept here because
 * `proposal.ts` imports `template-intent.ts`, which reads this file: importing it back made an import cycle that left
 * the roster readers uninitialised. `title-before-name.test.ts` checks every `JOB_TITLES` title is read here.
 */
const TITLES: readonly RegExp[] = [
  /^(?:sdits?|salon directors? in training)$/i,
  /^(?:tsds?|training salon directors?)$/i,
  /^(?:dmits?|district managers? in training)$/i,
  /^(?:fttcs?|full[- ]time tanning consultants?)$/i,
  /^(?:asds?|assistant salon directors?)$/i,
  /^(?:tcs?|tanning consultants?)$/i,
  /^(?:sds?|salon directors?)$/i,
  /^(?:dms?|district managers?)$/i,
];

function isWholeTitle(phrase: string): boolean {
  const bare = phrase.replace(/[.,;:]+$/, "").trim();
  if (bare === "" || STATE_CODES.has(bare.toLowerCase())) return false;
  return TITLES.some((title) => title.test(bare.replace(/\s+/g, " ")));
}

/** How many of the leading words are a job title (0 when none, or the flag off, or no word follows it). */
export function leadingTitleLength(words: readonly string[]): number {
  if (!titleBeforeNameEnabled()) return 0;
  for (let length = Math.min(4, words.length - 1); length >= 1; length -= 1) {
    if (isWholeTitle(words.slice(0, length).join(" "))) return length;
  }
  return 0;
}

/** "Tanning Consultant Wren Tallis" → "Wren Tallis"; anything else, or the flag off, as typed. */
export function withoutLeadingTitle(name: string): string {
  const words = name.trim().split(/\s+/);
  const skip = leadingTitleLength(words);
  // The sibling app's Gate-Bubbles R795T (12 Nov 2026): "Team Member Of The Month" names an award, not "Of The Month".
  const rest = withoutTrailingTime(words.slice(skip));
  return skip === 0 || !personLike(rest) ? name : rest.join(" ");
}

const NAME_WORD = /^\p{Lu}[\p{L}'’-]*$/u;

/*
 * The sibling app's Gate-Bubbles R795T (12 Nov 2026): "Create a CA for Team Member Of The Month" gave a ready card for
 * "Of The Month". The words after a title are a person's name only when none is a joining word or a word for a time, an
 * event or a shift ("Of The Month", "Of The Year", "Training", "Visit").
 */
const NOT_A_NAME_WORD = new Set(
  (
    "of the and or for a an to in on at by with from " +
    "day days week weeks weekly month months monthly year years yearly quarter quarters today tomorrow yesterday " +
    "monday mondays tuesday tuesdays wednesday wednesdays thursday thursdays friday fridays saturday saturdays sunday sundays weekend weekends " +
    "training trainings visit visits meeting meetings shift shifts review reviews evaluation evaluations award awards party parties " +
    "orientation onboarding schedule schedules huddle huddles inventory audit audits " +
    "approval approvals request requests check checks call calls walk walkthrough coverage deadline deadlines report reports"
  ).split(" "),
);

/*
 * Gate-Sunny's probe (12 Nov 2026): "for Tanning Consultant Wren Tallis Today" — a time word after the name ends it; it
 * never joins it. The name is "Wren Tallis".
 */
const TRAILING_TIME = new Set(
  "today tonight tomorrow yesterday now monday tuesday wednesday thursday friday saturday sunday".split(" "),
);

/** The words with any time words at their end left off ("Wren Tallis Today" → "Wren Tallis"). */
function withoutTrailingTime(words: readonly string[]): string[] {
  let end = words.length;
  while (end > 0 && TRAILING_TIME.has(words[end - 1]!.toLowerCase().replace(/[.,;:!?]+$/, ""))) end -= 1;
  return words.slice(0, end);
}

/** One to three words, each shaped like a name and none of them a joining, time, event or shift word. */
function personLike(words: readonly string[]): boolean {
  return (
    words.length >= 1 &&
    words.length <= 3 &&
    words.every((word) => NAME_WORD.test(word) && !NOT_A_NAME_WORD.has(word.toLowerCase().replace(/[.,;:!?]+$/, "")))
  );
}

/**
 * QA's ruling (11 Nov 2026): "Corrective action for Salon Director <name>" reached the roster step with no name: the
 * protected reader took "Salon" as a place and read "Director <name>", and that was set aside. The name the request
 * gives after "for <title>", one to three person-like words up to the end of the sentence, or null.
 */
export function nameAfterTitle(message: string | undefined): string | null {
  if (!titleBeforeNameEnabled() || !message) return null;
  for (const match of message.matchAll(/\bfor\s+([^.,;:!?\n]+)/giu)) {
    const words = match[1]!.trim().split(/\s+/);
    const skip = leadingTitleLength(words);
    if (skip === 0) continue;
    const name = withoutTrailingTime(words.slice(skip));
    if (personLike(name)) return name.join(" ");
  }
  return null;
}

/**
 * The card's create check (`proposal-currency.ts`) re-reads the employee from the conversation and refused the card:
 * "the conversation now says the form is for Director <name>, not <name>". The conversation's reading is the card's
 * name with a title in front of it, and the request said "for <title> <name>": that is the same person.
 */
export function sameNameAfterTitle(read: string, card: string, userTurns: readonly string[]): boolean {
  if (!titleBeforeNameEnabled()) return false;
  const reading = read.trim().toLowerCase().replace(/\s+/g, " ");
  const name = card.trim().toLowerCase().replace(/\s+/g, " ");
  if (!name || reading === name || !reading.endsWith(` ${name}`)) return false;
  return userTurns.some((turn) => (nameAfterTitle(turn) ?? "").toLowerCase() === name || withoutLeadingTitle(read).toLowerCase() === name);
}
