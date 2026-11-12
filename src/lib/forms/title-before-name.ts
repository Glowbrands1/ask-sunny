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
 * not what they are called. A state code is never read as one ("for SD Sioux Falls" names a place), and a title with
 * no word after it names nobody.
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
  return skip === 0 ? name : words.slice(skip).join(" ");
}

const NAME_WORD = /^\p{Lu}[\p{L}'’-]*$/u;

/**
 * QA's ruling (11 Nov 2026): "Corrective action for Salon Director <name>" reached the roster step with no name: the
 * protected reader took "Salon" as a place and read "Director <name>", and that was set aside. The name the request
 * gives after "for <title>", one to three capitalised words up to the end of the sentence, or null.
 */
export function nameAfterTitle(message: string | undefined): string | null {
  if (!titleBeforeNameEnabled() || !message) return null;
  for (const match of message.matchAll(/\bfor\s+([^.,;:!?\n]+)/giu)) {
    const words = match[1]!.trim().split(/\s+/);
    const skip = leadingTitleLength(words);
    if (skip === 0) continue;
    const name = words.slice(skip);
    if (name.length >= 1 && name.length <= 3 && name.every((word) => NAME_WORD.test(word))) return name.join(" ");
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
