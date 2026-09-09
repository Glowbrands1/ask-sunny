import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

/**
 * ============================================================================
 * PUTTING THE GROUNDING SET TOGETHER
 * ============================================================================
 *
 * Two sources of company knowledge now reach one prompt:
 *
 *   RETRIEVED   what vector similarity says is relevant to this question.
 *   MANDATORY   the chunks a document's ROLE says must be present for this
 *               class of question, whatever similarity thinks.
 *
 * This module merges them. It is pure — rows in, rows out — so the ordering,
 * the de-duplication and the budgets are testable without a database, and so
 * `server-ask.ts` keeps doing one thing: orchestrating.
 *
 * The rows it returns are the rows the markers and the citations are built
 * from, which is why nothing here invents, edits or reorders a row's CONTENT.
 * A pinned chunk is a real `knowledge_chunks` row read from the database, so it
 * reaches `rowToCitation` carrying its own document id, title and locator, and
 * a manager clicking the source card lands on the real Knowledge Base document.
 *
 * ============================================================================
 * THREE DECISIONS WORTH THE WORDS
 * ============================================================================
 *
 * 1. MANDATORY CHUNKS COME FIRST. They are the reasoning contract — the source
 *    hierarchy, the required output shape, the escalation limits. Reading the
 *    rules before the evidence is the order their author wrote them in, and it
 *    is the order a manager would brief someone in.
 *
 * 2. MANDATORY CHUNKS DO NOT SPEND THE EVIDENCE BUDGET. They get their own,
 *    additive to it. Sharing one budget would have made this change actively
 *    harmful: eleven pinned framework chunks out of twelve slots would have
 *    left ONE for every policy manual in the corpus, so "policy outranks the
 *    framework" would have been a rule with nothing to apply it to.
 *
 * 3. WHEN THE ROLE IS PINNED, RETRIEVAL STOPS RETURNING THAT DOCUMENT. This is
 *    the counter-intuitive one, and it is the finding that motivated it:
 *    measured against the live corpus, a query anchored anywhere in the
 *    Employee Performance Framework fills 13 or 14 of the top 14 with more
 *    framework — the document has 80 chunks that sit between 0.91 and 0.95 of
 *    each other, so it out-competes every manual in the corpus on its own
 *    topics. Left alone, the prompt would be the framework twice over and no
 *    policy at all. Excluding it from the retrieved half costs nothing, because
 *    the part that has to be there is already there, and it hands those slots
 *    to the manuals.
 *
 *    Guarded, though: the exclusion applies ONLY when something was actually
 *    pinned. If the locators matched nothing — a re-upload chunked differently,
 *    a heading that stopped being recognised — dropping the retrieved framework
 *    rows as well would remove the framework from the answer entirely, which is
 *    the exact failure this feature exists to prevent.
 */

export interface AssembleGroundingInput {
  /** Pinned rows, already in document order. */
  readonly mandatory: readonly MatchedChunkRow[];
  /** Vector-retrieved rows, best first. */
  readonly retrieved: readonly MatchedChunkRow[];
  /**
   * The documents whose chunks were pinned, so retrieval can stop repeating
   * them. Empty when no role applied to this question.
   *
   * A LIST BECAUSE TWO ROLES CAN APPLY AT ONCE, and the question that makes
   * that ordinary is "what should I coach today": it is a daily operational
   * question AND an employee-performance question, so the Daily Stats
   * Interpretation Framework and the Employee Performance Framework are both
   * mandatory. This was a single id, and with two roles pinned it would have
   * suppressed retrieval of one of them while letting the other flood the
   * retrieved half — the exact failure decision 3 below exists to prevent, half
   * applied.
   */
  readonly roleDocumentIds: readonly string[];
  /** How many RETRIEVED rows may reach the prompt. Mandatory rows are extra. */
  readonly evidenceBudget: number;
}

export interface AssembledGrounding {
  /** The final ordered rows: markers and citations derive from these. */
  readonly rows: MatchedChunkRow[];
  readonly mandatoryCount: number;
  readonly retrievedCount: number;
  /** Whether ANY role document reached the prompt as mandatory grounding. */
  readonly roleIncluded: boolean;
  /** Which documents contributed pinned rows, so a caller can report per role. */
  readonly pinnedDocumentIds: readonly string[];
}

export function assembleGrounding(input: AssembleGroundingInput): AssembledGrounding {
  const seen = new Set<string>();
  const mandatory: MatchedChunkRow[] = [];

  for (const row of input.mandatory) {
    if (seen.has(row.chunk_id)) continue;
    seen.add(row.chunk_id);
    mandatory.push(row);
  }

  /*
   * Only documents that ACTUALLY CONTRIBUTED a pinned row are excluded from the
   * retrieved half. A role whose locators matched nothing — a re-upload chunked
   * differently, a heading that stopped being recognised — must keep its
   * retrieved rows, or the framework leaves the answer entirely, which is the
   * failure this feature exists to prevent. With two roles that has to be
   * decided per document rather than by one "was anything pinned" flag.
   */
  const pinnedDocuments = new Set(mandatory.map((row) => row.document_id));
  const suppressed = new Set(
    input.roleDocumentIds.filter((id) => pinnedDocuments.has(id)),
  );
  const retrieved: MatchedChunkRow[] = [];

  for (const row of input.retrieved) {
    if (retrieved.length >= input.evidenceBudget) break;
    // Already pinned above: one chunk must not occupy two markers, or the model
    // is told the same rule twice under different numbers.
    if (seen.has(row.chunk_id)) continue;
    if (suppressed.has(row.document_id)) continue;
    seen.add(row.chunk_id);
    retrieved.push(row);
  }

  return {
    rows: [...mandatory, ...retrieved],
    mandatoryCount: mandatory.length,
    retrievedCount: retrieved.length,
    roleIncluded: mandatory.length > 0,
    pinnedDocumentIds: [...pinnedDocuments],
  };
}
