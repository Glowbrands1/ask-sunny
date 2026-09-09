import type { ClaudeTurn } from "./call-claude";

/**
 * ============================================================================
 * WHEN A QUESTION IS ABOUT AN INDIVIDUAL EMPLOYEE'S PERFORMANCE
 * ============================================================================
 *
 * The Employee Performance Framework is mandatory grounding for this class of
 * question and must not be attached to every turn. So the pipeline asks this
 * module, and it decides on three signals rather than one keyword list.
 *
 * A KEYWORD GATE, still, and not a classifier: a classifier would mean a second
 * model round trip before every answer and a second thing to be wrong. What
 * changed is the SHAPE of the rule, because a single flat list got both
 * directions wrong at once.
 *
 * ============================================================================
 * WHY THE FLAT LIST FAILED IN BOTH DIRECTIONS
 * ============================================================================
 *
 * IT FIRED ON GENERIC PHRASING. `who should i`, `who needs`, `prioritize`,
 * `observe` and `observation` were on it. Those are not employee-performance
 * language, they are English:
 *
 *   "Who should I contact about payroll?"          -> fired. Wrong.
 *   "What should I prioritize for opening?"        -> fired. Wrong.
 *   "Where do I record this observation?"          -> fired. Wrong.
 *
 * AND IT MISSED THE REAL THING. Managers do not usually say "employee
 * performance report". They say:
 *
 *   "Rank my team by conversion."
 *   "Which consultant is lowest?"
 *   "Who is below goal?"
 *   "How did Sarah perform this month?"
 *   "Which associate has the weakest conversion?"
 *   "Compare Sarah and Jane."
 *   "Who improved the most?"
 *   "Which team member needs the most attention?"
 *
 * None of those contained a term on the old list. Tuning the six example
 * prompts from the brief would have produced a gate that passed its own
 * examples and failed the job.
 *
 * ============================================================================
 * THE RULE: ONE STRONG TERM, OR A SUBJECT PLUS A PREDICATE
 * ============================================================================
 *
 * A question is employee-performance analysis when EITHER
 *
 *   (a) it contains a STRONG term — one that means nothing else in this
 *       product: `coaching`, `EPP`, `DPOA`, `role-play`, `below goal`,
 *       `most improved`, `top performer`, `employee report`; or
 *
 *   (b) it names a PERSON OR TEAM — `consultant`, `associate`, `team member`,
 *       `my team`, or a first name — AND applies a PERFORMANCE PREDICATE to
 *       them: `rank`, `lowest`, `weakest`, `perform`, `improved`, `compare`,
 *       `conversion`, `needs the most attention`.
 *
 * Neither half fires alone. `consultant` alone is a job title; `conversion`
 * alone is a salon metric and belongs to the reporting path. Together they are
 * a question about a person's results, which is exactly the class the framework
 * governs.
 *
 * The asymmetry that justifies leaning inclusive within that rule is unchanged:
 * a FALSE POSITIVE costs ~3,000 prompt tokens and the framework is scoped by
 * the system prompt anyway; a FALSE NEGATIVE means a manager asks who to coach
 * and the escalation guard is absent.
 */

/** Terms that mean employee-performance analysis on their own. */
export const STRONG_TERMS: readonly string[] = [
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
  "recognizing",
  "recognising",
  "recognition",
  "praise",
  "commend",
  "top performer",
  "top performers",
  "most improved",
  "improved the most",
  "shout out",
  "shoutout",
  // The framework's own naming of its subject.
  "employee performance",
  "employee report",
  "employee reports",
  "performance report",
  "employee metrics",
  "employee level",
  "per employee",
  "individual performance",
  // Prioritisation language that is specific rather than generic.
  "biggest opportunity",
  "opportunity volume",
  "underperformer",
  "underperformers",
  "struggling",
  "below goal",
  "below their goal",
  "missing goal",
  // Development and escalation — the vocabulary carrying the safety rules.
  "role play",
  "role-play",
  "roleplay",
  "epp",
  "dpoa",
];

/**
 * ============================================================================
 * ESCALATION ACTIONS, WHICH NEED SOMEBODY TO BE ABOUT
 * ============================================================================
 *
 * These were STRONG terms, and the justification written here was that a
 * discipline POLICY question firing the framework was "a false positive worth
 * paying for". That was true when the gate was FAIL-OPEN: the cost was ~3,000
 * prompt tokens and a rule the model would ignore.
 *
 * It stopped being true the moment mandatory grounding started failing CLOSED.
 * A false positive now means "What does the disciplinary policy say?" — an
 * ordinary Knowledge Base lookup that the corpus answers perfectly — can be
 * REFUSED outright because a framework the question never needed could not be
 * loaded. The trade-off was re-priced by the fail-closed fix and this list did
 * not get re-read at the time.
 *
 * So an escalation action now needs a PERSON to be about: a subject word, or a
 * name. "Should I discipline Sarah based on these numbers?" is an employee
 * decision; "What is the disciplinary process?" is a policy lookup, and the
 * difference is whether anybody is named.
 *
 * `coaching form`, `write-up` and `performance improvement` are here for the
 * same reason, and QA was right to single them out: the Forms proposal path
 * intercepts some of them earlier, but this gate has to be defensible on its
 * own rather than relying on another layer catching its mistakes.
 */
export const ESCALATION_ACTION_TERMS: readonly string[] = [
  "discipline",
  "disciplined",
  "disciplining",
  "disciplinary",
  "disciplinary action",
  "write up",
  "write-up",
  "written up",
  "performance improvement",
  "performance improvement plan",
  "coaching form",
  "verbal coaching",
  "follow-up documentation",
  "follow up documentation",
  "termination",
  "terminate",
  "terminated",
  "suspend",
  "suspended",
  "suspension",
  "final warning",
];

/**
 * Words naming a PERSON or the TEAM. Weak on their own.
 *
 * `employee` and `staff` are here rather than in STRONG_TERMS precisely because
 * "Where is the employee handbook?" must not fire.
 */
export const SUBJECT_TERMS: readonly string[] = [
  "consultant",
  "consultants",
  "associate",
  "associates",
  "team member",
  "team members",
  "teammate",
  "my team",
  "the team",
  "employee",
  "employees",
  "staff",
  "staff member",
  "tanning consultant",
  "tc",
  "her",
  "him",
  "she",
  "he",
  "they",
  "anyone",
  "anybody",
  "someone",
  "somebody",
  "nobody",
];

/**
 * Performance judgements. Weak on their own — `conversion` belongs to the
 * salon-level reporting path until it is applied to a person.
 */
export const PREDICATE_TERMS: readonly string[] = [
  "rank",
  "ranks",
  "ranked",
  "ranking",
  "lowest",
  "highest",
  "worst",
  "best",
  "weakest",
  "strongest",
  "weak",
  "struggling",
  "perform",
  "performs",
  "performed",
  "performing",
  "performance",
  "improved",
  "improving",
  "improvement",
  "compare",
  "compared",
  "comparison",
  "conversion",
  "conversions",
  "closing",
  "close rate",
  "needs the most attention",
  "most attention",
  "needs attention",
  "needs help",
  "needs support",
  "behind",
  "attention",
];

/**
 * Capitalised words that are NOT first names.
 *
 * The person-name heuristic reads a mid-sentence capital as a person, which is
 * how "How did Sarah perform this month?" and "Compare Sarah and Jane." are
 * recognised at all — no keyword list can hold the staff roster. This is the
 * list of capitals that would otherwise be mistaken for people: the brand, the
 * product, the metric acronyms, days, months, and the salon vocabulary.
 */
const NOT_A_NAME = new Set(
  [
    "I",
    "Sun",
    "Tan",
    "City",
    "Sunny",
    "Ask",
    "STC",
    "JB",
    "JBA",
    "Associates",
    "Spa",
    "Bed",
    "Beds",
    "Wellness",
    "Salon",
    "Salons",
    "District",
    "Region",
    "EPP",
    "DPOA",
    "EFT",
    "PIF",
    "PIFs",
    "OTC",
    "BHOW",
    "ASTC",
    "PPTA",
    "UPTA",
    "LPSVA",
    "KBL",
    "NCR",
    "BI",
    "L10",
    "VersaPro",
    "HydroMassage",
    "Google",
    "Power",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "MTD",
    "YTD",
    "LTM",
    "Comp",
    "Daily",
    "Stats",
    "Bonus",
    "Viewer",
    "Routine",
    "Mat",
  ].map((word) => word.toLowerCase()),
);

/** Escapes a term so a `.` or `+` added to a list cannot become a wildcard. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary alternation over one vocabulary, longest term first. */
function patternFor(terms: readonly string[]): RegExp {
  return new RegExp(
    `\\b(?:${[...terms]
      .sort((left, right) => right.length - left.length)
      .map(escape)
      .join("|")})\\b`,
    "i",
  );
}

const STRONG = patternFor(STRONG_TERMS);
const SUBJECT = patternFor(SUBJECT_TERMS);
const PREDICATE = patternFor(PREDICATE_TERMS);
const ESCALATION = patternFor(ESCALATION_ACTION_TERMS);

/**
 * ============================================================================
 * ASKING WHERE A DOCUMENT IS, OR WHAT A POLICY SAYS
 * ============================================================================
 *
 * The other half of the re-priced trade-off. Under fail-closed grounding, the
 * most damaging false positive is not a vague question — it is a precise one
 * that the knowledge base answers well:
 *
 *   "What does the disciplinary policy say?"
 *   "Where can I find the discipline policy?"
 *   "What is the disciplinary process?"
 *   "Where is the coaching form?"
 *
 * Every one is a documentary lookup, every one is exactly what retrieval is
 * for, and every one would be REFUSED if the framework happened to be
 * unavailable. So a documentary lookup with nobody in it suppresses the gate
 * outright, ahead of every other signal — including the strong terms, because
 * "What does the coaching policy say?" is a lookup too.
 *
 * BOTH HALVES ARE REQUIRED: a lookup SHAPE ("what does the ... say", "where
 * can I find") and a DOCUMENT NOUN ("policy", "process", "manual", "form").
 * Neither alone is enough — "What should I do about Sarah?" has the shape of a
 * question and no document in it, and "the policy says she is late" mentions a
 * document while being about a person.
 *
 * AND IT DEFERS TO A PERSON. `isDocumentaryLookup` is only consulted when the
 * question names nobody and judges nothing, so "Should I discipline Sarah
 * according to the policy?" is still an employee decision rather than a lookup.
 * That ordering is what keeps this from becoming a way to ask for an escalation
 * recommendation with the guard switched off.
 */
const LOOKUP_SHAPES: readonly RegExp[] = [
  /\bwhat (?:does|do|did)\b[\s\S]*\bsay\b/i,
  /\bwhat(?:'s| is| are)\b[\s\S]*\b(?:policy|process|procedure|rule|rules|guideline|guidelines|steps)\b/i,
  /\bwhere\b[\s\S]*\b(?:find|is|are|can i get|do i get|do i look)\b/i,
  /\bhow do i (?:find|access|get|download|print)\b/i,
  /\bis there a\b/i,
  /\bwhich (?:policy|document|form|manual|guide)\b/i,
  /\bshow me the\b/i,
  /\bcan i (?:see|read|find)\b/i,
];

const DOCUMENT_NOUNS = patternFor([
  "policy",
  "policies",
  "process",
  "procedure",
  "procedures",
  "manual",
  "handbook",
  "guide",
  "binder",
  "document",
  "documentation",
  "template",
  "form",
  "forms",
  "sop",
  "rule",
  "rules",
  "guideline",
  "guidelines",
  "checklist",
]);

/**
 * Whether the question is asking about a DOCUMENT rather than about a person.
 *
 * Exported so the negative matrix can assert on the reason a question was
 * suppressed, not merely that it was.
 */
export function isDocumentaryLookup(question: string): boolean {
  const text = question ?? "";
  if (!DOCUMENT_NOUNS.test(text)) return false;
  return LOOKUP_SHAPES.some((shape) => shape.test(text));
}

/**
 * Whether the text refers to a person by name.
 *
 * A capitalised token that is not the first word of a sentence, not an
 * all-caps acronym, and not in `NOT_A_NAME`. Deliberately conservative: it
 * requires a leading capital followed by lower-case letters, so `SPA` and
 * `EPP` are not people and `sarah` in an all-lower-case question is not
 * detected either — that case is covered by the subject and predicate lists.
 */
export function mentionsPersonName(text: string): boolean {
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (let index = 0; index < words.length; index += 1) {
      const bare = words[index]!.replace(/[^A-Za-z'-]/g, "");
      if (!/^[A-Z][a-z]{1,}$/.test(bare)) continue;
      // The first word of a sentence is capitalised by grammar, not identity.
      if (index === 0) continue;
      if (NOT_A_NAME.has(bare.toLowerCase())) continue;
      return true;
    }
  }
  return false;
}

/**
 * Whether the question, read alone, is employee-performance analysis.
 *
 * Exported so the continuation logic can ask the same question of a previous
 * turn without re-implementing the rule.
 */
export function isEmployeePerformanceQuestion(question: string): boolean {
  const text = question ?? "";

  /*
   * A PERSON IN THE QUESTION OUTRANKS EVERYTHING ELSE HERE, including the
   * documentary suppressor below. Checked first so that adding a policy noun to
   * a question about somebody — "Should I discipline Sarah under the policy?" —
   * cannot be used to shake the escalation guard off.
   */
  const aboutSomebody = SUBJECT.test(text) || mentionsPersonName(text);

  if (ESCALATION.test(text) && aboutSomebody) return true;

  /*
   * With nobody named and nothing judged, a question about a policy or a form
   * is a Knowledge Base lookup. Suppressed ahead of the strong terms, because
   * "What does the coaching policy say?" carries one and is still a lookup —
   * and under fail-closed grounding, wrongly claiming it needs the framework
   * can refuse an answer the corpus holds.
   */
  if (!aboutSomebody && isDocumentaryLookup(text)) return false;

  if (STRONG.test(text)) return true;

  if (!PREDICATE.test(text)) return false;

  return aboutSomebody;
}

/* ----------------------------------------------------- conversational turns -- */

/**
 * ============================================================================
 * ELLIPTICAL FOLLOW-UPS, AND WHY THEY ARE NOT STICKY INTENT
 * ============================================================================
 *
 * "Who should I coach from this employee report?" — then "What about Sarah?"
 *
 * The second turn is the same analysis and needs the same framework, but it
 * contains no strong term and, on its own, no predicate. Reading the question
 * alone loses it.
 *
 * The obvious fix — remember the intent for the rest of the conversation — is
 * the wrong one, and it is worth saying why: the framework would then never
 * leave the prompt. Three turns later the manager asks about the refund window
 * and is answered by a coaching framework, with ~3,000 tokens of escalation
 * rules in front of every question for the rest of the session.
 *
 * So inheritance is narrow and has to be EARNED by the follow-up's shape:
 *
 *   1. The question must be ELLIPTICAL — a fragment that cannot be understood
 *      without the previous turn. "What about Sarah?", "and Jane?", "why?",
 *      "her?", "the other two?".
 *   2. Following the chain of consecutive elliptical manager turns backwards
 *      must arrive at an ANCHOR — the nearest manager turn that stands on its
 *      own — and that anchor must be explicit employee-performance analysis.
 *
 * ============================================================================
 * WHY IT IS A CHAIN AND NOT THE PREVIOUS TURN
 * ============================================================================
 *
 * The first version looked only at the immediately preceding manager turn, and
 * QA found what that costs on the second hop:
 *
 *   "Who should I coach?"     explicit  -> framework
 *   "What about Sarah?"       fragment  -> framework, inherited
 *   "And Jane?"               fragment  -> LOST IT
 *
 * because the turn before "And Jane?" was itself a fragment and so not
 * independently explicit. But "And Jane?" is plainly still the same analysis,
 * and dropping the escalation guard three questions into a coaching
 * conversation is precisely the failure this whole mechanism exists to stop.
 *
 * So the walk continues THROUGH fragments and stops at the first turn that
 * stands on its own. That turn — the anchor — decides, and nothing older than
 * it is consulted:
 *
 *   coach? / Sarah? / Jane? / why?          anchor = "coach?"        -> active
 *   coach? / Sarah? / refund policy?        anchor = "refund policy?" -> clear
 *   coach? / Sarah? / refund policy? / what about it?
 *                                           anchor = "refund policy?" -> clear
 *
 * That last line is the one that makes this safe rather than sticky. Once a
 * standalone question intervenes it becomes the anchor, so a later fragment
 * refers to IT — the refund policy — and cannot reach back past it to
 * resurrect coaching intent.
 *
 * BOUNDED, so "do not infer intent from arbitrary old history" stays true. The
 * walk gives up after `MAX_CONTINUATION_HOPS` fragments; a chain longer than
 * that is not a follow-up, it is a conversation, and the manager can restate.
 */

/** Openings that mark a fragment continuing the previous turn. */
const ELLIPSIS_PATTERNS: readonly RegExp[] = [
  /^\s*(?:and|or|but|so)\b/i,
  /^\s*what about\b/i,
  /^\s*how about\b/i,
  /^\s*what if\b/i,
  /^\s*(?:why|why not|how|when|where|who|which|whose)\s*\??\s*$/i,
  /^\s*(?:him|her|them|they|he|she|it)\s*\??\s*$/i,
  /^\s*(?:the other|the others|anyone else|anybody else|the rest)\b/i,
  /^\s*(?:same|same for|same with|also)\b/i,
  /^\s*(?:more|more detail|more details|go on|continue|keep going)\b/i,
];

/**
 * Whether a question is a fragment that depends on the previous turn.
 *
 * Length alone is not the test — "Rank my team." is short and complete, and
 * "What does the refund policy say?" is longer and also complete. What marks a
 * fragment is an opening that points BACKWARDS, so the patterns are anchored at
 * the start. A bare name, which is the commonest follow-up of all, counts too.
 */
export function isEllipticalFollowUp(question: string): boolean {
  const text = (question ?? "").trim();
  if (text.length === 0) return false;

  if (ELLIPSIS_PATTERNS.some((pattern) => pattern.test(text))) return true;

  return isBareNameFragment(text);
}

/**
 * Whether the text is nothing but a name or two — "Sarah?", "Sarah and Jane?".
 *
 * The commonest follow-up of all, and it needs its own test rather than a
 * reuse of `mentionsPersonName`: that function deliberately ignores the first
 * word of a sentence, so the only way to make it see a leading name is to
 * prefix a filler token — which then makes "Rank my team." look like a name
 * too, and that is a complete question, not a fragment.
 *
 * So this asks the stricter question directly: is EVERY token here either a
 * name or a conjunction? "Rank my team." fails on `my` and `team`; "Sarah and
 * Jane?" passes.
 */
export function isBareNameFragment(text: string): boolean {
  const tokens = (text ?? "")
    .replace(/[?.!,]+$/, "")
    .split(/\s+/)
    .filter((token) => token.length > 0);

  if (tokens.length === 0 || tokens.length > 4) return false;

  const JOINERS = new Set(["and", "or", "&", "plus", "vs"]);
  let names = 0;

  for (const token of tokens) {
    const bare = token.replace(/[^A-Za-z'-]/g, "");
    if (JOINERS.has(bare.toLowerCase())) continue;
    if (!/^[A-Z][a-z]{1,}$/.test(bare)) return false;
    if (NOT_A_NAME.has(bare.toLowerCase())) return false;
    names += 1;
  }

  return names > 0;
}

export type EmployeePerformanceIntentSource = "explicit" | "continuation";

export interface EmployeePerformanceIntent {
  readonly active: boolean;
  /** How intent was established. Null when inactive. */
  readonly source: EmployeePerformanceIntentSource | null;
  /**
   * The anchor turn a continuation inherited from, for the audit trail. Null
   * for explicit intent and for no intent at all.
   */
  readonly anchor: string | null;
}

const INACTIVE: EmployeePerformanceIntent = { active: false, source: null, anchor: null };

/**
 * How many consecutive fragments may separate a turn from its anchor.
 *
 * Six is a judgement, not a measurement: long enough for a real run of
 * follow-ups about individual people ("Sarah?", "and Jane?", "the other two?",
 * "why?", "what about her upgrades?"), short enough that it cannot become
 * unbounded history inference. Beyond it the walk gives up and the manager
 * restates — which costs one sentence, where guessing costs correctness.
 */
export const MAX_CONTINUATION_HOPS = 6;

/**
 * The manager turn a run of fragments hangs off, or null if there isn't one.
 *
 * Walks backwards from the most recent manager turn, stepping over fragments,
 * and returns the first turn that stands on its own. Assistant turns are
 * skipped entirely — they are answers, not intent.
 *
 * Exported so a test can assert WHICH turn was treated as the anchor rather
 * than only whether intent survived.
 */
export function findContinuationAnchor(
  history: readonly ClaudeTurn[],
  maxHops: number = MAX_CONTINUATION_HOPS,
): string | null {
  let hops = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant") continue;

    if (!isEllipticalFollowUp(turn.content)) return turn.content;

    hops += 1;
    if (hops > maxHops) return null;
  }

  return null;
}

/**
 * The intent for THIS turn: the question first, the elliptical chain second.
 *
 * `history` is the prior conversation in order. Nothing older than the nearest
 * anchor is consulted, and the walk is bounded — see above for why that is not
 * a topic memory.
 */
export function classifyEmployeePerformanceIntent(input: {
  readonly question: string;
  readonly history?: readonly ClaudeTurn[];
}): EmployeePerformanceIntent {
  if (isEmployeePerformanceQuestion(input.question)) {
    return { active: true, source: "explicit", anchor: null };
  }

  if (!isEllipticalFollowUp(input.question)) return INACTIVE;

  const anchor = findContinuationAnchor(input.history ?? []);
  if (anchor === null) return INACTIVE;

  return isEmployeePerformanceQuestion(anchor)
    ? { active: true, source: "continuation", anchor }
    : INACTIVE;
}
