import { unknownPlaceNotAccountEnabled, unknownPlaceSaidEnabled } from "@/lib/config/chat-quality-flags";
import { readSalonMentions } from "@/lib/forms/salon-mention";

/**
 * ============================================================================
 * A PLACE AFTER THE EMPLOYEE'S NAME IS WHERE, NOT WHAT HAPPENED
 * ============================================================================
 *
 * UNKNOWN_PLACE_NOT_ACCOUNT_ENABLED (QA's D5 follow-up, 11 Nov 2026; default off). "Create an SDIT EPP for <name> at
 * Kearney" gives no Observation of Offense: Kearney is a salon, so the sentence says nothing beyond the request. "… at IA
 * Altoona" is not one of the salons, so its words counted as an account, and the card read "**Observation of Offense:**
 * Create an SDIT EPP for <name> at IA Altoona" (and "<name> at IA Altoona" on a coaching card). On: "at"/"in" and up to
 * four capitalised or state-code words straight after the employee's name, ending the sentence, come off before the
 * sentence is read as an account. Anything else ("<name> was rude at the front desk") is left as it was. Off: unchanged.
 */
const PLACE_AFTER = /^\s*,?\s*(?:at|in)\s+(?:the\s+)?((?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*){0,3})\s*[.!?]*\s*$/;

export function withoutPlaceAfterName(sentence: string, employeeName: string | null): string {
  if (!unknownPlaceNotAccountEnabled() || !employeeName?.trim()) return sentence;
  const name = employeeName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const at = new RegExp(`\\b${name}\\b`, "i").exec(sentence);
  if (!at) return sentence;
  const end = at.index + at[0].length;
  return PLACE_AFTER.test(sentence.slice(end)) ? sentence.slice(0, end) : sentence;
}

/** The place said straight after the employee's name at the end of a sentence ("… for <name> at IA Altoona"), else null. */
function placeAfterName(sentence: string, employeeName: string): string | null {
  const name = employeeName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const at = new RegExp(`\\b${name}\\b`, "i").exec(sentence);
  if (!at) return null;
  return PLACE_AFTER.exec(sentence.slice(at.index + at[0].length))?.[1] ?? null;
}

const EVERY_SALON_LINE = /Your account covers every salon, so (?:this|the) form won't name one(?: unless you did)?\./;

/**
 * UNKNOWN_PLACE_SAID_ENABLED (QA's D5 follow-up, 11 Nov 2026; default off). An all-salon admin who names a place that is
 * not one of the salons ("Create an SDIT EPP for <name> at IA Altoona") was told "Your account covers every salon, so this
 * form won't name one", as though no place was said. On: that sentence says the place is not one of the salons. Only
 * when the card names no salon and a sentence of the manager's ends with the place after the employee's name; a place
 * the salon reader knows is never called unknown. Off: unchanged.
 */
export function withUnknownPlaceSaid(input: {
  readonly content: string;
  readonly turns: readonly string[];
  readonly employeeName: string | null;
  readonly locationResolution: string | null | undefined;
}): string {
  if (!unknownPlaceSaidEnabled() || input.locationResolution !== "not_applicable" || !input.employeeName?.trim()) return input.content;
  if (!EVERY_SALON_LINE.test(input.content)) return input.content;
  for (const turn of [...input.turns].reverse()) {
    for (const sentence of turn.split(/\n+|(?<=[.!?])\s+|,\s+/)) {
      const place = placeAfterName(sentence, input.employeeName);
      // The salon reader reads a bare town only after "at"/"in" ("at Kearney"), so it is given the phrase.
      if (!place || readSalonMentions(`at ${place}`).length > 0) continue;
      return input.content.replace(EVERY_SALON_LINE, `${place} isn't one of our salons, so this form won't name one.`);
    }
  }
  return input.content;
}
