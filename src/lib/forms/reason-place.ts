import { reasonPlaceNotSalonEnabled, reasonSubjectAnyNounPhraseEnabled } from "@/lib/config/chat-quality-flags";

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

/*
 * REASON_SUBJECT_ANY_NOUN_PHRASE_ENABLED (Gate-Sunny's #975 follow-up, QA 14 Nov 2026): "she left early because her kid
 * was sick in lincoln" — the reason's subject may be a noun phrase ("her kid", "her car", up to four words), its verb
 * "got" / "went" / "stayed" / "broke down" / "had to be" (Gate-Sunny's #989 probe: "because she had to be in grand
 * island"), and up to two words may stand before the place ("was sick in …", "was stuck in …"), never a
 * work word: "because she was late at kearney" says where she was late, and is still read.
 */
const REASON_WORK_WORD = String.raw`(?!(?:late|early|tardy|working|scheduled|absent|on|off|rude|caught|written|clocked|work|shift)\b)`;
export const REASON_LEAD_WIDE = String.raw`\b(?:because|bc|b\/c|cause|'cause|cuz|since)\s+(?:[a-z][a-z'’-]*\s+){0,3}?[a-z][a-z'’-]*\s+(?:was|were|had\s+been|got|went|stayed|broke\s+down|(?:had|has|needed)\s+to\s+be)(?:\s+${REASON_WORK_WORD}[a-z][a-z'’-]*){0,2}?`;
const REASON_PLACE_WIDE = new RegExp(
  String.raw`(${REASON_LEAD_WIDE}\s+)((?:at|in)\s+[^,.;:!?()\n]*?)(?=\s*(?:[,.;:!?()\n]|$)|\s+(?:and|but)\b)`,
  "gi",
);

export function withoutReasonPlaces(text: string): string {
  const blanked = text.replace(REASON_PLACE, (_, lead: string, place: string) => `${lead}${" ".repeat(place.length)}`);
  if (!reasonSubjectAnyNounPhraseEnabled()) return blanked;
  return blanked.replace(REASON_PLACE_WIDE, (_, lead: string, place: string) => `${lead}${" ".repeat(place.length)}`);
}

/** `text` with a reason's place blanked when REASON_PLACE_NOT_SALON_ENABLED is on; for the readers that guess a salon. */
export function placeReadingText(text: string): string {
  return reasonPlaceNotSalonEnabled() ? withoutReasonPlaces(text) : text;
}
