import { FAMILY_QUESTION_TERMS } from "../family-routing";

/**
 * ============================================================================
 * WHEN A QUESTION WANTS THE REPORT FIGURES
 * ============================================================================
 *
 * The briefing is four database round trips and a few thousand prompt tokens.
 * Attaching it to every turn would put spa session counts behind a question
 * about uniform policy and slow down every answer to pay for it; attaching it
 * to none would leave the figures unreachable. So the pipeline asks this
 * function first.
 *
 * A KEYWORD GATE, DELIBERATELY, and not a model call. A classifier here would
 * mean two model round trips per question and a second thing to be wrong; the
 * cost of this one being wrong is bounded in a way a classifier's is not:
 *
 *   A FALSE POSITIVE costs latency and tokens. The briefing arrives, the model
 *   does not need it, the answer is unaffected — the prompt is explicit that
 *   report data is only for questions about the reports.
 *
 *   A FALSE NEGATIVE is the real failure: Sunny says the knowledge base does
 *   not cover something while the figure sits in a loaded report. So the list
 *   leans INCLUSIVE, and the terms are the reports' own vocabulary rather than
 *   a guess at how somebody might phrase a question.
 *
 * WHY `salon` IS NOT IN THE LIST, and this is the one judgement worth stating:
 * every manager question mentions their salon. It is the single most common
 * word in this product and would make the gate always-true, which is the same
 * as not having one. `store` and `location` are out for the same reason.
 */

/**
 * The reports' vocabulary, DERIVED rather than written twice.
 *
 * The list this module used to hold is now the Bed Usage, Spa Wellness and Spa
 * Engagement vocabularies in `read/family-routing.ts`, partitioned by the
 * report each term came from. Nothing was added or removed in the move: this
 * union is the same set of terms, in the same three groups, and the test suite
 * below pins the behaviour either way.
 *
 * Derived because there is now a SECOND reader of those terms. Chat routes a
 * question to the families it needs, per family; this gate answers the narrower
 * question "does the bed and spa briefing belong on this turn". Two copies of
 * one vocabulary drift, and the drift is silent — a term added for routing that
 * this gate never learns about means the briefing that routing asked for is
 * never attached.
 *
 * De-duplicated, because `capital`, `expansion` and the band words belong to
 * more than one of the three families.
 */
export const REPORTING_QUESTION_TERMS: readonly string[] = [
  ...new Set([
    ...FAMILY_QUESTION_TERMS["bed-usage"],
    ...FAMILY_QUESTION_TERMS["spa-wellness"],
    ...FAMILY_QUESTION_TERMS["spa-engagement"],
  ]),
];
/**
 * Escapes a term for use in a regular expression.
 *
 * The list is a source-controlled constant today, so nothing here is
 * attacker-supplied — this exists so that adding a term with a `.` or a `+` to
 * the list above cannot quietly turn it into a wildcard that matches
 * everything.
 */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary alternation over the whole vocabulary.
 *
 * Built once. A multi-word term keeps its internal space, so "per bed" matches
 * "per bed" and not "per-bed"; the hyphenated spellings that matter are listed
 * separately rather than handled by a looser boundary, because loosening it is
 * what would make `tan` match `tangible`.
 */
const PATTERN = new RegExp(
  `\\b(?:${REPORTING_QUESTION_TERMS.map(escape).join("|")})\\b`,
  "i",
);

/**
 * Whether a question should be answered with the report figures attached.
 *
 * Reads the question ONLY, never the conversation history. A manager who asked
 * about spa conversion three turns ago and is now asking about a write-up
 * should get the write-up path, and carrying the briefing forward on history
 * would mean it never leaves once it arrives.
 */
export function isReportingQuestion(question: string): boolean {
  return PATTERN.test(question);
}
