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
 *                 a FALLBACK only, because relying on the tag alone would ship
 *                 a feature that does nothing until somebody remembers to tag a
 *                 document, and a mandatory safety guard that silently does
 *                 nothing is worse than one that is slightly inelegant.
 *
 * So: tag first, filename fallback, and `roleTagAdvice()` tells the operator how
 * to make the durable marker true. Both paths resolve through ONE function, so
 * when the tag is set the fallback stops mattering without anything else moving.
 */

/** Every document role this build knows about. */
export type KnowledgeDocumentRoleId = "employee_performance_framework";

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
   * The sections that are mandatory whenever this role applies, by the
   * `locator` the extractor derived from the document's own headings.
   *
   * NOT THE WHOLE DOCUMENT. The framework is 80 chunks and roughly 70,000
   * characters; pinning all of it would put ~18,000 tokens in front of every
   * coaching question and leave the model reading metric glossaries it was not
   * asked about. What has to be present unconditionally is the reasoning
   * contract and the safety guards — the operating rules, the required output
   * shape, the escalation limits and the closing interpretation model. Anything
   * more specific is a question-dependent detail, and question-dependent detail
   * is what retrieval is for.
   *
   * Matched case-insensitively and whitespace-normalised, so a re-export whose
   * heading spacing differs still resolves.
   */
  readonly mandatoryLocators: readonly string[];
  /**
   * Hard ceiling on pinned chunks, whatever the locators match.
   *
   * A re-upload chunked differently — a smaller chunk size, a heading that
   * stops being detected as a heading and swallows the rest of the document —
   * must not be able to turn "pin the operating rules" into "pin everything".
   * The ceiling is what makes the prompt size a property of this file rather
   * than of whatever was last uploaded.
   */
  readonly maxMandatoryChunks: number;
}

export const EMPLOYEE_PERFORMANCE_FRAMEWORK: KnowledgeDocumentRole = {
  id: "employee_performance_framework",
  tag: "employee-performance-framework",
  fallbackFilenames: ["ASK_SUNNY_EMPLOYEE_PERFORMANCE_FRAMEWORK_KB_TEXT.txt"],
  fallbackTitles: ["ASK SUNNY EMPLOYEE PERFORMANCE FRAMEWORK KB TEXT"],
  mandatoryLocators: [
    "SOURCE HIERARCHY AND OPERATING RULES",
    "DEFAULT OUTPUT RULE FOR EMPLOYEE PERFORMANCE REPORTS",
    "NEVER RECOMMEND DISCIPLINE BASED ON METRICS ALONE",
    "SECTION 10 – FINAL OPERATING RULES FOR ASK Sunny",
    "FINAL INTERPRETATION MODEL",
  ],
  maxMandatoryChunks: 14,
};

export const KNOWLEDGE_DOCUMENT_ROLES: readonly KnowledgeDocumentRole[] = [
  EMPLOYEE_PERFORMANCE_FRAMEWORK,
];

/** The subset of a document row this module needs. Structural, so callers need not map. */
export interface RoleCandidateDocument {
  readonly id: string;
  readonly title: string;
  readonly original_filename: string;
  readonly tags: readonly string[] | null;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
  const filename = normalize(document.original_filename ?? "");
  const title = normalize(document.title ?? "");
  return (
    role.fallbackFilenames.some((candidate) => normalize(candidate) === filename) ||
    role.fallbackTitles.some((candidate) => normalize(candidate) === title)
  );
}

export interface ResolvedRoleDocument {
  readonly document: RoleCandidateDocument;
  /** Which identity path matched. Reported so the operator can see it. */
  readonly matchedBy: "tag" | "fallback";
}

/**
 * The one place a role document is chosen.
 *
 * TAG WINS OUTRIGHT. If any document carries the tag, the fallback is not
 * consulted at all — otherwise tagging a replacement would leave the old
 * filename still winning, which is the opposite of what tagging is for.
 *
 * A tie is resolved by taking the first match in the order given, which for the
 * provider is the database's own ordering. Two documents claiming one role is a
 * corpus problem to report, not something to guess at.
 */
export function resolveRoleDocument(
  documents: readonly RoleCandidateDocument[],
  role: KnowledgeDocumentRole,
): ResolvedRoleDocument | null {
  const tagged = documents.find((document) => hasRoleTag(document, role));
  if (tagged) return { document: tagged, matchedBy: "tag" };

  const fallback = documents.find((document) => matchesRoleFallback(document, role));
  if (fallback) return { document: fallback, matchedBy: "fallback" };

  return null;
}

/** Operator-facing advice when a role resolved by its fragile fallback. */
export function roleTagAdvice(role: KnowledgeDocumentRole): string {
  return `Tag this document "${role.tag}" in the Knowledge Base so its role survives a rename or re-upload.`;
}

/** The subset of a chunk row this module needs to choose the mandatory set. */
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

/**
 * The mandatory chunks, in the document's own order, capped by the role.
 *
 * DOCUMENT ORDER, NOT LOCATOR ORDER. The framework's rules read as a sequence —
 * the source hierarchy before the output rule before the escalation limits —
 * and re-ordering them by which heading was listed first in this file would
 * hand the model the same sentences in an order their author did not write.
 */
export function selectMandatoryChunks<T extends RoleCandidateChunk>(
  chunks: readonly T[],
  role: KnowledgeDocumentRole,
): T[] {
  const wanted = new Set(role.mandatoryLocators.map(normalize));
  return chunks
    .filter((chunk) => wanted.has(normalize(chunk.locator ?? "")))
    .slice()
    .sort((left, right) => left.chunk_index - right.chunk_index)
    .slice(0, role.maxMandatoryChunks);
}
