import { reasonPlaceNeverSalonEnabled, reasonPlaceNotSalonEnabled } from "@/lib/config/chat-quality-flags";

/*
 * REASON_PLACE_NOT_SALON_ENABLED (ported from the sibling app, Gate-Bubbles-3's #869 probes, 13 Nov 2026): "she was
 * late because she was at <place>" — the place says why she was late, not the salon the form is for. The place in a
 * "because <she|he|they|I|we|a name> was/were at|in …" clause, up to the clause's end ("," "." ";" "and" "but"), is
 * blanked (same length) before the salons are read. The reason may also start "bc", "b/c", "cause", "'cause", "cuz" or
 * "since" (the sibling gate's probes); "since" as a time word ("since 11/3 she has been late at …") is not one. "at grand island, she was late" and "late at grand island" are not
 * reasons and are still read. Only for reading the salon: the account keeps the words.
 */
const REASON_PLACE =
  /(\b(?:because|bc|b\/c|cause|'cause|cuz|since)\s+(?:she|he|they|i|we|[a-z][a-z'’-]*)\s+(?:was|were|had\s+been)\s+)((?:at|in)\s+[^,.;:!?()\n]*?)(?=\s*(?:[,.;:!?()\n]|$)|\s+(?:and|but)\b)/gi;

export function withoutReasonPlaces(text: string): string {
  return text.replace(REASON_PLACE, (_, lead: string, place: string) => `${lead}${" ".repeat(place.length)}`);
}

/** `text` with a reason's place blanked when REASON_PLACE_NOT_SALON_ENABLED is on; for the readers that guess a salon. */
export function placeReadingText(text: string): string {
  return reasonPlaceNotSalonEnabled() ? withoutReasonPlaces(text) : text;
}

/**
 * REASON_PLACE_NEVER_SALON_ENABLED (ported from the sibling app's 17z live bug, QA 14 Nov 2026): the places said inside a
 * reason ("because she was at kearney" → "at kearney"), as typed, for the AI reader, whose location reading would take
 * them as the salon. Empty unless REASON_PLACE_NOT_SALON and this flag are on.
 */
export function reasonPlaceSpans(text: string): string[] {
  if (!reasonPlaceNotSalonEnabled() || !reasonPlaceNeverSalonEnabled()) return [];
  return [...text.matchAll(REASON_PLACE)].map((match) => match[2]!);
}
