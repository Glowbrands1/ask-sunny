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
  /*
   * Coaching, which is the framework's core verb — through its inflections.
   *
   * `coached` was missing, and `\bcoach\b` cannot match it, so the PASSIVE
   * VOICE lost the framework entirely: "Should she be coached?", "Should Sarah
   * be coached?" and "Who should be coached?" all reached the model with no
   * escalation guard. That is how a manager phrases the question when they have
   * already decided somebody needs attention.
   *
   * `coachings` is deliberately ABSENT. It would fire "How many verbal
   * coachings before a write-up?" — a policy question about the escalation
   * ladder, which the corpus answers and which is asserted as a negative.
   */
  "coach",
  "coaches",
  "coached",
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
  "writeup",
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
  "terminating",
  "suspend",
  "suspended",
  "suspending",
  "suspension",
  /*
   * ==========================================================================
   * AUDITED BY CONCEPT AND BY INFLECTION, NOT BY COPYING THE FAILING STRINGS
   * ==========================================================================
   *
   * Independent QA measured 9 of 11 straightforward disciplinary
   * recommendations bypassing mandatory grounding — written warning, formal
   * warning, corrective action, corrective counseling, PIP, reprimand,
   * probation, fire, let go — while `suspension` and `final warning` fired.
   * The list was arbitrary rather than principled: it held whichever words had
   * come up in an earlier round, so a manager asking "Should Sarah be put on a
   * PIP?" reached the model with the metric-alone rule absent.
   *
   * So this pass walks each core disciplinary ACTION through its forms rather
   * than adding the eleven sentences QA happened to write.
   *
   * BREADTH IS SAFE HERE ONLY BECAUSE AN ESCALATION TERM NEVER FIRES ALONE. It
   * needs a person (branch 1) or current case data (branch 3), and a lookup or
   * a definition about the same word is suppressed ahead of both. That is what
   * lets `warning` and `counseling` be listed as bare nouns without "What is
   * the warning policy?" or "What is corrective counseling?" being refused —
   * and both are asserted as negatives.
   */
  // Warnings, from the verb through to the named severities.
  "warn",
  "warned",
  "warning",
  "warnings",
  "written warning",
  "formal warning",
  "verbal warning",
  "final warning",
  // Corrective action and counselling, both spellings.
  "corrective action",
  "formal action",
  "corrective counseling",
  "corrective counselling",
  "counsel",
  "counseled",
  "counselled",
  "counseling",
  "counselling",
  // Improvement plans. `performance improvement` above covers the long form.
  "pip",
  "pips",
  "improvement plan",
  "performance plan",
  /*
   * Dismissal in the words a manager actually uses. `fire` earns its place —
   * "Should we fire Sarah?" carries no other signal — and is safe ONLY
   * alongside `NOT_ESCALATION_COMPOUNDS` below, because a salon is full of fire
   * equipment.
   */
  "fire",
  "fires",
  "fired",
  "firing",
  "let go",
  // Reprimand and probation.
  "reprimand",
  "reprimanded",
  "reprimands",
  "probation",
  "probationary",
];

/**
 * Compound nouns where an escalation word is not an escalation.
 *
 * `fire` on the list above is what makes "Should we fire Sarah?" reach the
 * framework, and it is also why "Sarah, did you check the fire alarm?" would
 * otherwise read as a termination question. A salon has an extinguisher, a
 * drill, an exit and a safety log; none of them is a dismissal.
 *
 * BLANKED BEFORE THE TEST RATHER THAN EXCLUDED AFTERWARDS, so the surrounding
 * words still count: "Should we fire Sarah after she ignored the fire drill?"
 * loses only the second `fire` and still reads as an escalation.
 *
 * Bounded to a fixed noun list rather than a general "fire + anything" rule,
 * because the escalation reading is the one that matters and a wildcard would
 * quietly delete it.
 */
const NOT_ESCALATION_COMPOUNDS =
  /\bfire\s+(?:alarm|alarms|drill|drills|extinguisher|extinguishers|exit|exits|escape|safety|marshal|marshall|warden|department|code|codes|suppression|hazard|hazards|door|doors|inspection|inspections|evacuation|log|logs|blanket|blankets|panel|sprinkler|sprinklers|retardant|lane|lanes|watch)\b/gi;

/**
 * Escalation actions that a word list cannot express.
 *
 * `write up` is a SEPARABLE phrasal verb, and a literal two-word term only ever
 * matched the un-separated form. "Should we write her up?" therefore carried no
 * escalation signal at all, and a plain request for a disciplinary decision
 * about a person was answered with the metric-alone guard absent — the exact
 * harm the framework exists to prevent.
 *
 * Bounded to three intervening words so it reads a person or a short noun
 * phrase ("write this employee up") and does not stretch across a clause.
 */
export const ESCALATION_ACTION_PATTERNS: readonly RegExp[] = [
  /\bwrit(?:e|es|ing|ten)\s+(?:\w+\s+){0,3}up\b/i,
  /*
   * `let … go` is the same shape and the same problem. The literal term "let
   * go" only ever matched the un-separated form, so "Should we let Jane go?" —
   * a dismissal question about a named person — carried no escalation signal.
   *
   * TWO EXCLUSIONS, because this one has near neighbours the write-up pattern
   * does not. A FIRST-PERSON object is never a dismissal ("let me go through
   * her numbers"), and neither is `go` followed by its own particle ("let the
   * shift go on"). Without those, an ordinary sentence that happens to mention
   * somebody would read as a termination request.
   */
  /\blet\s+(?!me\b|us\b|it\b)(?:\w+\s+){1,2}go\b(?!\s+(?:through|over|into|back|ahead|on|out|down|live|first|home))/i,
];

/**
 * ============================================================================
 * A PERSON, OR A CATEGORY OF PEOPLE
 * ============================================================================
 *
 * QA found this firing:
 *
 *   "Can managers discipline employees under this policy?"
 *
 * `managers` and `employees` were subject words, so the question read as a
 * decision about somebody — and under fail-closed grounding an ordinary policy
 * lookup was REFUSED. But a question about employees as a CLASS is a policy
 * question; a question about an employee is a decision.
 *
 * The distinction is the determiner, not the word:
 *
 *   "employees"                generic  -> policy
 *   "this employee"            specific -> decision
 *   "my employee"              specific -> decision
 *   "the employee"             specific -> decision
 *   "one of these employees"   specific -> decision
 *   "which team member"        specific -> decision
 *
 * SINGULAR person nouns are individuating on their own — you cannot say "the
 * employee" about a class. PLURAL person nouns are generic UNLESS an explicit
 * selector picks one out of them.
 *
 * Deleting the plural words globally, as the brief warns, would have lost
 * "Should one of these employees be disciplined based on this report?" — which
 * is a case-specific decision wearing a plural noun.
 */

/** Person nouns in the singular. Individuating with any determiner. */
const PERSON_NOUN_SINGULAR =
  "(?:employee|manager|consultant|associate|teammate|team member|staff member|tanning consultant)";

/** Person nouns in the plural. Generic unless a selector picks one out. */
const PERSON_NOUN_PLURAL =
  "(?:employees|managers|consultants|associates|teammates|team members|staff members|staff)";

/**
 * References to ONE person: a pronoun, a determined singular, a selected
 * plural, or the manager's own team.
 */
/** Singular pronouns, which cannot refer to a class and so always individuate. */
const SINGULAR_PRONOUN = /\b(?:her|him|she|he)\b/i;

/**
 * Plural and indefinite persons, which CAN refer to a class.
 *
 * Split out because they were unconditional here, and that read a generic
 * policy question as being about somebody:
 *
 *   "Can managers discipline them when employees break this rule?"
 *
 * `them` is the employees, not a particular employee, so this fired the
 * escalation rule and could refuse an ordinary policy question. Where a bare
 * category sits in the same sentence, that is what the pronoun refers to; with
 * no class to point at — "Should we write them up?" — it is a person.
 */
const PLURAL_PRONOUN = /\b(?:them|they|anyone|anybody|someone|somebody|nobody|everyone)\b/i;

const INDIVIDUAL_REFERENCE: readonly RegExp[] = [
  // Singular pronouns. Plural and indefinite ones are handled separately.
  SINGULAR_PRONOUN,
  // A determined singular: "this employee", "the consultant", "which team member".
  new RegExp(
    `\\b(?:this|that|the|my|our|your|a|an|each|any|one|which|whose)\\s+${PERSON_NOUN_SINGULAR}\\b`,
    "i",
  ),
  // A selected plural: "one of these employees", "any of my consultants".
  new RegExp(
    `\\b(?:one|some|two|three|which|any|each|either)\\s+of\\s+(?:these|those|the|my|our|your)\\s+${PERSON_NOUN_PLURAL}\\b`,
    "i",
  ),
  // The manager's own team is case-specific; "the team" in general is not.
  /\b(?:my|our)\s+team\b/i,
];

/** A bare category of people, with nothing picking anybody out. */
const CATEGORY_REFERENCE = new RegExp(`\\b${PERSON_NOUN_PLURAL}\\b`, "i");

/**
 * Whether the question is about a PARTICULAR person rather than a class.
 *
 * Exported so the matrices can assert the reason a question routed as it did,
 * not only where it ended up.
 */
export function mentionsIndividual(question: string): boolean {
  const text = question ?? "";
  if (INDIVIDUAL_REFERENCE.some((pattern) => pattern.test(text))) return true;
  if (mentionsPersonName(text)) return true;

  /*
   * A plural or indefinite pronoun counts only where there is no class for it
   * to refer to. Checked last, so a selected plural ("one of these employees")
   * has already returned true above and is unaffected.
   */
  return PLURAL_PRONOUN.test(text) && !CATEGORY_REFERENCE.test(text);
}

/** Whether the question mentions people only as a category. */
export function mentionsCategoryOnly(question: string): boolean {
  const text = question ?? "";
  return CATEGORY_REFERENCE.test(text) && !mentionsIndividual(text);
}

/**
 * ============================================================================
 * CURRENT CASE DATA
 * ============================================================================
 *
 * "Based on those numbers, is a write-up appropriate?" names nobody, so the
 * person test fails — and the question went to the model with no framework,
 * which is the single worst case there is: an escalation asked FOR on the
 * strength of metrics, answered without the rule that metrics are never
 * grounds on their own.
 *
 * The employee is implied by the data. So a demonstrative pointing at figures
 * the manager has in front of them establishes the same decision context a name
 * would.
 *
 * DELIBERATELY BOUNDED to demonstratives and "based on". A bare mention of
 * `report`, `numbers` or `data` must NOT count — "What does this report
 * contain?" and "Summarize these numbers." are reading questions, and this
 * signal only ever combines with an escalation term, never fires alone.
 */
export const CASE_DATA_PATTERNS: readonly RegExp[] = [
  /\b(?:these|those|this|that)\s+(?:month'?s\s+)?(?:numbers|metrics|figures|results|stats|statistics|data|report|reports|scorecard)\b/i,
  /\bbased on\s+(?:this|that|these|those|the|what|her|his|their|its)\b/i,
  /\b(?:given|per|from)\s+(?:this|that|these|those)\s+(?:numbers|metrics|figures|results|stats|data|report)\b/i,
  /\bwhat we (?:just )?(?:reviewed|saw|discussed)\b/i,
  /*
   * A DEMONSTRATIVE HANDED STRAIGHT TO A JUSTIFICATION VERB.
   *
   * "Does this warrant a formal warning?" points at figures without naming a
   * noun for them, so none of the patterns above saw it — and QA found it
   * reaching the model with the guard absent. The verb is what makes it case
   * data rather than a reading question: a manager asking whether THIS
   * warrants something is asking about what is in front of them.
   *
   * Bounded to the justification verbs, so "What does this say?" and
   * "Summarize these numbers." are untouched.
   */
  /\b(?:this|that|these|those|it)\s+(?:warrant|warrants|justify|justifies|merit|merits|support|supports|call for|calls for)\b/i,
  /*
   * TODAY'S FIGURES, which are current case data by definition. The Daily
   * Stats path routes on the same language, and "Do today's results warrant
   * formal action?" names nobody — so without this the escalation term has
   * neither a person nor case data to combine with.
   */
  /\b(?:today'?s|this (?:week|month|shift)'?s|yesterday'?s)\s+(?:numbers|metrics|figures|results|stats|statistics|data|report|reports|scorecard|performance)\b/i,
];

/** Whether the manager is pointing at current figures or a current report. */
export function mentionsCaseData(question: string): boolean {
  const text = question ?? "";
  return CASE_DATA_PATTERNS.some((pattern) => pattern.test(text));
}

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
/*
 * NO COMPILED `SUBJECT` PATTERN ANY MORE, and its absence is deliberate rather
 * than an oversight.
 *
 * The subject half of the rule is now `mentionsIndividual`, which asks whether
 * the question picks a PARTICULAR person out — a singular reference or a name —
 * rather than whether any subject word appears. That is what settles "Can
 * managers discipline employees under this policy?": both nouns are subject
 * words and neither picks anybody out, so the old pattern called it an
 * employee-performance question and the new test correctly does not.
 *
 * `SUBJECT_TERMS` is kept as the documented vocabulary that rule grew out of.
 */
const PREDICATE = patternFor(PREDICATE_TERMS);
const ESCALATION_WORDS = patternFor(ESCALATION_ACTION_TERMS);

/** An escalation action, by word or by separable phrasal verb. */
export function mentionsEscalationAction(question: string): boolean {
  const text = (question ?? "").replace(NOT_ESCALATION_COMPOUNDS, " ");
  return (
    ESCALATION_WORDS.test(text) ||
    ESCALATION_ACTION_PATTERNS.some((pattern) => pattern.test(text))
  );
}

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
/**
 * Shapes that ASK FOR a document, with no noun list of their own.
 *
 * The previous version embedded document nouns inside the `what is` shape —
 * `policy|process|procedure|rule|rules|guideline|guidelines|steps` — while
 * `DOCUMENT_NOUNS` listed a different set. The two drifted, and the gap was a
 * real refusal: "What is a coaching form used for?" matched no shape, so
 * `coaching` fired and the question was refused when the framework was
 * unavailable. `form` was in one list and not the other.
 *
 * So the shapes are now shape-only and the noun requirement is `DOCUMENT_NOUNS`
 * alone. ONE list, consulted once, and no way for a noun to be understood by
 * half the rule.
 */
const LOOKUP_SHAPES: readonly RegExp[] = [
  /\bwhat (?:does|do|did)\b[\s\S]*\bsay\b/i,
  /\bwhat(?:'s| is| are| was| were)\b/i,
  /\bwhere\b[\s\S]*\b(?:find|is|are|can i get|do i get|do i look|documented)\b/i,
  /\bhow (?:do|can) i (?:find|access|get|download|print|use)\b/i,
  /\bhow many\b/i,
  /\bis there a\b/i,
  /*
   * SHAPE-ONLY, like every other shape here. This still re-typed seven nouns —
   * the last surviving copy of the list — and required the noun to be adjacent,
   * so "Which coaching form should I use?" matched nothing and `coaching` fired
   * on a Forms lookup. The noun requirement is `DOCUMENT_NOUNS` alone.
   */
  /\bwhich\b/i,
  /\bshow me the\b/i,
  /\bcan i (?:see|read|find)\b/i,
  /\bwhen is\b[\s\S]*\brequired\b/i,
  /*
   * ==========================================================================
   * THE CONSTRUCTIONS A MANAGER ACTUALLY USES TO ASK FOR A DOCUMENT
   * ==========================================================================
   *
   * QA measured six natural lookups firing the framework, and every one is a
   * question the corpus answers well:
   *
   *   "Explain the coaching process."          -> fired
   *   "Describe the coaching procedure."       -> fired
   *   "Tell me about the coaching guide."      -> fired
   *   "Do we have a coaching form?"            -> fired
   *   "What procedure applies to coaching?"    -> fired
   *   "What policy covers verbal coaching?"    -> fired
   *
   * The shapes above only knew how to ask what a document SAYS or where it IS.
   * They had no way to ask for an EXPLANATION of one, whether one EXISTS, or
   * which one GOVERNS a topic — so `coaching` fired and, under fail-closed
   * grounding, the answer became a refusal.
   *
   * STILL SHAPE-ONLY. Every addition is a verb or an interrogative frame; not
   * one of them re-types a noun. `DOCUMENT_NOUNS` remains the single noun
   * source, which is what stopped the drift that let "What is a coaching form
   * used for?" through in the first place.
   */
  // Asking for an explanation of a document or a process.
  /\b(?:explain|describe|outline|walk me through)\b/i,
  /\btell me about\b/i,
  /\bused for\b/i,
  // Asking whether one exists.
  /\bdo(?:es)? (?:we|you|i|they|the company|the salon) have (?:a|an|any)\b/i,
  /\bdo we keep\b/i,
  /*
   * Asking which document to USE. "Should we use the coaching form?" fired on
   * the strong term `coaching` — a Forms question answered as an employee one,
   * and refused outright while the framework was unavailable. Safe because the
   * noun requirement still applies and because a person in the sentence skips
   * this branch entirely: "Should I use the coaching form for Sarah?" is an
   * employee decision and still fires.
   */
  /\b(?:should|can|could|do|must|would) (?:i|we|you) use\b/i,
  // Asking which document governs something.
  /\b(?:what|which)\b[\s\S]*\b(?:applies|apply|applicable|covers|cover|governs|govern)\b/i,
  // Asking where one is, in the words the narrower `where` shape missed.
  /\bwhere\b[\s\S]*\b(?:locate|kept|stored)\b/i,
  /\bhow (?:do|can) i (?:locate|fill|complete|submit)\b/i,
  /\bpoint me (?:at|to)\b/i,
];

/**
 * The ONE list of document nouns. Both halves of the rule read this.
 *
 * `steps`, `template` and `document` were the ones the drifted shape list knew
 * about and this did not, or vice versa.
 */
const DOCUMENT_NOUNS = patternFor([
  "policy",
  "policies",
  "process",
  "processes",
  "procedure",
  "procedures",
  "manual",
  "handbook",
  "guide",
  "guidelines",
  "guideline",
  "binder",
  "document",
  "documentation",
  "template",
  "form",
  "forms",
  "sop",
  "rule",
  "rules",
  "checklist",
  "steps",
  "step",
]);

/**
 * Whether the question is asking about a DOCUMENT rather than about a person.
 *
 * Exported so the negative matrix can assert the reason a question was
 * suppressed, not merely that it was.
 */
export function isDocumentaryLookup(question: string): boolean {
  const text = question ?? "";
  if (!DOCUMENT_NOUNS.test(text)) return false;
  return LOOKUP_SHAPES.some((shape) => shape.test(text));
}

/**
 * ============================================================================
 * ASKING WHAT SOMETHING IS, VERSUS ASKING WHAT TO DO ABOUT SOMEBODY
 * ============================================================================
 *
 * "What is an EPP?" was REFUSED. The acronym is a strong term, the question
 * carries no document noun for `isDocumentaryLookup` to find, and under
 * fail-closed grounding that turns a one-line definition into a refusal. Same
 * for "What is a DPOA?", "What is coaching?" and "What does EPP stand for?".
 *
 * A DEFINITION IS NOT A DECISION, so a bare definitional question suppresses
 * the gate on the same terms a documentary lookup does — with nobody named and
 * nothing being decided.
 *
 * ============================================================================
 * WHY THIS IS NARROWER THAN A BARE `what is` SHAPE
 * ============================================================================
 *
 * The obvious implementation is "any `what is …` with no person in it". That
 * is too much: it also swallows
 *
 *   "What is the biggest coaching opportunity?"
 *
 * which is a prioritisation question, needs the framework, and would have been
 * answered with the escalation guard absent. Suppressing on the interrogative
 * alone trades a false refusal for a bypass, which is the worse of the two.
 *
 * So the rule has TWO HALVES, exactly like the documentary one:
 *
 *   1. a definitional SHAPE — asking what a term means, stands for, or is;
 *   2. the thing being defined must be a DISCIPLINARY OR COACHING CONCEPT,
 *      read from the vocabularies that already exist rather than a third list.
 *
 * And a SUPERLATIVE HOLDS IT OPEN. "the biggest", "the lowest", "the worst"
 * are how a manager asks to be ranked, never how anyone asks for a definition,
 * so their presence means this is not a bare definition however it is phrased.
 */
const DEFINITIONAL_SHAPES: readonly RegExp[] = [
  /*
   * ANCHORED, so the whole question has to BE the definition. An unanchored
   * `what is` would match the tail of "Given her numbers, what is the right
   * action?" — which is a decision wearing an interrogative.
   */
  /^\s*(?:so\s+)?what(?:'s| is| are)\s+(?:a|an|the)?\s*[\w'\u2019 /-]{1,48}\??\s*$/i,
  /\bwhat (?:does|do)\b[^?]*\bstand for\b/i,
  /\bwhat (?:does|do|would)\b[^?]*\bmean\b/i,
  /\bwhat (?:is|are) meant by\b/i,
  /\bdefine\b/i,
  /\bdefinition of\b/i,
  /\bremind me what\b/i,
];

/**
 * Superlatives and rankings. Present in a prioritisation request, absent from
 * every definition, so they veto the definitional reading.
 */
const RANKING_LANGUAGE =
  /\b(?:biggest|largest|smallest|best|worst|lowest|highest|weakest|strongest|top|bottom|most|least|first|priority|priorities)\b/i;

/** Whether the turn is asking what a coaching or disciplinary term IS. */
export function isDefinitionalLookup(question: string): boolean {
  const text = question ?? "";
  if (RANKING_LANGUAGE.test(text)) return false;
  if (!DEFINITIONAL_SHAPES.some((shape) => shape.test(text))) return false;
  // The subject has to be a concept this gate governs, read from the two
  // vocabularies that already exist. No third noun list.
  return mentionsEscalationAction(text) || STRONG.test(text);
}

/**
 * Whether the turn asks for a RECOMMENDATION rather than for information.
 *
 * This is the signal that holds the referent path open: a question can mention
 * a policy, a form and an acronym and still be asking what to do about
 * somebody. "Does Jane need an EPP?" carries the same acronym as "What is an
 * EPP?" and is the opposite kind of question.
 *
 * `warrant`, `justify`, `merit` and `appropriate` are here because they are how
 * a manager asks for an escalation without using the word "should".
 */
const DECISION_SHAPES: readonly RegExp[] = [
  /\bshould\b/i,
  /\bshall\b/i,
  /\bdo (?:i|we|you) need to\b/i,
  /\b(?:does|do|did)\b[\s\S]*\bneed\b/i,
  /\bjustif(?:y|ies|ied|iable)\b/i,
  /\bwarrant(?:s|ed)?\b/i,
  /\bmerit(?:s|ed)?\b/i,
  /\bappropriate\b/i,
  /\bwould\b[\s\S]*\b(?:make sense|be right|be fair|be appropriate)\b/i,
  /\bwhat (?:action|steps?) should\b/i,
  /\bwhat should i do about\b/i,
  /\bcan i\s+(?:\w+\s+){0,2}(?:discipline|coach|write|terminate|suspend|warn|reprimand|fire)\b/i,
  /\b(?:is|isn'?t) (?:it|that|this) (?:time|right|fair|appropriate)\b/i,
  /\bam i right to\b/i,
];

/** Whether the turn is asking for a recommendation about somebody. */
export function isDecisionRequest(question: string): boolean {
  return DECISION_SHAPES.some((shape) => shape.test(question ?? ""));
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

  const individual = mentionsIndividual(text);
  const escalation = mentionsEscalationAction(text);

  /*
   * 1. AN ESCALATION ABOUT A PARTICULAR PERSON outranks everything, including
   *    the documentary suppressor. Adding "under the policy" to "Should I
   *    discipline Sarah?" must not be a way to ask for the recommendation with
   *    the guard switched off.
   */
  if (escalation && individual) return true;

  /*
   * 2. A LOOKUP OR A DEFINITION, with nobody picked out, is a Knowledge Base
   *    question. Suppressed ahead of the strong terms, because "What does the
   *    coaching policy say?" carries one and is still a lookup — and under
   *    fail-closed grounding, wrongly claiming it needs the framework REFUSES
   *    an answer the corpus holds.
   *
   *    This also settles the category case: "Can managers discipline employees
   *    under this policy?" reaches here rather than branch 1, because a bare
   *    plural picks nobody out.
   *
   *    `!individual` IS THE ONLY GUARD THIS NEEDS, and adding a `!isDecision`
   *    term — as an earlier draft did — is a mistake worth recording. Every
   *    escalation decision the framework must catch names somebody, so
   *    `!individual` has already excluded it; what a `!isDecision` term
   *    additionally holds open is the PERSON-LESS decision, and those are
   *    process questions rather than employee ones:
   *
   *      "Which coaching form should I use?"   -> a Forms lookup
   *      "Should we use the coaching form?"    -> a Forms lookup
   *
   *    Both carry `should` and neither is about an employee. The narrower rule
   *    keeps them answerable.
   */
  if (!individual && (isDocumentaryLookup(text) || isDefinitionalLookup(text))) {
    return false;
  }

  /*
   * 3. AN ESCALATION ABOUT CURRENT CASE DATA. The employee is implied by the
   *    figures the manager is looking at, and an escalation asked for on the
   *    strength of metrics is the one question that most needs the rule saying
   *    metrics are never grounds alone.
   *
   *    Deliberately AFTER the suppressor, so "What does this report say about
   *    the disciplinary policy?" stays a reading question.
   */
  if (escalation && mentionsCaseData(text)) return true;

  /*
   * 4. A GENERIC CATEGORY WITH NO ESCALATION AND NO JUDGEMENT is a policy
   *    question. Stated explicitly rather than left to fall through, because
   *    "What are managers allowed to do when employees violate this rule?"
   *    carries no document noun and would otherwise reach the strong terms.
   */
  if (mentionsCategoryOnly(text) && !escalation && !PREDICATE.test(text)) {
    return false;
  }

  if (STRONG.test(text)) return true;

  if (!PREDICATE.test(text)) return false;

  return individual;
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

/**
 * Openings that mark a fragment continuing the previous turn.
 *
 * QA found the enumeration incomplete rather than the mechanism wrong: the
 * multi-hop walk worked, but "How so?", "What do you mean?" and "Based on
 * that?" were not recognised as fragments at all, so a coaching conversation
 * lost the framework three turns in.
 *
 * The additions are the near neighbours of what was already here — asking for
 * elaboration, asking what was meant, and pointing back at what was just said.
 * All are anchored at the START, because what makes a fragment a fragment is
 * that it points BACKWARDS; a clause containing "based on that" in the middle
 * of a full question is not one.
 */
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
  // Asking how or why, at greater length than a single word.
  /^\s*how (?:so|come|is that|does that)\b/i,
  /^\s*why (?:is that|does that|not|then)\b/i,
  /^\s*what (?:then|else|now)\b/i,
  // Asking what was meant.
  /*
   * NEAR NEIGHBOURS, not the brief's sixteen literals. A fragment the
   * classifier misses LOSES intent, so the escalation guard goes absent
   * mid-conversation — the harmful direction. "What does that mean", "why
   * then" and "what else" are the same turn as the forms already listed.
   */
  /^\s*what do(?:es)? (?:you|that|this|it) mean\b/i,
  /^\s*(?:meaning|in what way|in what sense|such as|like what|for example|e\.g\.)\b/i,
  /^\s*(?:really|seriously)\s*\??\s*$/i,
  // Pointing back at what was just said.
  /*
   * THE DEMONSTRATIVE HAS TO BE BARE.
   *
   * These matched any prefix, so a COMPLETE question that merely opened this
   * way was read as a fragment and inherited the previous anchor's topic:
   *
   *   "According to this policy, what is the refund window?"   -> fragment
   *
   * After a coaching anchor that inherits employee-performance intent, which
   * makes the framework mandatory for a refund-policy question and REFUSES it
   * when the framework is down — the fail-closed false positive this gate
   * exists to prevent.
   *
   * The distinction is whether the demonstrative stands alone. Bare, it points
   * backwards and the turn is a fragment; followed by a NOUN it is the subject
   * of a new question:
   *
   *   "Based on that, what should I do?"             that + ","   -> fragment
   *   "Based on those numbers, what was our total?"  those + noun -> complete
   *
   * So it must be followed by punctuation or the end of the turn.
   */
  /^\s*based on (?:that|this|those|these|it)\s*(?:[,.;:!?]|$)/i,
  /^\s*(?:according to|given) (?:that|this|those|these|it)\s*(?:[,.;:!?]|$)/i,
  /^\s*(?:from|because of) (?:that|this)\s*(?:[,.;:!?]|$)/i,
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

/**
 * ============================================================================
 * A DECISION WHOSE ACTION THE PREVIOUS TURN NAMED
 * ============================================================================
 *
 * The third way intent is established, and the one QA found missing entirely.
 * A manager looks a policy up and then asks whether to apply it:
 *
 *   "What is the disciplinary policy?"   ->  "Should Sarah get one?"
 *   "What is an EPP?"                    ->  "Does Jane need one?"
 *   "Where is the write-up form?"        ->  "Should I use it for Sarah?"
 *
 * Every second turn is a request for a disciplinary recommendation about a
 * named person. Read alone, none of them contains a disciplinary word at all —
 * the action is sitting in the pronoun. All twelve of QA's sequences reached
 * the model with no framework and no escalation guard.
 *
 * ============================================================================
 * WHY THIS IS NOT COREFERENCE, AND NOT MEMORY
 * ============================================================================
 *
 * It resolves ONE thing — the action — and only when the turn cannot be
 * understood without it. FOUR CONDITIONS, all required:
 *
 *   1. the turn ASKS FOR A DECISION (`isDecisionRequest`);
 *   2. the turn NAMES A PARTICULAR PERSON (`mentionsIndividual`);
 *   3. the turn's action is an UNRESOLVED REFERENT — a bare `one`, `it`,
 *      `that`, `them`; a turn that names its own action fires in branch 1 and
 *      never reaches here;
 *   4. the nearest STANDALONE ANCHOR actually supplies an action this gate
 *      recognises.
 *
 * Condition 4 uses the SAME bounded walk as the fragment path, so nothing older
 * than the nearest standalone turn is ever consulted, and the walk still gives
 * up after `MAX_CONTINUATION_HOPS`. There is no sticky flag: each turn is
 * judged on its own shape against one anchor.
 *
 * WHAT EACH CONDITION REJECTS, from QA's over-inference list:
 *
 *   "Can managers discipline employees…" -> "What about Sarah?"
 *       fails 1 and 3: nothing is being asked for.
 *   "What is the coaching policy?"       -> "What about Sarah?"
 *       fails 1: a named person is not a request.
 *   "What does the refund policy say?"   -> "Should Sarah get one?"
 *       fails 4: the anchor names no action this gate governs.
 *
 * The prior SUBJECT is never inherited — only the action. "Should Sarah get
 * one?" after a policy lookup is about Sarah because it says Sarah.
 */

/**
 * Pronouns standing in for an action the anchor named.
 *
 * Only the referring words, only as whole words. A turn that names its own
 * action does not need this path.
 */
const ACTION_REFERENT = /\b(?:one|it|that|this|these|those|them|the same)\b/i;

/** Whether the turn leans on a previous turn for the action it is about. */
export function hasActionReferent(question: string): boolean {
  return ACTION_REFERENT.test(question ?? "");
}

/**
 * Whether an anchor turn names an action a later referent could point at.
 *
 * Read from the escalation vocabulary and the strong terms rather than a list
 * of its own, so widening either one widens this automatically — which is what
 * makes the probation, counselling and PIP sequences work.
 */
export function suppliesActionReferent(anchor: string): boolean {
  const text = anchor ?? "";
  return mentionsEscalationAction(text) || STRONG.test(text);
}

export type EmployeePerformanceIntentSource = "explicit" | "continuation" | "referent";

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

  const history = input.history ?? [];

  /*
   * A DECISION ABOUT A PERSON WHOSE ACTION THE ANCHOR NAMED — checked before
   * the fragment path, because such a turn is usually NOT a fragment. "Should
   * Sarah get one?" is a whole, well-formed question that happens to be
   * missing one noun, so `isEllipticalFollowUp` correctly says no to it and the
   * walk below would never run.
   */
  if (
    isDecisionRequest(input.question) &&
    mentionsIndividual(input.question) &&
    hasActionReferent(input.question)
  ) {
    const referentAnchor = findContinuationAnchor(history);
    if (referentAnchor !== null && suppliesActionReferent(referentAnchor)) {
      return { active: true, source: "referent", anchor: referentAnchor };
    }
  }

  if (!isEllipticalFollowUp(input.question)) return INACTIVE;

  const anchor = findContinuationAnchor(history);
  if (anchor === null) return INACTIVE;

  return isEmployeePerformanceQuestion(anchor)
    ? { active: true, source: "continuation", anchor }
    : INACTIVE;
}
