import type { MatchedChunkRow } from "./mappers";
import {
  missingGroupLabels,
  resolveRoleDocument,
  selectMandatoryChunks,
  toRoleGroundingRow,
  type KnowledgeDocumentRole,
  type RoleCandidateDocument,
  type RoleGroundingChunk,
  type RoleGroundingDocument,
} from "./document-roles";

/**
 * ============================================================================
 * MANDATORY GROUNDING EITHER SUCCEEDS OR IT FAILS OUT LOUD
 * ============================================================================
 *
 * This module exists because the first version of this feature returned
 * `RoleGrounding | null` and the caller wrote `.catch(() => null)`. Both halves
 * of that were wrong in the same way: they made "the framework is missing"
 * indistinguishable from "no framework was wanted", so an employee-performance
 * question whose framework could not be read carried on to Claude as an
 * ORDINARY question — with the escalation guard absent and nothing anywhere
 * saying so. A guard that disappears silently under failure is not a guard.
 *
 * So the result is a discriminated union with a REASON, and the caller has to
 * look at it. There is no null to swallow and no exception to catch into one.
 *
 * WHY THE PURE FUNCTION IS HERE AND THE I/O IS IN THE PROVIDER: every decision
 * — which document, which chunks, whether the rule groups are complete — is
 * testable against real row shapes with no database and no mocks. The provider
 * is left doing two queries and translating their failures.
 */

/** What a resolved, healthy role contributes to one turn. */
export interface RoleGrounding {
  readonly role: KnowledgeDocumentRole;
  readonly documentId: string;
  readonly documentTitle: string;
  /** `tag` once the durable marker is set; `fallback` until then. */
  readonly matchedBy: "tag" | "fallback";
  /** The pinned rows, in document order, shaped exactly like retrieved rows. */
  readonly rows: MatchedChunkRow[];
  /** Rule group ids actually represented. Every required one, or this is a failure. */
  readonly presentGroups: readonly string[];
}

/**
 * Every way mandatory grounding can fail. All six are refusals, not warnings.
 *
 * Named for the operator rather than the stack: a failure reaches a log and a
 * health check, never a manager's screen, and never carries a database message.
 */
export type RoleGroundingFailureCode =
  /** No document in the corpus carries the tag or matches the fallback. */
  | "role_document_not_found"
  /** More than one document claims the role. Configuration, not a tie. */
  | "role_document_ambiguous"
  /** The document lookup itself failed. */
  | "role_document_query_failed"
  /** The chunk lookup failed. */
  | "role_chunk_query_failed"
  /** The document resolved but no heading matched any rule group. */
  | "no_mandatory_chunks"
  /** Some rule groups matched and at least one required group did not. */
  | "incomplete_rule_groups";

export interface RoleGroundingFailure {
  readonly code: RoleGroundingFailureCode;
  /**
   * Operator-facing explanation. Safe to log.
   *
   * NEVER a database error string, a connection detail or a query. A retrieval
   * error can carry the payload it was sent, and the payload is the manager's
   * question plus company policy text.
   */
  readonly detail: string;
  /** Which required rules could not be guaranteed, when that is the problem. */
  readonly missingGroups?: readonly string[];
}

export type RoleGroundingResult =
  | { readonly ok: true; readonly grounding: RoleGrounding }
  | { readonly ok: false; readonly failure: RoleGroundingFailure };

/**
 * THE MESSAGE A MANAGER SEES when the framework cannot be guaranteed.
 *
 * It says what is unavailable and what Sunny is therefore declining to do, and
 * it does not pretend the question was unanswerable for some other reason. It
 * carries no failure code, no document id and no database detail — a manager
 * cannot act on any of those, and the corpus's internal state is not theirs to
 * debug.
 */
export const FRAMEWORK_UNAVAILABLE_MESSAGE =
  "The Employee Performance Framework required for this analysis is currently unavailable, so I can't safely rank or recommend coaching or escalation actions yet. Nothing was answered from memory. Ask an administrator to check that the framework document is present and indexed in the Knowledge Base, then try again.";

/**
 * The same refusal for the PERFORMANCE MANAGEMENT FRAMEWORK.
 *
 * A message of its own rather than a shared one, because the two frameworks
 * govern different things and a manager needs to know which document to chase.
 * It also has to be specific about what is being declined: not "ranking or
 * escalation actions" — this framework's absence means the SEQUENCE cannot be
 * stated, and a plausible general-HR progression offered in its place is the
 * failure being refused.
 *
 * What Sunny can still do is said out loud, because the refusal is otherwise
 * indistinguishable from being broken: the Forms library is a different source
 * and is unaffected, so naming the forms and creating one both still work.
 */
export const PERFORMANCE_MANAGEMENT_FRAMEWORK_UNAVAILABLE_MESSAGE =
  "The Performance Management Framework that defines our corrective-action progression is currently unavailable, so I won't set out the steps or tell you which one applies — a plausible-sounding sequence that is not Sun Tan City's is the wrong thing to act on, and nothing was answered from memory. Ask an administrator to check that the framework document is present and indexed in the Knowledge Base. I can still tell you which forms exist and create one for you if you know which you need.";

/**
 * Turns a resolved document and its chunks into grounding, or into a reason.
 *
 * The order of checks is the order of severity, so the reported failure is the
 * most specific true thing: identity before content, and "nothing matched"
 * before "not everything matched".
 */
export function buildRoleGrounding(input: {
  readonly role: KnowledgeDocumentRole;
  readonly document: RoleGroundingDocument;
  readonly matchedBy: "tag" | "fallback";
  readonly chunks: readonly RoleGroundingChunk[];
}): RoleGroundingResult {
  const selection = selectMandatoryChunks(input.chunks, input.role);

  if (selection.chunks.length === 0) {
    return {
      ok: false,
      failure: {
        code: "no_mandatory_chunks",
        detail: `"${input.document.title}" resolved as the ${input.role.id} document but none of its section headings matched a required rule group. The document was probably re-uploaded from a tool that did not preserve its headings.`,
        missingGroups: selection.missingGroups,
      },
    };
  }

  if (!selection.complete) {
    return {
      ok: false,
      failure: {
        code: "incomplete_rule_groups",
        detail: `"${input.document.title}" is missing ${missingGroupLabels(
          input.role,
          selection.missingGroups,
        ).join(", ")}.`,
        missingGroups: selection.missingGroups,
      },
    };
  }

  return {
    ok: true,
    grounding: {
      role: input.role,
      documentId: input.document.id,
      documentTitle: input.document.title,
      matchedBy: input.matchedBy,
      rows: selection.chunks.map((chunk) => toRoleGroundingRow(input.document, chunk)),
      presentGroups: selection.presentGroups,
    },
  };
}

/** Translates a document-identity outcome into a grounding failure. */
export function roleIdentityFailure(
  role: KnowledgeDocumentRole,
  problem: "not_found" | "ambiguous",
  candidates: readonly RoleCandidateDocument[],
): RoleGroundingFailure {
  if (problem === "ambiguous") {
    return {
      code: "role_document_ambiguous",
      detail: `${candidates.length} indexed documents claim the ${role.id} role (${candidates
        .map((candidate) => `"${candidate.title}"`)
        .join(", ")}). Exactly one must carry the "${role.tag}" tag.`,
    };
  }
  return {
    code: "role_document_not_found",
    detail: `No indexed document carries the "${role.tag}" tag or matches the ${role.id} fallback identity.`,
  };
}

/**
 * Resolves identity and content in one call, from rows already read.
 *
 * `chunksFor` is a callback rather than a chunk list because the chunks to read
 * depend on which document won, and reading every document's chunks to answer
 * one question would be wasteful. It may throw; the caller decides what a query
 * failure means.
 */
export function evaluateRoleGrounding(input: {
  readonly role: KnowledgeDocumentRole;
  readonly documents: readonly (RoleCandidateDocument & RoleGroundingDocument)[];
  readonly chunksFor: (
    document: RoleCandidateDocument & RoleGroundingDocument,
  ) => readonly RoleGroundingChunk[];
}): RoleGroundingResult {
  const resolution = resolveRoleDocument(input.documents, input.role);
  if (!resolution.ok) {
    return {
      ok: false,
      failure: roleIdentityFailure(input.role, resolution.problem, resolution.candidates),
    };
  }

  const document = resolution.document as RoleCandidateDocument & RoleGroundingDocument;

  return buildRoleGrounding({
    role: input.role,
    document,
    matchedBy: resolution.matchedBy,
    chunks: input.chunksFor(document),
  });
}
