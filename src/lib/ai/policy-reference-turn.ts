import { policyReferenceNotAccountEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * "YOU CAN REFERENCE THE STANDARDS OF CONDUCT FOR A POLICY" IS NO ACCOUNT
 * (POLICY_REFERENCE_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * QA's overnight scan, 4 Nov 2026 (sf-s16, sf-s17): after the CA card, turn 2
 * told the app which policy to cite —
 *
 *   "In the past we have quoted the standards of conduct for creating a ca due to underperformance"
 *   "you can reference the standards of conduct for a policy"
 *
 * The card switched its policy, and Create handed the sentence to the drafting
 * model as part of what happened. A turn that only says which policy to
 * quote, cite or reference is about the form, not the incident: with the flag
 * on it is left out of "WHAT THE MANAGER DESCRIBED". The draft's policy
 * readers still read the notes as sent, so the policy still moves. Off, as
 * before.
 */

const POLICY_NAME =
  /\b(?:polic(?:y|ies)|standards?\s+of\s+conduct|late\s+opening|attendance|dress\s+code|cash\s+handling|care\s+and\s+cleaning|safety\s+in\s+the\s+workplace|meal\s+and\s+rest|social\s+media|handbook|manual)\b/i;

/** Saying which policy goes on the form: quote, cite, reference, use, go with, put or file it under. */
const CITE =
  /\b(?:quot(?:e|ed|es|ing)|cit(?:e|ed|es|ing)|referenc(?:e|ed|es|ing)|refer\s+to|(?:use|used|using)\s+(?:the\s+)?(?=\S)|go\s+(?:with|under)|put\s+(?:it|this|that)?\s*under|file\s+(?:it|this|that)?\s*under|list\s+(?:it|this|that)?\s*under)/i;

/** An account of what happened, whatever else the sentence says. */
const ACCOUNT = /\b(?:she|he|they|employee)\s+(?:was|were|did|didn'?t|did\s+not|has|had|left|came|showed|clocked|refused|failed)\b/i;

const MAX_WORDS = 25;

/** Whether a sentence only says which policy to quote, cite or reference. */
export function isPolicyReference(sentence: string): boolean {
  const said = sentence.trim().replace(/[.!]+$/, "");
  if (said === "" || said.split(/\s+/).length > MAX_WORDS) return false;
  return POLICY_NAME.test(said) && CITE.test(said) && !ACCOUNT.test(said);
}

/** The notes ("\n\n" between turns) without the turns that only say which policy to cite. Never empties them. */
export function withoutPolicyReferenceTurns(notes: string): string {
  if (!policyReferenceNotAccountEnabled()) return notes;
  const turns = notes.split(/\n{2,}/);
  const kept = turns.filter((turn) => {
    const sentences = turn.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    return sentences.length === 0 || !sentences.every(isPolicyReference);
  });
  return kept.length === 0 || kept.length === turns.length ? notes : kept.join("\n\n");
}
