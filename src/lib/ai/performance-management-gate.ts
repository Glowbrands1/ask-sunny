import type { ClaudeTurn } from "./call-claude";
import {
  findContinuationAnchor,
  isDocumentaryLookup,
  isEllipticalFollowUp,
} from "./employee-performance-gate";

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
 * ============================================================================
 * THE SHAPES THAT ASK FOR THE SEQUENCE ITSELF
 * ============================================================================
 *
 * A SUBSET OF THE DECISION SHAPES, AND THE ONLY ONES THAT OUTRANK THE
 * DOCUMENTARY SUPPRESSOR. The distinction is what the question wants: these ask
 * WHERE IN THE PROGRESSION something sits, which is §2's entire subject and
 * cannot be answered from a manual — the others ask a judgement that a manual
 * might well answer.
 *
 * WHY THIS EXISTS AT ALL. `isDocumentaryLookup` was retuned for the employee
 * gate and now counts `step` and `steps` as document nouns, alongside a bare
 * "what is/are" shape. That is right for that gate — "what are the steps in the
 * closing checklist?" is a lookup — and it made this one blind to the two most
 * direct ladder questions a manager can ask:
 *
 *   "What are the steps for discipline?"        the ladder, by name
 *   "What is the next step after follow-up      the ladder, from a rung
 *    coaching?"
 *
 * Both were suppressed as documentary and answered with no framework. Rather
 * than retune the shared test — which would cost the employee gate the fourteen
 * suppressor cases the concurrent work measured — the sequence question is
 * allowed to outrank it here, where the framework IS the answer being asked for.
 */
const SEQUENCE_SHAPES: readonly RegExp[] = [
  /\bwhat (?:comes|happens) (?:after|next|before)\b/i,
  /\bnext step\b/i,
  /\bnext stage\b/i,
  /\bhow far\b/i,
  /\bhow many (?:steps|warnings|coachings)\b/i,
  /\bstraight to\b/i,
  /\bskip (?:a|the|straight)\b/i,
  /\bwhat (?:is|are) the (?:steps|stages|process|progression|sequence)\b/i,
  /\bwhat order\b/i,
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
  /\bis it time\b/i,
  /\bhas (?:it|she|he|they) reached\b/i,
  /\bbefore i (?:can|should)\b/i,
  ...SEQUENCE_SHAPES,
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
   * A QUESTION ABOUT THE SEQUENCE OUTRANKS THE SUPPRESSOR, and only that.
   *
   * `isDocumentaryLookup` counts `step`/`steps` as document nouns and carries a
   * bare "what is/are" shape, both correct for the gate it was tuned for. Here
   * that combination swallowed "what are the steps for discipline?" — the
   * ladder asked for by name — and answered it with no framework at all. See
   * `SEQUENCE_SHAPES`.
   */
  if (SEQUENCE_SHAPES.some((shape) => shape.test(text))) return true;

  /*
   * Otherwise a documentary lookup is a documentary lookup. "What does the
   * policy say about when I should write someone up?" names a rung and asks a
   * decision, and it is still a question about what a manual says — which
   * retrieval answers, and which must not be refused because a framework was
   * missing.
   */
  return !isDocumentaryLookup(text);
}

/* ------------------------------------------------- conversational turns -- */

/**
 * ============================================================================
 * "ALL OF IT" STILL MEANS CORRECTIVE ACTION
 * ============================================================================
 *
 * The acceptance conversation opens with two turns:
 *
 *   "corrective action"
 *   "all of it"
 *
 * Reading the second one alone loses the framework entirely, so the turn that
 * asks for the WHOLE progression is the one most likely to be answered without
 * it. That is the failure this section removes.
 *
 * ============================================================================
 * THE SAME BOUNDED WALK AS THE EMPLOYEE GATE, AND NOT A TOPIC MEMORY
 * ============================================================================
 *
 * `isEllipticalFollowUp` and `findContinuationAnchor` are IMPORTED rather than
 * re-implemented. That architecture was argued and corrected once already in
 * `employee-performance-gate.ts`, and two walks over the same history is how the
 * two gates would come to disagree about which turn was the anchor.
 *
 * What it means here is what it means there: the walk steps over consecutive
 * fragments, stops at the first turn that stands on its own, and that turn
 * decides. So an intervening standalone question BECOMES the anchor and clears
 * the context:
 *
 *   corrective action / all of it / what about follow-up?     -> PM
 *   corrective action / what does the refund policy say? /
 *     what about it?                                          -> NOT PM
 *
 * The second line is the one that makes this safe rather than sticky: "what
 * about it?" resolves against the refund policy, and cannot reach back past it.
 *
 * ============================================================================
 * WHY PM ADDS FRAGMENT FORMS OF ITS OWN
 * ============================================================================
 *
 * The shared list does not recognise "all of it", "explain all of it", "the
 * whole thing" or "walk me through it" — measured, not assumed. Those are how a
 * manager asks for a whole PROCESS, which is a shape that barely arises when the
 * subject is one person's metrics, and it is exactly the shape the acceptance
 * conversation uses.
 *
 * They are added HERE rather than to the shared list because the employee gate's
 * fragment set was tuned against a measured negative matrix by separate work,
 * and widening it from this side could quietly cost that gate a case it was
 * checked for.
 *
 * EVERY ONE IS A WHOLE-UTTERANCE PATTERN, anchored at both ends. That is what
 * keeps them safe under fail-closed grounding: "explain all of it" is
 * contentless and inherits, while "explain the attendance policy" carries its
 * own subject, matches nothing here, and stays an ordinary lookup. A fragment
 * that could carry a subject would be a way to have a policy question refused
 * because a framework was missing.
 */
const PM_WHOLE_UTTERANCE_FRAGMENTS: readonly RegExp[] = [
  /^\s*(?:explain\s+|cover\s+)?(?:all|everything)(?:\s+of\s+(?:it|them|that))?\s*[.?!]*$/i,
  /^\s*(?:the\s+)?(?:whole|full|entire)\s+(?:thing|lot|process|sequence|progression|ladder)\s*[.?!]*$/i,
  /^\s*(?:walk|talk|take)\s+me\s+through\s+(?:it|that|them|the\s+whole\s+thing|all\s+of\s+it)\s*[.?!]*$/i,
  /^\s*(?:tell|show|give)\s+me\s+(?:all|everything|more)(?:\s+of\s+(?:it|them))?\s*[.?!]*$/i,
  /^\s*(?:each|every)\s+(?:one|step|stage)\s*[.?!]*$/i,
];

/** A fragment, by the shared test or by PM's own whole-utterance forms. */
export function isPerformanceManagementFragment(question: string): boolean {
  const text = (question ?? "").trim();
  if (text.length === 0) return false;
  if (isEllipticalFollowUp(text)) return true;
  return PM_WHOLE_UTTERANCE_FRAGMENTS.some((pattern) => pattern.test(text));
}

export type PerformanceManagementIntentSource = "explicit" | "continuation";

export interface PerformanceManagementIntent {
  readonly active: boolean;
  /** How intent was established. Null when inactive. */
  readonly source: PerformanceManagementIntentSource | null;
  /** The anchor a continuation inherited from, for the audit trail. */
  readonly anchor: string | null;
}

const INACTIVE: PerformanceManagementIntent = {
  active: false,
  source: null,
  anchor: null,
};

/**
 * The PM intent for THIS turn: the question first, the elliptical chain second.
 *
 * `history` is the prior conversation in order. Nothing older than the nearest
 * anchor is consulted, and the walk is bounded — see above for why that is not
 * a topic memory.
 */
export function classifyPerformanceManagementIntent(input: {
  readonly question: string;
  readonly history?: readonly ClaudeTurn[];
}): PerformanceManagementIntent {
  if (isPerformanceManagementQuestion(input.question)) {
    return { active: true, source: "explicit", anchor: null };
  }

  if (!isPerformanceManagementFragment(input.question)) return INACTIVE;

  /*
   * PM'S OWN FRAGMENT TEST IS PASSED IN, so the walk steps over the forms this
   * gate recognises. With the shared test alone the walk stopped at "explain
   * all of it" and reported it as the anchor — a turn that is not a question
   * about anything — and the framework left a conversation that was entirely
   * about the framework. The algorithm stays in one place; only the predicate
   * differs. See `findContinuationAnchor`.
   */
  const anchor = findContinuationAnchor(
    input.history ?? [],
    undefined,
    isPerformanceManagementFragment,
  );
  if (anchor === null) return INACTIVE;

  return isPerformanceManagementQuestion(anchor)
    ? { active: true, source: "continuation", anchor }
    : INACTIVE;
}
