import { policyCorrectionNotAccountEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * "IT SHOULD BE UNDER PERFORMANCE NOT STANDARD OF CONDUCT" IS NO ACCOUNT (POLICY_CORRECTION_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * QA's Sunny round-5 live tester (8 Nov 2026), item 3, pre-existing: on a sales Corrective Action, turn 4 "it should
 * be under performance not standard of conduct" was pasted into the card's Observation of Offense after the account
 * (in the sibling app it replaced the Issue). A sentence that only says which policy or category applies is about the
 * form, not about what happened. With the flag on, it is left out of the account; the turn itself stays in the request,
 * so the policy readers still read it ("it should be attendance not standards of conduct" still moves the policy).
 * Off, false.
 */

/** Words that name a policy or a CA category, so the correction is about the policy. */
const POLICY_WORDS =
  /\b(?:polic(?:y|ies)|standards?\s+of\s+conduct|conduct|under\s*-?\s*performance|performance|attendance|tardiness|dress\s+code|cash\s+handling|cleaning|sanitation|safety|harassment|insubordination|sales)\b/i;

/** "it should be X not Y", "it needs to be X, not Y", "it's X not Y", "should be X instead of Y", "wrong policy". */
const SHOULD_BE = /^(?:(?:it|this|that|the\s+(?:policy|category|offense|form|ca))\s+)?(?:should|needs?\s+to|has\s+to|must|is\s+supposed\s+to)\s+be\s+(.+?)\s*,?\s+(?:not|instead\s+of|rather\s+than)\s+(.+)$/i;
const IS_NOT = /^(?:it'?s|its|it\s+is|this\s+is|that'?s)\s+(.+?)\s*,?\s+not\s+(.+)$/i;
const WRONG_POLICY = /^(?:(?:that|this|it)(?:'s|\s+is)\s+)?(?:the\s+)?wrong\s+(?:polic(?:y|ies)|category)\b/i;

/** Whether a sentence only corrects which policy or category the form is under. */
export function isPolicyCorrection(sentence: string): boolean {
  if (!policyCorrectionNotAccountEnabled()) return false;
  const said = sentence.trim().replace(/[.!]+$/, "");
  if (said === "" || said.split(/\s+/).length > 14) return false;
  if (WRONG_POLICY.test(said)) return true;
  const shape = SHOULD_BE.exec(said) ?? IS_NOT.exec(said);
  return shape !== null && (POLICY_WORDS.test(shape[1]!) || POLICY_WORDS.test(shape[2]!));
}
