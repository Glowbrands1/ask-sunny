import { readDates, sameDate, withoutDates, type ReadDate } from "./dates";

/**
 * ============================================================================
 * A REPLY THAT RESTATES THE CARD'S ACCOUNT KEEPS THE ACCOUNT'S DATES
 * ============================================================================
 *
 * QA's Bubbles live re-run (22 Nov 2026, A3): "create corrective action for <P> for violating standards of conduct
 * policy on 10-20-26. <P> failed to acknowledge policies in woven by the 10-15-26 deadline." The card and the saved
 * draft said "by the 10/15/26 deadline"; the reply said "by the 10/20/26 deadline", the form's date put in the
 * account's place.
 *
 * The mechanism, read from the card's data and no wording: a reply sentence that restates one of the card's Observation
 * sentences (most of that sentence's words, dates aside, are in it) must carry every date that Observation sentence
 * holds. A restatement that swaps one for another date is a mismatch, handed back to the model with the card's facts
 * like every other card mismatch (`run.ts`, the reply's review against the card). A sentence that adds the form's date
 * beside the account's own dates is no mismatch.
 */

const MIN_WORDS = 3;
const RESTATES = 0.6;

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z*"'(])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function words(text: string): Set<string> {
  return new Set(
    withoutDates(text)
      .toLowerCase()
      .replace(/[^a-z0-9']+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3),
  );
}

interface DatedSentence {
  readonly text: string;
  readonly words: Set<string>;
  readonly dates: ReadDate[];
}

function dated(text: string): DatedSentence[] {
  return sentences(text)
    .map((sentence) => ({ text: sentence, words: words(sentence), dates: readDates(sentence) }))
    .filter((sentence) => sentence.dates.length > 0);
}

/** The Observation sentence this reply sentence restates, when it restates one. */
function restated(reply: DatedSentence, account: readonly DatedSentence[]): DatedSentence | null {
  let best: { sentence: DatedSentence; share: number } | null = null;
  for (const sentence of account) {
    if (sentence.words.size < MIN_WORDS) continue;
    let shared = 0;
    for (const word of sentence.words) if (reply.words.has(word)) shared += 1;
    const share = shared / sentence.words.size;
    if (share >= RESTATES && (!best || share > best.share)) best = { sentence, share };
  }
  return best?.sentence ?? null;
}

function misdated(reply: DatedSentence, account: readonly DatedSentence[]): ReadDate[] {
  const source = restated(reply, account);
  if (!source) return [];
  const keepsEvery = source.dates.every((date) => reply.dates.some((said) => sameDate(said, date)));
  if (keepsEvery) return [];
  return reply.dates.filter((said) => !source.dates.some((date) => sameDate(said, date)));
}

/**
 * The card-mismatch labels ("observation date (<date as the reply wrote it>)") for every reply sentence that restates
 * an Observation sentence with another date in place of one of its own. Empty when the card has no Observation.
 */
export function observationDateMismatch(reply: string, observation: string | null | undefined): string[] {
  if (!observation) return [];
  const account = dated(observation);
  if (account.length === 0) return [];
  const wrong = dated(reply).flatMap((sentence) => misdated(sentence, account).map((date) => `observation date (${date.text})`));
  return [...new Set(wrong)];
}

/**
 * The reply without the sentences that restate the Observation with another date: used only when the model's second
 * reply still does. The card under the reply shows the Observation as saved, so dropping the false restatement leaves
 * nothing untrue on screen. A reply that would be left empty is returned unchanged.
 */
export function withoutMisdatedRestatements(reply: string, observation: string | null | undefined): string {
  if (!observation) return reply;
  const account = dated(observation);
  if (account.length === 0) return reply;
  const lines = reply.split("\n");
  const kept = lines.map((line) => {
    const parts = sentences(line);
    if (parts.length === 0) return line;
    const keep = parts.filter((part) => {
      const [sentence] = dated(part);
      return !sentence || misdated(sentence, account).length === 0;
    });
    return keep.length === parts.length ? line : keep.join(" ");
  });
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out === "" ? reply : out;
}
