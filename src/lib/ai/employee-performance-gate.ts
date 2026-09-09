/**
 * ============================================================================
 * WHEN A QUESTION IS ABOUT AN INDIVIDUAL EMPLOYEE'S PERFORMANCE
 * ============================================================================
 *
 * The Employee Performance Framework is mandatory grounding for this class of
 * question and must not be attached to every turn. So the pipeline asks this
 * function, and this function decides on the QUESTION'S OWN WORDS.
 *
 * A KEYWORD GATE, for the same reasons `reporting/read/bed-spa/question-gate.ts`
 * is one: a classifier would mean a second model round trip before the answer
 * and a second thing to be wrong, and the cost of THIS being wrong is bounded
 * in a way a classifier's is not.
 *
 *   A FALSE POSITIVE costs about 3,000 prompt tokens. The framework arrives, the
 *   question turns out to be about something else, and the system prompt is
 *   explicit that the framework is reasoning for employee-performance questions
 *   rather than evidence about anything else. The answer is unaffected.
 *
 *   A FALSE NEGATIVE is the real failure, and it is the failure this whole
 *   change exists to fix: a manager asks who to coach, the framework's
 *   escalation limits are absent, and Sunny answers a people question with a
 *   sorted list of low numbers — or worse, suggests documentation the framework
 *   forbids on a metric alone.
 *
 * So the vocabulary leans INCLUSIVE, and it is taken from the framework's own
 * language plus the shapes managers actually type.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT IN THE LIST
 * ============================================================================
 *
 * `policy`, `report`, `performance` and `employee` on their own. Each would
 * make the gate fire on questions that are plainly not about coaching a person:
 * "what does the refund policy say", "where is the safety report", "how is the
 * salon performing". `performance` in particular appears in half the manuals in
 * the corpus.
 *
 * The two-word forms ARE listed — "employee performance", "employee report",
 * "performance report" — because those name the thing itself rather than
 * mentioning one of its words.
 *
 * `train` and `training` are out: a training question is a knowledge question
 * and the corpus has four manuals for it.
 */

/**
 * The framework's vocabulary and the question shapes that reach for it.
 *
 * Matched case-insensitively on word boundaries, so `coach` does not fire on
 * `coachable` inside another word and `epp` does not fire on `epperson`.
 */
export const EMPLOYEE_PERFORMANCE_TERMS: readonly string[] = [
  // Coaching, which is the framework's core verb.
  "coach",
  "coaches",
  "coaching",
  "coachable",
  "coaching plan",
  "coaching opportunity",
  "coaching priority",
  // Recognition — the half of the framework that is not about underperformance.
  "recognize",
  "recognise",
  "recognition",
  "praise",
  "shout out",
  "shoutout",
  "top performer",
  "top performers",
  "most improved",
  // The framework's own naming of its subject.
  "employee performance",
  "employee report",
  "employee reports",
  "performance report",
  "employee metrics",
  "employee level",
  "per employee",
  "individual performance",
  // Prioritisation language.
  "biggest opportunity",
  "opportunity volume",
  "prioritize",
  "prioritise",
  "who should i",
  "who needs",
  "who is struggling",
  "underperformer",
  "underperformers",
  // Development and escalation — the vocabulary that carries the safety rules.
  "role play",
  "role-play",
  "roleplay",
  "epp",
  "dpoa",
  "verbal coaching",
  "coaching form",
  "follow-up documentation",
  "follow up documentation",
  "performance improvement",
  "write up",
  "write-up",
  "discipline",
  "disciplinary",
  "observation",
  "observe",
];

/** Escapes a term so a `.` or `+` added to the list cannot become a wildcard. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary alternation over the whole vocabulary, built once.
 *
 * Longest first, so `coaching plan` is tried before `coach` and the more
 * specific term is the one that matches. It makes no difference to the boolean
 * this module returns, but it keeps the pattern honest if a caller ever wants
 * to know WHICH term fired.
 */
const PATTERN = new RegExp(
  `\\b(?:${[...EMPLOYEE_PERFORMANCE_TERMS]
    .sort((left, right) => right.length - left.length)
    .map(escape)
    .join("|")})\\b`,
  "i",
);

/**
 * Whether this question must be answered with the Employee Performance
 * Framework attached.
 *
 * Reads the question ONLY, never the conversation history — the same rule the
 * reporting gate follows, and for the same reason. A manager who asked about
 * coaching four turns ago and is now asking about the refund window should get
 * the refund window; carrying intent forward on history would mean the
 * framework never leaves the prompt once it arrives.
 */
export function isEmployeePerformanceQuestion(question: string): boolean {
  return PATTERN.test(question);
}
