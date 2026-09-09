/**
 * ============================================================================
 * DOCUMENTS THAT HAVE A ROLE, NOT JUST A SIMILARITY SCORE
 * ============================================================================
 *
 * Almost every document in the knowledge base is evidence: it answers a
 * question when a manager happens to ask something it covers, and vector
 * similarity is exactly the right way to decide that.
 *
 * A few documents are not evidence. They are the REASONING a whole class of
 * question must be answered with. The Employee Performance Framework is the
 * first: it does not tell a manager what the refund window is, it tells Sunny
 * how to turn employee metrics into coaching priorities, what to recognise,
 * what to observe before documenting, and what never to escalate on a number
 * alone. A framework like that is either present for every question in its
 * class or it is not doing its job, and "did one of its eighty chunks happen to
 * land in the top fourteen" is not a sound way to decide.
 *
 * MEASURED, NOT ASSUMED. Against the live corpus (28 documents, 897 chunks,
 * gte-small), a policy-manual query returns 0 framework chunks in its top 14 —
 * and so does a query anchored in the Salon Coaching Guide, which is the
 * closest neighbour the framework has. A coaching question phrased in the
 * Coaching Guide's vocabulary can therefore retrieve no framework at all. That
 * is the failure this registry exists to remove.
 *
 * ============================================================================
 * TWO SEPARATE PROBLEMS, DELIBERATELY KEPT SEPARATE
 * ============================================================================
 *
 * 1. WHICH DOCUMENT is the framework — an identity question, answered by
 *    `resolveRoleDocument`.
 * 2. WHETHER THAT DOCUMENT STILL CONTAINS THE RULES — a content question,
 *    answered by `selectMandatoryChunks`.
 *
 * Conflating them is a real hazard. A correctly tagged document proves nothing
 * about whether a re-upload preserved the headings the extractor turns into
 * locators: re-export the same framework from a tool that demotes its SHOUTING
 * headings and the document resolves perfectly while the escalation guard
 * silently vanishes. So identity and content are checked independently, and
 * BOTH must pass before the framework counts as pinned.
 *
 * ============================================================================
 * HOW A ROLE DOCUMENT IS IDENTIFIED, AND WHY IT IS NOT AN ID
 * ============================================================================
 *
 * Four candidates, and the order matters:
 *
 *   `id` (uuid)   Stable inside ONE database and meaningless in any other. A
 *                 uuid in source would bind the build to a single Supabase
 *                 project — Preview, a rebuilt Dev, or a second brand would
 *                 silently lose the framework. Rejected.
 *
 *   `category`    Already populated (`leadership_coaching`) and NOT unique: the
 *                 Sun Tan City Salon Coaching Guide is filed under it too.
 *                 Pinning by category would pin a whole PDF manual as
 *                 mandatory reasoning. Rejected as an identifier.
 *
 *   `tags`        A `text[]` column that already exists, is editable from the
 *                 Knowledge Base screen, travels with the document, and is
 *                 EMPTY on all 28 live documents. This is the right mechanism:
 *                 the role becomes a property of the document, curated by the
 *                 people who own the corpus, with no code change to move it.
 *                 PREFERRED.
 *
 *   `filename`    Fragile — a re-upload under a tidied name breaks it. Kept as
 *                 a TEMPORARY FALLBACK only, because relying on the tag alone
 *                 would ship a feature that does nothing until somebody
 *                 remembers to tag a document, and a mandatory safety guard
 *                 that silently does nothing is worse than one that is slightly
 *                 inelegant.
 *
 * AMBIGUITY IS A FAILURE, NOT A TIE TO BREAK. Two documents carrying the role
 * tag means somebody uploaded a replacement and tagged it without untagging the
 * original, and the two will not say the same thing. Taking the first row would
 * pick by whatever order the database happened to return — so this reports
 * `ambiguous` and the caller refuses the analysis. A wrong framework applied
 * confidently is worse than an honest stop.
 */

/** Every document role this build knows about. */
export type KnowledgeDocumentRoleId =
  | "employee_performance_framework"
  | "daily_stats_interpretation_framework";

/**
 * One required group of mandatory sections.
 *
 * `headings` are alternatives for the SAME rule: a re-upload may spell the
 * heading differently, and any one of them satisfies the group.
 */
export interface MandatoryRuleGroup {
  /** Stable machine name, used in health reports and tests. */
  readonly id: string;
  /** What this group guarantees, for the operator reading a failure. */
  readonly label: string;
  /** Heading spellings that satisfy the group. Matched loosely — see `headingKey`. */
  readonly headings: readonly string[];
}

export interface KnowledgeDocumentRole {
  readonly id: KnowledgeDocumentRoleId;
  /** The durable marker. Set this on the document and the fallbacks go quiet. */
  readonly tag: string;
  /**
   * Fallback identity, used only when no document carries the tag. Matched on
   * the filename OR the title, because the title is derived from the filename
   * at upload and either may be tidied afterwards.
   */
  readonly fallbackFilenames: readonly string[];
  readonly fallbackTitles: readonly string[];
  /**
   * The REQUIRED RULE GROUPS. Every one must be represented by at least one
   * chunk or the framework is not considered pinned.
   *
   * A flat list of locators could not answer the question that actually
   * matters: not "did anything match" but "is every rule this role guarantees
   * actually present". A re-upload that lost the escalation section while
   * keeping the source hierarchy satisfied a flat list happily and pinned a
   * framework with no discipline guard — the one section whose absence is
   * dangerous rather than merely unhelpful.
   */
  readonly ruleGroups: readonly MandatoryRuleGroup[];
  /**
   * Hard ceiling on pinned chunks, whatever the headings match.
   *
   * A re-upload chunked differently — a smaller chunk size, or a heading that
   * stops being detected and swallows the rest of the document — must not turn
   * "pin the operating rules" into "pin everything". The ceiling makes the
   * prompt size a property of this file rather than of whatever was last
   * uploaded.
   */
  readonly maxMandatoryChunks: number;
}

export const EMPLOYEE_PERFORMANCE_FRAMEWORK: KnowledgeDocumentRole = {
  id: "employee_performance_framework",
  tag: "employee-performance-framework",
  fallbackFilenames: ["ASK_SUNNY_EMPLOYEE_PERFORMANCE_FRAMEWORK_KB_TEXT.txt"],
  fallbackTitles: ["ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT"],
  ruleGroups: [
    {
      id: "source_hierarchy",
      label: "the source hierarchy and operating rules",
      headings: ["SOURCE HIERARCHY AND OPERATING RULES"],
    },
    {
      id: "output_rules",
      label: "the required output shape for an employee performance report",
      headings: [
        "DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORTS",
        "DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORT",
      ],
    },
    {
      id: "escalation_guard",
      label: "the guard against discipline, EPP or DPOA on a metric alone",
      headings: [
        "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
        "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE.",
      ],
    },
    {
      id: "final_operating_rules",
      label: "the final operating rules",
      headings: [
        "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny",
        "FINAL OPERATING RULES FOR ASK SUNNY",
      ],
    },
    {
      id: "interpretation_model",
      label: "the final interpretation model",
      headings: ["FINAL INTERPRETATION MODEL"],
    },
  ],
  maxMandatoryChunks: 14,
};

/**
 * ============================================================================
 * THE DAILY STATS INTERPRETATION FRAMEWORK
 * ============================================================================
 *
 * The second role, and the one that decides whether Ask Sunny answers "what
 * should I focus on today?" like a district manager or like a spreadsheet.
 *
 * WHAT IT IS. A reasoning model for turning report metrics into a manager's
 * day: metric signal, business meaning, likely behaviour, coaching focus,
 * role-play, manager inspection, follow-up, recognition. Its own operating
 * rules say it first — "interpret numbers as behavior signals", "do not simply
 * identify the lowest metric", "always convert data into manager action",
 * "praise strong behaviors".
 *
 * WHY IT CANNOT BE LEFT TO SIMILARITY. It is the same failure the Employee
 * Performance Framework has, one step worse. "What should I focus on today?"
 * contains no vocabulary from this document at all — no metric name, no
 * coaching word, nothing a vector index can match on — so the question the
 * framework exists to answer is precisely the question least likely to retrieve
 * it. Meanwhile a question that DOES name a metric retrieves the framework's
 * own metric glossary, which is the part that matters least.
 *
 * WHAT IS PINNED, AND WHY NOT MORE. The document is 59 chunks. Four sections
 * are the reasoning contract:
 *
 *   the OPERATING RULES        the source hierarchy and the eight rules
 *   the PRIORITY DECISION TREE why the lowest metric is not the top priority
 *   the OUTPUT TEMPLATES       the required answer shape
 *   the COACHING FORM DRAFT    the response quality checklist lives here, and
 *                              it is also the section that hands off to a
 *                              coaching form
 *
 * Everything else — the metric definitions, the translation guide, the
 * recommendation library — is question-dependent detail, and question-dependent
 * detail is what retrieval is for.
 *
 * THE HEADINGS ARE THE DOCUMENT'S OWN WORD HEADINGS, verified against the
 * supplied .docx: the extractor splits on `<h1>`-`<h6>` and these are the exact
 * heading texts it produces. Matched through `headingKey`, so dash, numbering,
 * casing, punctuation and spacing drift from a re-export still resolves.
 *
 * EVERY GROUP IS REQUIRED, for the reason the employee framework's are: the
 * question that matters is not "did anything match" but "is every rule this
 * role guarantees actually present".
 *
 * ITS EXAMPLES ARE NOT FACTS. The document says so itself — "do not preserve or
 * repeat historical salon names, employee names, client names, dates, customer
 * numbers, emails, or one-time report values from training examples" — and the
 * system prompt repeats it, because a framework full of worked examples with
 * numbers in them is the one legitimate route by which a stale figure could
 * reach an answer looking like a measurement.
 */
export const DAILY_STATS_INTERPRETATION_FRAMEWORK: KnowledgeDocumentRole = {
  id: "daily_stats_interpretation_framework",
  tag: "daily-stats-interpretation-framework",
  fallbackFilenames: [
    "ASK_SUNNY_DAILY_STATS_INTERPRETATION_FRAMEWORK.docx",
    "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK.docx",
  ],
  fallbackTitles: [
    "ASK SUNNY DAILY STATS INTERPRETATION FRAMEWORK",
    "ASK SUNNY Daily Stats Interpretation Framework",
    "Daily Stats Interpretation Framework",
  ],
  /*
   * THE FOUR RULE GROUPS, each REQUIRED. A re-upload that lost the priority
   * decision tree while keeping the operating rules would satisfy a flat list
   * of headings happily and pin a framework with no prioritisation contract —
   * which is the section that stops the answer being a sorted list of the
   * lowest numbers.
   *
   * The headings are the document's own, verified against the supplied .docx
   * through the same extractor the ingestion pipeline uses. Alternatives are
   * listed per group because a re-export from another tool spells them
   * differently — an en dash for the hyphen, a dropped number, different
   * casing — and `headingKey` absorbs the rest of that drift.
   */
  ruleGroups: [
    {
      id: "operating_rules",
      label: "the operating rules and the source hierarchy for Daily Stats",
      headings: [
        "ASK SUNNY OPERATING RULES FOR DAILY STATS",
        "OPERATING RULES FOR DAILY STATS",
        "ASK SUNNY OPERATING RULES",
      ],
    },
    {
      id: "priority_decision_tree",
      label: "the priority decision tree — why the lowest metric is not the top priority",
      headings: [
        "SECTION 4 - PRIORITY DECISION TREE",
        "SECTION 4 – PRIORITY DECISION TREE",
        "PRIORITY DECISION TREE",
      ],
    },
    {
      id: "output_templates",
      label: "the required answer shape for a Daily Stats reading",
      headings: [
        "SECTION 8 - OUTPUT TEMPLATES",
        "SECTION 8 – OUTPUT TEMPLATES",
        "OUTPUT TEMPLATES",
      ],
    },
    {
      /*
       * The response quality checklist lives in this section's body rather than
       * under a heading of its own, and it is also where the document hands off
       * to a coaching form — which is the handoff Ask Sunny performs through
       * the published Coaching template.
       */
      id: "coaching_handoff",
      label: "the coaching form handoff and the response quality checklist",
      headings: ["Coaching Form Draft", "Coaching Form"],
    },
  ],
  /*
   * Ten, against the eight chunks those four groups hold today. Headroom for a
   * re-export that chunks slightly differently, and a ceiling that keeps the
   * prompt size a property of THIS FILE rather than of whatever was last
   * uploaded. Applied round-robin across the groups, so a group with twenty
   * chunks cannot crowd out a group with one and leave the set looking
   * complete.
   */
  maxMandatoryChunks: 10,
};

export const KNOWLEDGE_DOCUMENT_ROLES: readonly KnowledgeDocumentRole[] = [
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
  DAILY_STATS_INTERPRETATION_FRAMEWORK,
];

/** The subset of a document row this module needs. Structural, so callers need not map. */
export interface RoleCandidateDocument {
  readonly id: string;
  readonly title: string;
  readonly original_filename: string;
  readonly tags: readonly string[] | null;
}

function normalize(value: string): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A heading reduced to what it MEANS, so harmless formatting drift matches.
 *
 * Every one of these is a difference a re-export produces without changing a
 * word of the rule:
 *
 *   dashes      an en-dash, em-dash, minus sign or double hyphen for `-`. The
 *               live headings use an EN-DASH ("SECTION 10 – FINAL…"), which is
 *               already not what a keyboard types.
 *   numbering   "SECTION 10 –" prefixes. A renumbered or unnumbered re-export
 *               is the same rule, so the prefix is dropped entirely.
 *   punctuation trailing full stops and colons, smart quotes, stray `#` from a
 *               Markdown export.
 *   case        SHOUTING, Title Case, sentence case.
 *   spacing     the double and triple spaces PDF and DOCX extraction leave.
 *
 * What it does NOT do is fuzzy-match words. "FINAL INTERPRETATION MODEL" and
 * "FINAL OPERATING RULES" stay distinct, because collapsing those would let a
 * document satisfy a group it does not contain — which is the failure the whole
 * health check exists to catch.
 */
export function headingKey(heading: string): string {
  return (heading ?? "")
    .replace(/[‐-―−]/g, "-")
    .replace(/--+/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/^\s*#+\s*/, "")
    .replace(/^\s*(?:section|part|appendix)\s+[0-9ivxlc]+\s*[-:.)]?\s*/i, "")
    .replace(/[.:;,!?]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the document carries the role's durable tag. */
export function hasRoleTag(document: RoleCandidateDocument, role: KnowledgeDocumentRole): boolean {
  const wanted = normalize(role.tag);
  return (document.tags ?? []).some((tag) => normalize(tag) === wanted);
}

/** True when the document matches the role's fallback filename or title. */
export function matchesRoleFallback(
  document: RoleCandidateDocument,
  role: KnowledgeDocumentRole,
): boolean {
  const filename = normalize(document.original_filename);
  const title = normalize(document.title);
  return (
    role.fallbackFilenames.some((candidate) => normalize(candidate) === filename) ||
    role.fallbackTitles.some((candidate) => normalize(candidate) === title)
  );
}

/** Why a role document could not be settled on. */
export type RoleResolutionProblem = "not_found" | "ambiguous";

export type RoleResolution =
  | {
      readonly ok: true;
      readonly document: RoleCandidateDocument;
      /** Which identity path matched. Reported so the operator can see it. */
      readonly matchedBy: "tag" | "fallback";
    }
  | {
      readonly ok: false;
      readonly problem: RoleResolutionProblem;
      /** The documents that tied, for the operator. Empty for `not_found`. */
      readonly candidates: readonly RoleCandidateDocument[];
    };

/**
 * The one place a role document is chosen.
 *
 * TAG WINS OUTRIGHT. If any document carries the tag, the fallback is not
 * consulted at all — otherwise tagging a replacement would leave the old
 * filename still winning, which is the opposite of what tagging is for. A
 * tagged replacement therefore beats an untagged original even when the
 * original still matches the fallback filename.
 *
 * MORE THAN ONE MATCH IS AMBIGUOUS, at either level. Two tagged documents, or
 * two documents matching the fallback with none tagged, means the corpus cannot
 * say which framework is in force. The caller refuses rather than picking by
 * database row order.
 */
export function resolveRoleDocument(
  documents: readonly RoleCandidateDocument[],
  role: KnowledgeDocumentRole,
): RoleResolution {
  const tagged = documents.filter((document) => hasRoleTag(document, role));
  if (tagged.length === 1) {
    return { ok: true, document: tagged[0]!, matchedBy: "tag" };
  }
  if (tagged.length > 1) {
    return { ok: false, problem: "ambiguous", candidates: tagged };
  }

  const fallback = documents.filter((document) => matchesRoleFallback(document, role));
  if (fallback.length === 1) {
    return { ok: true, document: fallback[0]!, matchedBy: "fallback" };
  }
  if (fallback.length > 1) {
    return { ok: false, problem: "ambiguous", candidates: fallback };
  }

  return { ok: false, problem: "not_found", candidates: [] };
}

/** Operator-facing advice when a role resolved by its fragile fallback. */
export function roleTagAdvice(role: KnowledgeDocumentRole): string {
  return `Tag this document "${role.tag}" in the Knowledge Base so its role survives a rename or re-upload.`;
}

/** The subset of a chunk row needed to choose the mandatory set. */
export interface RoleCandidateChunk {
  readonly chunk_index: number;
  readonly locator: string;
}

/** A chunk row carrying everything a grounding row and a citation need. */
export interface RoleGroundingChunk extends RoleCandidateChunk {
  readonly id: string;
  readonly page: number | null;
  readonly section: string | null;
  readonly content: string;
}

/** The document fields a pinned row's provenance is built from. */
export interface RoleGroundingDocument {
  readonly id: string;
  readonly title: string;
  readonly category: string;
}

/**
 * A pinned chunk, shaped exactly like a vector-retrieved one.
 *
 * THIS IS WHERE PROVENANCE IS EITHER KEPT OR LOST, which is why it is a
 * separate function rather than an object literal inside the provider: every
 * identifying field comes from the DATABASE ROWS passed in, and there is no
 * parameter here a caller could use to supply a title or an id of its own
 * invention. `rowToCitation` then turns it into a source card that opens the
 * real Knowledge Base document.
 *
 * `similarity` is 0 because it was never measured — inclusion did not depend on
 * it. A high number here would put fabricated confidence on a source card.
 */
export function toRoleGroundingRow(
  document: RoleGroundingDocument,
  chunk: RoleGroundingChunk,
): {
  chunk_id: string;
  document_id: string;
  document_title: string;
  category: string;
  locator: string;
  page: number | null;
  section: string | null;
  content: string;
  similarity: number;
} {
  return {
    chunk_id: chunk.id,
    document_id: document.id,
    document_title: document.title,
    category: document.category,
    locator: chunk.locator,
    page: chunk.page,
    section: chunk.section,
    content: chunk.content,
    similarity: 0,
  };
}

export interface MandatorySelection<T extends RoleCandidateChunk> {
  /** The chunks to pin, in the document's own order, capped by the role. */
  readonly chunks: T[];
  /** Rule group ids represented by at least one chunk. */
  readonly presentGroups: string[];
  /** Rule group ids with no chunk at all. Non-empty means UNSAFE to pin. */
  readonly missingGroups: string[];
  /** True only when every required group is represented. */
  readonly complete: boolean;
}

/**
 * The mandatory chunks, checked group by group.
 *
 * DOCUMENT ORDER, NOT GROUP ORDER. The framework's rules read as a sequence —
 * the source hierarchy before the output rule before the escalation limits —
 * and re-ordering them by which group was declared first in this file would
 * hand the model the same sentences in an order their author did not write.
 *
 * THE CEILING IS APPLIED FAIRLY. Truncating the tail would silently drop
 * whichever group happens to sit last in the document — the interpretation
 * model, today — and report the set as complete. So when the matches exceed the
 * ceiling, each group keeps at least one chunk before any group gets a second,
 * and completeness is judged on what SURVIVES the cap rather than on what
 * matched before it.
 */
export function selectMandatoryChunks<T extends RoleCandidateChunk>(
  chunks: readonly T[],
  role: KnowledgeDocumentRole,
): MandatorySelection<T> {
  const groupOf = new Map<string, string>();
  for (const group of role.ruleGroups) {
    for (const heading of group.headings) groupOf.set(headingKey(heading), group.id);
  }

  /** Matching chunks per group, each in document order. */
  const byGroup = new Map<string, T[]>();
  const ordered = [...chunks].sort((left, right) => left.chunk_index - right.chunk_index);

  for (const chunk of ordered) {
    const groupId = groupOf.get(headingKey(chunk.locator));
    if (!groupId) continue;
    const bucket = byGroup.get(groupId);
    if (bucket) bucket.push(chunk);
    else byGroup.set(groupId, [chunk]);
  }

  /*
   * ROUND-ROBIN UNDER THE CEILING: one chunk from each group that has any, then
   * a second from each, and so on. Every represented group therefore survives
   * the cap, and a group with many chunks cannot crowd out a group with one.
   */
  const picked = new Set<T>();
  const groupIds = role.ruleGroups.map((group) => group.id);
  const deepest = Math.max(0, ...groupIds.map((id) => byGroup.get(id)?.length ?? 0));

  for (let round = 0; round < deepest && picked.size < role.maxMandatoryChunks; round += 1) {
    for (const groupId of groupIds) {
      if (picked.size >= role.maxMandatoryChunks) break;
      const chunk = byGroup.get(groupId)?.[round];
      if (chunk) picked.add(chunk);
    }
  }

  const selected = ordered.filter((chunk) => picked.has(chunk));
  const survived = new Set<string>();
  for (const chunk of selected) {
    const groupId = groupOf.get(headingKey(chunk.locator));
    if (groupId) survived.add(groupId);
  }

  const presentGroups = groupIds.filter((id) => survived.has(id));
  const missingGroups = groupIds.filter((id) => !survived.has(id));

  return {
    chunks: selected,
    presentGroups,
    missingGroups,
    complete: missingGroups.length === 0 && selected.length > 0,
  };
}

/** Human-readable list of the rules a failed selection could not guarantee. */
export function missingGroupLabels(
  role: KnowledgeDocumentRole,
  missingGroups: readonly string[],
): string[] {
  return role.ruleGroups
    .filter((group) => missingGroups.includes(group.id))
    .map((group) => group.label);
}
