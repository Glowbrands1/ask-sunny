import { isDocumentaryLookup } from "./employee-performance-gate";

/**
 * ============================================================================
 * WHEN A QUESTION NEEDS THE PERFORMANCE MANAGEMENT FRAMEWORK
 * ============================================================================
 *
 * The framework defines the corrective-action progression and how each of its
 * documents is completed. It is mandatory grounding for questions about that
 * progression, and it FAILS CLOSED — so the cost of this gate being wrong is
 * asymmetric in the opposite direction from most keyword gates in this codebase,
 * and the list below is written for that asymmetry:
 *
 *   A FALSE NEGATIVE costs a worse answer. Sunny describes a progression from
 *   general knowledge rather than from Sun Tan City's, and the manager skips a
 *   rung the company's sequence requires.
 *
 *   A FALSE POSITIVE costs a REFUSAL. A question the knowledge base answers
 *   perfectly — "what does the attendance policy say?" — comes back as "the
 *   framework is unavailable" if the document happens not to be indexed.
 *
 * The second is worse, because it breaks a working answer rather than degrading
 * one. So this gate is deliberately NARROW, and narrower than
 * `employee-performance-gate.ts`: it fires on vocabulary that names the
 * performance-management SYSTEM, not on vocabulary that merely appears in
 * questions about people.
 *
 * ============================================================================
 * TWO WAYS IN, AND NEITHER IS A BARE DOCUMENT NOUN
 * ============================================================================
 *
 * 1. A SYSTEM TERM. "Corrective action", "performance management", "progressive
 *    discipline", "Management Diamond" — phrases that mean the framework's own
 *    subject and nothing else in this product. "Corrective action" is the
 *    headline case: it is the name of the whole ladder, so a question containing
 *    it is a question about the ladder.
 *
 * 2. A DECISION ABOUT A RUNG. "When should I put someone on an EPP?", "what
 *    comes after a DPOA?", "do I need to escalate this?" — a document or a step
 *    NAMED, plus a shape that asks which rung applies. The framework's §9.7 and
 *    §9.8 exist for exactly these two questions.
 *
 * A rung named WITHOUT a decision shape is not enough, and that is the rule that
 * keeps ordinary work unblocked. "Where is the coaching form?" names a rung and
 * is a lookup. "Create a DPOA for Sarah" names a rung and is handled by the
 * Forms library before retrieval runs at all.
 *
 * ============================================================================
 * DOCUMENTARY LOOKUPS ARE SUPPRESSED, USING THE OTHER GATE'S TEST
 * ============================================================================
 *
 * `isDocumentaryLookup` is imported rather than restated. It already encodes
 * the hard-won rule — a lookup SHAPE plus a DOCUMENT NOUN, both required — and
 * two implementations of "is this a lookup?" is exactly how the two gates would
 * come to disagree about the same sentence. The one thing that overrides it is a
 * system term: "where do I find the corrective action process?" is a lookup by
 * shape, and the framework IS the answer to it.
 */

/** Phrases that name the framework's own subject and nothing else. */
export const SYSTEM_TERMS: readonly string[] = [
  "corrective action",
  "corrective actions",
  "performance management",
  "progressive discipline",
  "discipline ladder",
  "disciplinary ladder",
  "management diamond",
  "performance management ladder",
  "accountability ladder",
  "escalation path",
  "escalation process",
  "coaching ladder",
  "coaching progression",
  "coaching sequence",
];

/**
 * The rungs, and the documents that record them.
 *
 * Weak on their own: every one of these appears in questions that are lookups,
 * creation requests, or ordinary policy queries. They count only alongside a
 * decision shape below.
 */
export const RUNG_TERMS: readonly string[] = [
  "coaching",
  "coach",
  "role play",
  "role-play",
  "roleplay",
  "follow-up coaching",
  "follow up coaching",
  "epp",
  "employee performance plan",
  "performance plan",
  "follow-up review",
  "follow up review",
  "re-evaluation",
  "reevaluation",
  "dpoa",
  "disciplinary plan of action",
  "written warning",
  "verbal warning",
  "final warning",
  /*
   * The bare noun too, and the §2.8 outcomes. "How many warnings before
   * termination?" named a rung by its plainest word and matched none of the
   * qualified spellings above, so the gate missed the most direct
   * which-rung-are-we-on question a manager can ask. Safe to include because a
   * rung still counts only alongside a decision shape.
   */
  "warning",
  "warnings",
  "termination",
  "terminate",
  "demotion",
  "demote",
  "suspension",
  "suspend",
  "policy review",
  "leadership review",
  "escalate",
  "escalation",
  "write up",
  "write-up",
  "discipline",
  "disciplinary",
];

/**
 * Shapes that ask WHICH RUNG APPLIES, rather than what a document says.
 *
 * "What comes after" and "next step" are the framework's own questions. "Should
 * I" and "do I need to" are a manager asking to be told where somebody is in
 * the sequence, which is the judgement the ladder exists to make consistent.
 */
const DECISION_SHAPES: readonly RegExp[] = [
  /\bwhen (?:should|do|does|would|is)\b/i,
  /\bshould (?:i|we|this|she|he|they|it)\b/i,
  /\bdo i (?:need|have) to\b/i,
  /\bdo we (?:need|have) to\b/i,
  /\bwhat (?:comes|happens) (?:after|next|before)\b/i,
  /\bnext step\b/i,
  /\bnext stage\b/i,
  /\bhow far\b/i,
  /\bhow many (?:steps|warnings|coachings)\b/i,
  /\bis it time\b/i,
  /\bhas (?:it|she|he|they) reached\b/i,
  /\bstraight to\b/i,
  /\bskip (?:a|the|straight)\b/i,
  /\bbefore i (?:can|should)\b/i,
  /\bwhat (?:is|are) the (?:steps|stages|process|progression|sequence)\b/i,
  /\bwhat order\b/i,
];

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternFor(terms: readonly string[]): RegExp {
  return new RegExp(
    `\\b(?:${[...terms]
      .sort((left, right) => right.length - left.length)
      .map(escape)
      .join("|")})\\b`,
    "i",
  );
}

const SYSTEM = patternFor(SYSTEM_TERMS);
const RUNG = patternFor(RUNG_TERMS);

/** Whether the sentence asks which rung applies. */
function asksADecision(text: string): boolean {
  return DECISION_SHAPES.some((shape) => shape.test(text));
}

/**
 * Whether this question must be answered with the Performance Management
 * Framework present.
 *
 * Exported on its own so the negative matrix can assert on ordinary questions
 * staying out, which is the property that matters most under fail-closed
 * grounding.
 */
export function isPerformanceManagementQuestion(question: string): boolean {
  const text = question ?? "";

  /*
   * A SYSTEM TERM WINS OUTRIGHT, ahead of the lookup suppressor. "Where do I
   * find our corrective action process?" has the shape of a lookup, and the
   * framework is the document being looked for — refusing to pin it there would
   * answer a question about the ladder without the ladder.
   */
  if (SYSTEM.test(text)) return true;

  /*
   * Otherwise a rung has to be named AND a decision asked. Both halves, for the
   * reason in the header: a rung alone is a lookup or a creation request, and a
   * decision alone is any question a manager ever asks.
   */
  if (!RUNG.test(text) || !asksADecision(text)) return false;

  /*
   * And even then, a documentary lookup is a documentary lookup. "What does the
   * policy say about when I should write someone up?" names a rung and asks a
   * decision, and it is still a question about what a manual says — which
   * retrieval answers, and which must not be refused because a framework was
   * missing.
   */
  return !isDocumentaryLookup(text);
}
