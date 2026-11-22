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

/** The reply without its sentences that name a guessed salon (the salon question is asked after it). */
export function withoutSalonGuess(reply: string, guessed: readonly string[]): string {
  const sentences = reply.split(/(?<=[.!?])\s+|\n+/);
  const named = (sentence: string) => readSalonMentions(sentence).length > 0 && salonsNamedNotSaid(sentence, [], null).some((name) => guessed.includes(name));
  return sentences.filter((sentence) => !named(sentence)).join(" ").trim();
}
