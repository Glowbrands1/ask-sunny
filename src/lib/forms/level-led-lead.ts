import { levelLeadsRequestEnabled } from "@/lib/config/chat-quality-flags";

/*
 * LEVEL_LEADS_REQUEST_ENABLED (QA's live test in the sibling app, 14 Nov 2026): "second verbal for <A>, she was late on
 * 11/12/26" was read as the request (its level the card's), but the request clause stayed in the card's account and the
 * saved Observation. The level-led clause up to its comma is the request, as "can you make a CA for <A>," is; what
 * follows is the account. A level "for the same thing" / "for that" points back at an earlier one and is not a request.
 */
const LEVEL_LED_LEAD =
  /^\s*(?:please\s+)?(?:(?:a|an|her|his|their)\s+)?(?:(?:second|2nd|third|3rd|another|new|first|1st)\s+)?(?:verbal|written)(?:\s+warning)?\s+for\s+(?!(?:the\s+same|this\s+same|same|that|it|this)\b)[^,]*,\s*(?=\S)/i;

/** The sentence opens with a level-led request ("second verbal for <A>, …"); flag off, never. */
export function opensWithLevelLedRequest(sentence: string): boolean {
  return levelLeadsRequestEnabled() && LEVEL_LED_LEAD.test(sentence);
}

/** "second verbal for <A>, she was late …" → "she was late …"; flag off, or no such lead, unchanged. */
export function withoutLevelLedRequestLead(sentence: string): string {
  return levelLeadsRequestEnabled() ? sentence.replace(LEVEL_LED_LEAD, "") : sentence;
}
