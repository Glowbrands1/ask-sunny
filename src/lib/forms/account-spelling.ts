import { accountTyposFixedEnabled } from "@/lib/config/chat-quality-flags";

import { correctedText } from "./typo-match";
import { NEVER_CORRECTED, typoVocabulary } from "./typo-vocabulary";

/**
 * ============================================================================
 * THE CARD'S ACCOUNT, WITH THE OBVIOUS TYPOS MENDED
 * ============================================================================
 *
 * ACCOUNT_TYPOS_FIXED_ENABLED (QA, the Sunny sanitation report, 10 Nov 2026 18:49Z; default off). "please make a ca for
 * <name> for not doing th e10 minute sanitaion" put "**Observation of Offense:** not doing th e10 minute sanitaion" on the
 * card. On: the card's account keeps the manager's words with the obvious slips mended — a word broken before a number
 * ("th e10" → "the 10"), a misspelling one edit from a known word ("sanitaion" → "sanitation"; `typo-match.ts`'s rules: same
 * first letter, no tie, never a name or a listed real word), and "10 minute sanitation" → "10-minute sanitation". Nothing
 * is reworded, and dates, numbers and titles are left as typed (FORM_INPUT_FIDELITY, S#166, is about those; it is untouched).
 * Off: the text as written.
 */
const ACCOUNT_WORDS = [
  "sanitation", "sanitize", "sanitized", "cleaning", "cleaned", "minute", "minutes", "morning", "evening", "closing",
  "opening", "register", "drawer", "shift", "lotion", "towels", "customer", "complaint", "schedule", "completed",
];
const SHORT_WORDS = new Set(["the", "a", "an", "to", "of", "in", "on", "at", "for", "and", "her", "his", "my", "our"]);

/** "th e10" → "the 10": a short word whose last letter slipped onto the number after it. */
function withWordBreaksMended(text: string): string {
  return text.replace(/\b([a-z]{1,4}) ([a-z])(\d)/gi, (whole, head: string, tail: string, digit: string) =>
    SHORT_WORDS.has(`${head}${tail}`.toLowerCase()) && !SHORT_WORDS.has(head.toLowerCase()) ? `${head}${tail} ${digit}` : whole,
  );
}

/** "10 minute sanitation" → "10-minute sanitation": a number and a unit before the noun they describe. */
function withUnitHyphen(text: string): string {
  return text.replace(/\b(\d+) (minute|hour|day|week)\b(?=\s+[a-z])/gi, "$1-$2");
}

/** The account as the card shows it. `name` words (the employee's) are never corrected. */
export function cardAccountText(text: string, name: string | null | undefined): string {
  if (!accountTyposFixedEnabled()) return text;
  const protectedWords = new Set((name ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const list = [...new Set([...typoVocabulary(), ...ACCOUNT_WORDS])];
  const spelled = correctedText(withWordBreaksMended(text), list, (word) => protectedWords.has(word.toLowerCase()) || NEVER_CORRECTED.has(word)).text;
  return withUnitHyphen(spelled);
}
