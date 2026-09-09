import { routeReportFamilies } from "@/lib/reporting/read/family-routing";

/**
 * ============================================================================
 * WHEN A QUESTION MUST BE ANSWERED WITH THE DAILY STATS FRAMEWORK
 * ============================================================================
 *
 * The framework is the manager reasoning model: metric signal, business
 * meaning, likely behaviour, coaching focus, role-play, manager inspection,
 * follow-up, recognition. It is mandatory for manager-performance and daily
 * operational interpretation questions, and it must not ride along on every
 * turn. So the pipeline asks this function.
 *
 * ============================================================================
 * IT IS NOT ONLY A KEYWORD LIST, AND THAT IS THE POINT
 * ============================================================================
 *
 * TWO CONDITIONS, EITHER OF WHICH OPENS THE GATE:
 *
 *   1. THE QUESTION'S OWN WORDS. Interpretation vocabulary — "what should I
 *      focus on", "why is", "what does this mean", "priorities", "what should I
 *      coach". A keyword gate, for the reasons the other two gates in this
 *      codebase state: a classifier is a second model round trip before the
 *      answer and a second thing to be wrong.
 *
 *   2. THE QUESTION REACHED FOR REPORT FIGURES AT ALL. Any question that routes
 *      to a report family is a question about what the numbers mean, and the
 *      framework is how this company decides what numbers mean. This is the
 *      condition that makes the guarantee deterministic rather than lucky.
 *
 * Condition 2 exists because of a specific, measured failure mode in condition
 * 1. "Tans are up but revenue is down. Why?" is the archetypal Daily Stats
 * question — traffic present, conversion weak, coach product attachment — and
 * it contains not one word of interpretation vocabulary. So does "which salons
 * have the lowest spa conversion". A list long enough to catch those is a list
 * long enough to fire on everything; the honest fix is to notice that the
 * question wanted figures.
 *
 * ============================================================================
 * THE ASYMMETRY THAT SETS THE BIAS
 * ============================================================================
 *
 *   A FALSE POSITIVE costs about 2,000 prompt tokens. The framework arrives,
 *   the question turns out not to need it, and the system prompt is explicit
 *   that it is reasoning for interpretation questions rather than evidence
 *   about anything. The answer is unaffected.
 *
 *   A FALSE NEGATIVE is the failure this exists to fix, and it is not subtle: a
 *   manager asks what to focus on today, gets a list of the lowest numbers, and
 *   the framework's first two operating rules — interpret numbers as behaviour
 *   signals, do not simply identify the lowest metric — are absent from the one
 *   answer they were written for.
 *
 * So the vocabulary leans INCLUSIVE, and it is taken from the framework's own
 * language plus the shapes managers actually type.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT IN THE LIST
 * ============================================================================
 *
 * `daily stats` alone would have been almost useless: nobody types the name of
 * the report. It is listed, but it earns nothing — condition 2 is what carries
 * this gate.
 *
 * `report`, `number`, `numbers`, `data` and `stats` on their own are out. Each
 * fires on questions that are plainly not interpretation — "where is the safety
 * report", "what number do I call for support", "is my data saved".
 *
 * `coach` and `coaching` on their own are out for the same reason, and they are
 * the ones this list got wrong first: "Where is the coaching form?" is a
 * document lookup, and firing on it made an ordinary policy question pay for a
 * deeper retrieval and arrive carrying a framework it had no use for. The
 * phrases that mean interpretation — "what should I coach", "coaching focus" —
 * are listed instead, and condition 2 catches the rest.
 *
 * `policy`, `manual` and `handbook` are out and will never be in: a question
 * about what a policy SAYS is a knowledge question, and the framework is
 * outranked by policy anyway.
 */

/**
 * The framework's vocabulary and the question shapes that reach for it.
 *
 * Matched case-insensitively on word boundaries, so `mean` does not fire inside
 * `meaning`'s neighbours and `coach` does not fire on part of another word.
 */
export const DAILY_STATS_TERMS: readonly string[] = [
  // The report and the framework, for the rare manager who names them.
  "daily stats",
  "daily stat",
  "quick stats",
  "interpretation framework",
  // Asking what something MEANS, which is the framework's whole job.
  "what does this mean",
  "what does that mean",
  "what do these mean",
  "how do i read",
  "how should i read",
  "what am i looking at",
  "make sense of",
  "interpret",
  "explain this",
  "walk me through",
  // Asking WHY, which is the request for a behavioural cause.
  "why is",
  "why are",
  "why did",
  "why has",
  "what is driving",
  "what's driving",
  "what is causing",
  "root cause",
  // Choosing what to do next, which is the prioritisation contract.
  "focus on",
  "priorities",
  "priority",
  "top three",
  "top 3",
  "where do i start",
  "what should i do",
  "what do i do",
  "action plan",
  "next step",
  "next steps",
  /*
   * Coaching and the manager's own execution.
   *
   * BARE `coach` AND `coaching` ARE DELIBERATELY ABSENT, and that is a
   * correction rather than an omission. In this product they are library and
   * policy words as much as interpretation words — "Where is the coaching
   * form?", "What does the coaching policy say?" — and firing on them made an
   * ordinary document lookup pay for role-augmented retrieval and arrive
   * carrying a reasoning framework it had no use for. It is the same lesson
   * `employee-performance-gate.ts` records about `observe` and `prioritize`:
   * generic English is not this framework's vocabulary.
   *
   * Nothing real is lost, because condition 2 catches the questions that
   * matter. "What should I coach today?" routes to Sales Totals on `today`;
   * "which consultant should I coach on conversion?" routes on `conversion`.
   * The phrases below are the ones that mean interpretation on their own.
   */
  "what should i coach",
  "what to coach",
  "coach today",
  "coaching focus",
  "coaching priority",
  "coaching priorities",
  "coaching opportunity",
  "coaching opportunities",
  "role play",
  "role-play",
  "roleplay",
  "what should i inspect",
  "what should i observe",
  "manager inspection",
  "listen for",
  "follow up",
  "follow-up",
  "team message",
  "huddle",
  // Recognition — the half of the framework that is not underperformance.
  "praise",
  "recognition",
  "recognise",
  "recognize",
  "shout out",
  "shoutout",
  "celebrate",
  "what looks strong",
  "what looks good",
  "going well",
  "our wins",
];

/** Escapes a term so a `.` or `+` added to the list cannot become a wildcard. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary alternation over the whole vocabulary, built once.
 *
 * Longest first, so `coaching plan` would be tried before `coach` and the more
 * specific term is the one that matches. It makes no difference to the boolean
 * this module returns, but it keeps the pattern honest if a caller ever wants
 * to know WHICH term fired.
 */
const PATTERN = new RegExp(
  `\\b(?:${[...DAILY_STATS_TERMS]
    .sort((left, right) => right.length - left.length)
    .map(escape)
    .join("|")})\\b`,
  "i",
);

/** Whether the question's own words reach for interpretation. Condition 1. */
export function hasDailyStatsVocabulary(question: string): boolean {
  return PATTERN.test(question);
}

/**
 * Whether this question must be answered with the Daily Stats Interpretation
 * Framework attached.
 *
 * Reads the question ONLY, never the conversation history — the same rule the
 * other two gates follow, and for the same reason. A manager who asked what to
 * focus on four turns ago and is now asking about the refund window should get
 * the refund window; carrying intent forward on history would mean the
 * framework never leaves the prompt once it arrives.
 *
 * A FOLLOW-UP IS NOT AN EXCEPTION TO THAT. "Why is #1 the biggest problem?"
 * opens the gate on its own words — `why is` — and so does "give me a
 * role-play", and so does "create a coaching form for that". The framework
 * stays present across a coaching conversation because each turn earns it, not
 * because a flag was set on the first one.
 */
export function isDailyStatsQuestion(question: string): boolean {
  return hasDailyStatsVocabulary(question) || routeReportFamilies(question).length > 0;
}
