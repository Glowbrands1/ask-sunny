import {
  orderReportFamilies,
  REPORT_FAMILY_IDS,
  type ReportFamilyId,
} from "./report-families";

/**
 * ============================================================================
 * WHICH REPORTS A QUESTION NEEDS
 * ============================================================================
 *
 * Managers do not ask for reports. They ask "what should I focus on today",
 * "why is revenue down", "why is Spa weak", "where should we add equipment",
 * "what looks strong" — and the answer to each of those lives in a different
 * combination of the five families. Before this module, Chat had one boolean
 * for three of the five, so "why is revenue down" reached a prompt with bed and
 * spa figures in it and no revenue at all.
 *
 * So routing is TWO LAYERS, and the second is the one that earns its keep:
 *
 *   PER-FAMILY VOCABULARY   The reports' own words. "per bed" wants Bed Usage;
 *                           "PPTA" wants Sales Totals. Mechanical, and it is
 *                           what makes a question naming a metric work.
 *
 *   INTENTS                 Question SHAPES that need several families at once
 *                           and name none of them. "Why is Spa weak?" contains
 *                           no bed vocabulary, but answering it honestly means
 *                           separating a traffic problem from an execution
 *                           problem, and the traffic is in Bed Usage. An intent
 *                           is the only way that companion arrives.
 *
 * Both layers are keyword gates rather than a classifier, for the reason
 * `bed-spa/question-gate.ts` states at length: a classifier is a second model
 * round trip before the answer and a second thing to be wrong, and the cost of
 * THIS being wrong is bounded in a way a classifier's is not.
 *
 *   A FALSE POSITIVE costs prompt tokens and latency. An unwanted family's
 *   section arrives, the model does not use it, and the answer is unaffected —
 *   the prompt is explicit that report figures answer questions about the
 *   reports.
 *
 *   A FALSE NEGATIVE is the real failure, and it has two shapes. Either Sunny
 *   says the knowledge base does not cover something that is sitting in a
 *   loaded report, or — worse, and the reason the intents exist — it answers
 *   from ONE family when the honest answer needed two, and blames execution for
 *   what was a traffic problem.
 *
 * So the vocabulary leans INCLUSIVE.
 *
 * ============================================================================
 * WHY THE BED AND SPA VOCABULARIES ARE THE HISTORICAL PARTITION, EXACTLY
 * ============================================================================
 *
 * `bed-spa/question-gate.ts` shipped one flat list covering three families, and
 * its own test suite pins the questions it must open and must not open. Those
 * three vocabularies below are that list PARTITIONED and nothing else — no term
 * added, none removed — and the gate now derives its list from their union. So
 * the existing behaviour is preserved by construction rather than by
 * re-reviewing eighty questions, and there is one place a term lives.
 *
 * Every new term went into the Sales Totals and Salon Performance vocabularies,
 * which the bed/spa gate does not read.
 */

/**
 * The reports' own vocabulary, by family.
 *
 * Matched case-insensitively on word boundaries, so `tans` does not fire on
 * `constants` and `spa` does not fire on `spare`. Multi-word terms keep their
 * internal space; hyphenated spellings that matter are listed separately rather
 * than handled by a looser boundary, because loosening it is what would make
 * `tan` match `tangible`.
 *
 * `salon`, `store` and `location` are absent, from every family. They appear in
 * nearly every question a manager asks, so gating on them is the same as having
 * no gate.
 */
export const FAMILY_QUESTION_TERMS: Readonly<Record<ReportFamilyId, readonly string[]>> = {
  /*
   * SALES TOTALS — the daily signal, and the family a broad operational
   * question reaches first. Its six measures plus the words a manager uses for
   * "what happened yesterday".
   */
  "sales-totals": [
    "sales totals",
    "grand total",
    "ppta",
    "per person",
    "new customers",
    "new customer",
    "sunless sessions",
    "revenue",
    "sales",
    "takings",
    "today",
    "yesterday",
    "daily",
    "day",
    "this morning",
  ],
  /*
   * SALON PERFORMANCE — the trend the daily signal sits inside. Comp vocabulary
   * and the words for direction.
   *
   * `membership` and `memberships` are deliberately absent: "what is the refund
   * policy on memberships" is a policy question, and the Comp Report's
   * membership measures are reachable through `eft` and `club`.
   */
  "salon-performance": [
    "salon performance",
    "comp report",
    "comp",
    "comps",
    "comparable",
    "same store",
    "same-store",
    "mtd",
    "month to date",
    "month-to-date",
    "ytd",
    "year to date",
    "year-to-date",
    "last year",
    "prior year",
    "trend",
    "trending",
    "improving",
    "improved",
    "growth",
    "declining",
    "otc",
    "eft",
    "efts",
    "club",
    "club close",
    "compare",
    "comparison",
    "strongest",
    "weakest",
    "biggest gap",
    "keeping pace",
    "district",
    "districts",
    "region",
    "regions",
  ],
  /* BED USAGE — the historical partition. Traffic, beds and the chain. */
  "bed-usage": [
    "bed usage",
    "bed level",
    "per bed",
    "tans per bed",
    "tan",
    "tans",
    "tanning",
    "beds",
    "bed count",
    "v chain",
    "vs chain",
    "versus chain",
    "chain average",
    "utilisation",
    "utilization",
    "fastest",
    "faster",
    "instant",
    "sunless",
    "traffic",
    "outperform",
    "outperforming",
    "underperform",
    "underperforming",
    "below market",
    "at market",
    "capital",
    "expansion",
  ],
  /* SPA WELLNESS — the historical partition. Equipment and peers. */
  "spa-wellness": [
    "spa",
    "wellness",
    "hydromassage",
    "hydro",
    "equipment",
    "peer average",
    "peers",
    "sessions",
    "session",
    "installed",
    "capital",
    "expansion",
    "outperform",
    "outperforming",
    "underperform",
    "underperforming",
    "below market",
    "at market",
  ],
  /* SPA ENGAGEMENT — the historical partition. Conversion, uniques and ranks. */
  "spa-engagement": [
    "conversion",
    "unique tanner",
    "unique tanners",
    "engagement",
    "spa bed",
    "spa beds",
    "ranked",
    "ranking",
    "rank",
    "capital",
    "expansion",
  ],
};

/**
 * ============================================================================
 * QUESTION SHAPES THAT NEED SEVERAL FAMILIES AND NAME NONE OF THEM
 * ============================================================================
 *
 * Each intent is a set of phrases and the families answering it honestly
 * requires. They ADD to whatever the per-family vocabulary matched; they never
 * subtract, because a manager who names a metric AND asks a broad question
 * wants both.
 *
 * The companion families are not a guess. They are the ones the approved
 * reasoning already names: separating a traffic problem from a Spa execution
 * problem needs the traffic, and the capital-allocation framework is explicitly
 * "traffic + utilization + conversion + peer performance".
 */
export interface ReportQuestionIntent {
  readonly id: string;
  /** What the intent is for, in one line. Read by the routing test. */
  readonly purpose: string;
  readonly terms: readonly string[];
  readonly families: readonly ReportFamilyId[];
}

export const REPORT_QUESTION_INTENTS: readonly ReportQuestionIntent[] = [
  {
    id: "daily_focus",
    purpose:
      "A broad operational question about today or yesterday. Starts from the daily signal inside its trend.",
    terms: [
      "focus on today",
      "focus on first",
      "what should i focus",
      "what do i focus",
      "priorities today",
      "priority today",
      "top priorities",
      "top 3",
      "top three",
      "what happened yesterday",
      "how are we doing",
      "how did we do",
      "how are we tracking",
      "where do i start",
      "start my day",
      "what should i coach",
      "what should i work on",
      "morning meeting",
      "huddle",
      "shift huddle",
    ],
    families: ["sales-totals", "salon-performance"],
  },
  {
    id: "recognition",
    purpose:
      "What to praise. The half of a manager's job that is not underperformance.",
    terms: [
      "what looks strong",
      "what is strong",
      "what's strong",
      "what looks good",
      "what is going well",
      "what's going well",
      "going well",
      "our wins",
      "any wins",
      "recognition",
      "recognise",
      "recognize",
      "shout out",
      "shoutout",
      "celebrate",
      "praise",
      "who is doing well",
    ],
    families: ["sales-totals", "salon-performance"],
  },
  {
    id: "revenue_direction",
    purpose:
      "Revenue up or down. Needs the daily signal, the trend, and the traffic that says whether it is opportunity or conversion.",
    terms: [
      "revenue down",
      "revenue is down",
      "revenue up",
      "revenue is up",
      "why is revenue",
      "sales are down",
      "sales down",
      "sales are up",
      "why are sales",
      "grand total down",
      "converting traffic",
      "are we converting",
      "not converting",
    ],
    families: ["sales-totals", "salon-performance", "bed-usage"],
  },
  {
    id: "spa_weak",
    purpose:
      "Spa underperformance. Separating an execution problem from a traffic or equipment problem needs all three spa-relevant families.",
    terms: [
      "spa is weak",
      "spa weak",
      "why is spa",
      "spa is low",
      "spa low",
      "spa is down",
      "spa down",
      "spa conversion",
      "improve spa",
      "fix spa",
    ],
    families: ["spa-engagement", "spa-wellness", "bed-usage"],
  },
  {
    id: "capital_allocation",
    purpose:
      "Where the next equipment dollar goes. The approved framework is traffic plus utilisation plus conversion plus peer performance.",
    terms: [
      "add equipment",
      "add spa",
      "more equipment",
      "new equipment",
      "another unit",
      "where should we add",
      "where do we add",
      "equipment dollar",
      "install",
      "capital",
      "expansion",
      "expand",
    ],
    families: ["bed-usage", "spa-wellness", "spa-engagement"],
  },
];

/** Escapes a term so a `.` or `+` added to a list cannot become a wildcard. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary alternation over a vocabulary, built once per list.
 *
 * Longest first, so a multi-word term is tried before the single word inside
 * it. It makes no difference to the boolean, but it keeps the pattern honest if
 * a caller ever wants to know WHICH term fired.
 */
function patternFor(terms: readonly string[]): RegExp {
  return new RegExp(
    `\\b(?:${[...terms]
      .sort((left, right) => right.length - left.length)
      .map(escape)
      .join("|")})\\b`,
    "i",
  );
}

const FAMILY_PATTERNS: Readonly<Record<ReportFamilyId, RegExp>> = Object.fromEntries(
  REPORT_FAMILY_IDS.map((id) => [id, patternFor(FAMILY_QUESTION_TERMS[id])]),
) as Record<ReportFamilyId, RegExp>;

const INTENT_PATTERNS: readonly { intent: ReportQuestionIntent; pattern: RegExp }[] =
  REPORT_QUESTION_INTENTS.map((intent) => ({
    intent,
    pattern: patternFor(intent.terms),
  }));

/** Which intents a question matched. Exported so a test can name them. */
export function matchedIntents(question: string): ReportQuestionIntent[] {
  return INTENT_PATTERNS.filter(({ pattern }) => pattern.test(question)).map(
    ({ intent }) => intent,
  );
}

/**
 * The report families this question needs, in reasoning order.
 *
 * Empty means no report figures are wanted at all — a policy question, a form
 * request, a greeting — and the caller then attaches no report block.
 *
 * READS THE QUESTION ONLY, never the conversation history. That is structural
 * rather than a convention: there is no parameter a previous turn could arrive
 * through. A manager who asked about spa conversion three turns ago and is now
 * asking about a write-up should get the write-up, and carrying families forward
 * on history would mean the briefing never leaves once it arrives. Follow-up
 * context is carried DELIBERATELY and separately, by the report context a
 * dashboard hands over — see `chat-report-context.ts`.
 */
export function routeReportFamilies(question: string): ReportFamilyId[] {
  const wanted = new Set<ReportFamilyId>();

  for (const id of REPORT_FAMILY_IDS) {
    if (FAMILY_PATTERNS[id].test(question)) wanted.add(id);
  }

  for (const intent of matchedIntents(question)) {
    for (const id of intent.families) wanted.add(id);
  }

  return orderReportFamilies([...wanted]);
}
