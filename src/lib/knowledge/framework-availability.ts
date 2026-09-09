import "server-only";

import type { KnowledgeDocumentRole } from "./document-roles";
import type { RoleGroundingResult } from "./role-grounding";

/**
 * ============================================================================
 * "DID THE FRAMEWORK ANSWER?" AS A BOOLEAN, AND WHY IT LIVES IN ITS OWN FILE
 * ============================================================================
 *
 * Some answers assert something the framework defines. The corrective-action
 * reply sets out the approved progression; the drafting prompt hands the model
 * the escalation ladder. Those claims are only as good as the document, so the
 * code that makes them has to know whether the document answered.
 *
 * That is a different question from the one `fetchRoleGrounding` is usually
 * asked. On a MANDATORY path the caller wants the rows or a refusal, and a
 * failure must propagate — `server-ask.ts` carries a structural test asserting
 * it contains no error-swallowing at all, because a fail-open catch around the
 * mandatory grounding fetch was the exact bug that remediation existed to fix.
 *
 * SO THE SWALLOW LIVES HERE INSTEAD, once, named, and explained:
 *
 *   ON A MANDATORY PATH   a retrieval failure must reach the caller, which
 *                         refuses. Nothing in this file is used there.
 *
 *   ON AN ASSERTION PATH  the only question is "may I state this?", and every
 *                         way of failing to read the document has the same
 *                         answer: no. An outage, a missing document and two
 *                         documents claiming the role are indistinguishable
 *                         from the point of view of a claim that must not be
 *                         made — so they collapse into `false`.
 *
 * FAIL-CLOSED, NOT FAIL-OPEN. `false` means the claim is withheld, so a broken
 * query makes Ask Sunny say less rather than more. That is the opposite of the
 * catch this file exists to keep out of the mandatory path.
 */

/** The narrow slice of a knowledge provider this probe needs. */
export interface RoleGroundingSource {
  fetchRoleGrounding(
    role: KnowledgeDocumentRole,
    scopeId: string,
  ): Promise<RoleGroundingResult>;
}

/**
 * Whether a role's document resolved healthy, as a plain boolean.
 *
 * @returns `true` only when the grounding came back `ok`. Every failure — a
 *   refusal, a thrown query, a rejected promise — is `false`.
 */
export async function isFrameworkAvailable(
  source: RoleGroundingSource,
  role: KnowledgeDocumentRole,
  scopeId: string,
): Promise<boolean> {
  try {
    const result = await source.fetchRoleGrounding(role, scopeId);
    return result.ok === true;
  } catch {
    /*
     * DELIBERATELY SILENT, and correct because of what the return value means.
     * The caller is deciding whether it may assert something; it cannot, and
     * there is nothing further it needs to know. The operational question —
     * WHY the framework is unavailable — is `checkFrameworkReadiness`'s, which
     * reports every cause with a problem string an operator can act on.
     */
    return false;
  }
}
