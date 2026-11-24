import { readSalonMentions, rosterSalonName } from "@/lib/forms/salon-mention";

/**
 * ============================================================================
 * A REPLY NEVER NAMES A SALON NOBODY NAMED (QA's re-run, 22 Nov 2026, A8; port of Ask Bubbles #1010)
 * ============================================================================
 *
 * Found in Ask Bubbles: a team Coaching card with no location yet, and a manager turn naming a program by its
 * abbreviation, got "which <city> location is this for, <A> or <B>?" The app's own place reader reads no place in those
 * turns; the model guessed one from the abbreviation. Salons are read with the app's own reader (`readSalonMentions`),
 * so no word list: a salon the reply names that no manager turn names and the card does not hold is a guess.
 */

/** The display names of the salons the reply names that no manager turn names and the card does not hold. */
export function salonsNamedNotSaid(reply: string, managerTurns: readonly string[], cardSalonId: string | null): string[] {
  const said = new Set(managerTurns.flatMap((turn) => readSalonMentions(turn).flatMap((mention) => [...mention.salonIds])));
  if (cardSalonId) said.add(cardSalonId);
  const named = readSalonMentions(reply).flatMap((mention) => [...mention.salonIds]);
  const guessed = [...new Set(named.filter((id) => !said.has(id)))];
  return guessed.map((id) => rosterSalonName(id) ?? id);
}

/**
 * The reply without its sentences that name a guessed salon (the salon question is asked after it). A question right
 * after a dropped sentence, in the same paragraph, asks about the salons that sentence named ("You have two <city>
 * salons — A and B. Which one is this coaching for?", Ask Bubbles' live re-run 2, A8; port of #1033), so it goes with it.
 */
export function withoutSalonGuess(reply: string, guessed: readonly string[]): string {
  const named = (sentence: string) => readSalonMentions(sentence).length > 0 && salonsNamedNotSaid(sentence, [], null).some((name) => guessed.includes(name));
  return reply
    .split(/\n+/)
    .map((paragraph) => {
      let dropped = false;
      return paragraph
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          const drop = named(sentence) || (dropped && /\?\s*$/.test(sentence));
          dropped = drop;
          return !drop;
        })
        .join(" ")
        .trim();
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}
