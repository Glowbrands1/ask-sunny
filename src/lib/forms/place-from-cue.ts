import { withoutAppLines } from "@/lib/ai/app-sentences";
import { placeFromCueEnabled } from "@/lib/config/chat-quality-flags";

import { readSalonMentions, type SalonMention } from "./salon-mention";

/*
 * PLACE_FROM_CUE_ENABLED (QA's Sunny gate, 6 Nov 2026, sf-s28): "can you write me a ca for <name>
 * from o street" says which salon the employee is from, but "from" is no place cue for the salon
 * reader, so the salon was never read (and the intake then added the employee's own salon). With
 * the flag on, "for <one to three name words> from <word>" is read as "at <word>" — for the salon
 * readers only (`location-scope.ts`, `ai/intake-augment.ts`); nothing else sees the change. Only
 * that shape: "she transferred from …", "a call from the salon", "a complaint from a guest" and
 * "from 10/5" are left as they are. The salon still has to be one the roster names.
 */
const FOR_NAME_FROM = /(\bfor\s+(?:[\p{L}'’-]+\s+){1,3}?)from\s+(?=\p{L})/giu;

/** The text the salon reader reads: "for <name> from <salon>" as "for <name> at <salon>" with the flag on. */
export function placeText(text: string): string {
  return placeFromCueEnabled() ? text.replace(FOR_NAME_FROM, "$1at ") : text;
}

/**
 * The salons the text names. With the flag on, the manager's own words come first: the lines the
 * app writes back onto a turn ("It happened at NE Kearney.", `ai/app-sentences.ts`) are the app's
 * earlier reading, so they count only when the manager's words name no salon. Off, as before.
 */
export function placeMentions(text: string): SalonMention[] {
  if (!placeFromCueEnabled()) return readSalonMentions(text);
  const own = readSalonMentions(placeText(withoutAppLines(text)));
  return own.length > 0 ? own : readSalonMentions(placeText(text));
}
