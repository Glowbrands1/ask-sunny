import { readSalonMentions } from "./salon-mention";

/**
 * ============================================================================
 * "LOCATION ST JOE" NAMES THE SALON
 * ============================================================================
 *
 * QA Round 4, 24 Oct 2026: "name is test testyone, location st joe, today's
 * date, …" left the card on Wornall, the salon an earlier turn had named.
 * The roster reader (`salon-mention.ts`, protected) counts a short name only
 * behind a place cue, and a field label in front of it ("location st joe",
 * "salon is wornall", "store: lawrence") was not one. "st joe location"
 * already was.
 *
 * Read at the caller instead: the label is put as "at", which IS a cue, and
 * the roster reader then applies every rule it already has — the name must
 * still be followed by a clause break or a word that carries the sentence
 * on, so "salon liberty to decide" is still nobody's salon. The original text
 * is read as well, so "salon 410" and "store #373" keep their number reading.
 */
const FIELD_LABEL = /\b(?:location|salon|store)\b\s*(?:(?:is|was)\s+|[:=-]\s*)?(?=[a-z0-9#])/gi;

/** Clause punctuation as the roster reader's separator, the way callers already pass it. */
function visible(text: string): string {
  return text.replace(/[.!]+/g, " ; ").replace(/[\n\r]+/g, " ; ");
}

function idsIn(text: string): string[] {
  const labelled = text.replace(FIELD_LABEL, "at ");
  return [
    ...new Set([...readSalonMentions(text), ...readSalonMentions(labelled)].flatMap((mention) => mention.salonIds)),
  ];
}

/**
 * The roster salons a manager turn names, a field label counting as a place
 * cue. Read with sentence breaks shown first, then as typed, because a period
 * can sit inside a name ("St. Joseph").
 */
export function labelledSalonIds(turn: string): string[] {
  const shown = idsIn(visible(turn));
  return shown.length > 0 ? shown : idsIn(turn);
}
