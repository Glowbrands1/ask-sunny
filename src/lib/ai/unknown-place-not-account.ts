import { unknownPlaceNotAccountEnabled } from "@/lib/config/chat-quality-flags";

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
const PLACE_AFTER = /^\s*,?\s*(?:at|in)\s+(?:the\s+)?(?:[A-Z][\w'’.-]*)(?:\s+[A-Z][\w'’.-]*){0,3}\s*[.!?]*\s*$/;

export function withoutPlaceAfterName(sentence: string, employeeName: string | null): string {
  if (!unknownPlaceNotAccountEnabled() || !employeeName?.trim()) return sentence;
  const name = employeeName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const at = new RegExp(`\\b${name}\\b`, "i").exec(sentence);
  if (!at) return sentence;
  const end = at.index + at[0].length;
  return PLACE_AFTER.test(sentence.slice(end)) ? sentence.slice(0, end) : sentence;
}
