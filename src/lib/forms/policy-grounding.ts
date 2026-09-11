import "server-only";

import { getKnowledgeProvider } from "@/lib/knowledge";
import { ACTIVE_BRAND } from "@/lib/brand";
import type { SearchResult } from "@/types";

import type { FormField } from "./document";

/**
 * POLICY-GROUNDED FIELDS FAIL CLOSED.
 *
 * The Disciplinary Plan of Action and the Policy Review both ask which policy
 * was breached and then quote the manual's own words. Those are the two fields
 * on any of these forms that a person may later have to defend, so they get a
 * different rule from everything else the assistant drafts:
 *
 *   A grounded field is offered to the model ONLY with retrieved policy text,
 *   and only when the retrieval is good enough to be worth quoting.
 *
 *   When nothing approved matches, the field is NOT drafted. It comes back
 *   empty and marked for the manager, and the form says so on screen. An
 *   invented policy quotation in a disciplinary record is worse than a blank
 *   line, and a blank line is what a manager can actually fix.
 *
 *   Whatever is drafted carries its sources. The document ids and titles are
 *   stored on the value's provenance, so "where did this wording come from"
 *   has an answer months later.
 *
 * The threshold below is deliberately conservative. A weak match is exactly the
 * case that produces confident-sounding, subtly wrong policy language.
 */

/**
 * Retrieval score under which a match is treated as no match.
 *
 * Cosine similarity from the same pipeline the assistant uses. Tuned to refuse
 * rather than to reach: the cost of a missing quotation is a manager typing
 * one, and the cost of a wrong quotation is a disciplinary record that cites a
 * policy the company does not have.
 */
export const POLICY_MATCH_FLOOR = 0.34;

export interface PolicySource {
  documentId: string;
  documentTitle: string;
  locator: string;
  score: number;
}

export interface PolicyGrounding {
  /** Retrieved policy text the model may quote, already trimmed. */
  passages: { text: string; source: PolicySource }[];
  sources: PolicySource[];
  /** True when nothing approved matched well enough to quote. */
  unverified: boolean;
  reason: string | null;
}

function toSource(result: SearchResult): PolicySource {
  return {
    documentId: result.documentId,
    documentTitle: result.documentTitle,
    locator: result.locator,
    score: result.score,
  };
}

/**
 * The category a document must carry to be quotable as approved policy.
 *
 * Deliberately ONE category and not a list. Widening it to "anything that reads
 * like a rule" is how a coaching guide or a training manual ends up quoted on a
 * disciplinary record as though it were policy.
 */
export const POLICY_CATEGORY = "policies_compliance" as const;

/**
 * Looks for approved policy behind what the manager described.
 *
 * The query is built from the manager's own words plus the form's subject —
 * never from anything the model produced, so retrieval cannot be steered by an
 * earlier hallucination.
 */
export async function groundPolicy(topic: string): Promise<PolicyGrounding> {
  const query = topic.trim();
  if (query.length < 4) {
    return {
      passages: [],
      sources: [],
      unverified: true,
      reason: "There was not enough detail to search the policy manual.",
    };
  }

  const provider = getKnowledgeProvider();

  let results: SearchResult[] = [];
  try {
    results = await provider.search({
      query,
      scopeId: ACTIVE_BRAND.knowledgeScopeId,
      // The corpus's own category for the manual. Named from the app's
      // taxonomy rather than invented here, so a retrieval that finds nothing
      // means "no approved policy", not "wrong filter".
      categories: [POLICY_CATEGORY],
      limit: 4,
    });
  } catch (error) {
    // A retrieval outage must not become an invented policy. It becomes a
    // blank field and a reason.
    return {
      passages: [],
      sources: [],
      unverified: true,
      reason: `The policy manual could not be searched: ${(error as Error).message}`,
    };
  }

  const strong = results.filter((result) => result.score >= POLICY_MATCH_FLOOR);
  if (strong.length === 0) {
    return {
      passages: [],
      sources: results.map(toSource),
      unverified: true,
      reason: await refusalReason(query),
    };
  }

  return {
    passages: strong.map((result) => ({
      text: result.content.trim().slice(0, 1200),
      source: toSource(result),
    })),
    sources: strong.map(toSource),
    unverified: false,
    reason: null,
  };
}

/**
 * ============================================================================
 * WHY THE FIELD CAME BACK EMPTY — THE DIFFERENCE BETWEEN "NO POLICY" AND
 * "POLICY FILED SOMEWHERE ELSE"
 * ============================================================================
 *
 * The search above is category-filtered, and the category is curator metadata
 * edited from the Knowledge Base screen. So there are two very different worlds
 * behind the same empty field:
 *
 *   1. The company has no approved policy on this. The manager writes it. This
 *      is the case the whole fail-closed design is built for.
 *
 *   2. The company's policy manual is indexed and says exactly what the manager
 *      needs — and is filed under a category this search does not look in. The
 *      field goes blank and says "no approved policy matched", which is FALSE
 *      and unfixable by the person reading it, because nothing on screen points
 *      at the mis-filing.
 *
 * That happened: the JBA Employment Policy Manual sat in the corpus under
 * Operations while every Disciplinary Plan of Action reported no approved
 * policy. A second, UNFILTERED search tells the two worlds apart.
 *
 * IT IS DIAGNOSIS ONLY, AND THAT BOUNDARY IS THE POINT. What it finds is never
 * returned as `passages`, never reaches the model, and never becomes a quote.
 * The fail-closed rule is unchanged — the field is still withheld. All that
 * changes is that the manager is told which document to look at and what to fix
 * instead of being told a blank "nothing matched".
 */
async function refusalReason(query: string): Promise<string> {
  const base =
    "No approved policy matched closely enough to quote. The policy fields are left for the manager to complete.";

  let elsewhere: SearchResult[] = [];
  try {
    elsewhere = await getKnowledgeProvider().search({
      query,
      scopeId: ACTIVE_BRAND.knowledgeScopeId,
      limit: 4,
    });
  } catch {
    // The diagnosis is a courtesy. If it fails, the refusal still stands and
    // still explains itself — it just cannot add the hint.
    return base;
  }

  const candidate = elsewhere.find((result) => result.score >= POLICY_MATCH_FLOOR);
  if (!candidate) return base;

  return `${base} "${candidate.documentTitle}" (${candidate.locator}) does match, but it is not filed under Policies & Compliance — if it is approved policy, recategorize it in the Knowledge Base and draft again.`;
}

/**
 * Strips policy-grounded fields out of a draft when the grounding failed.
 *
 * Runs AFTER the responsibility guard and before anything is stored, so the
 * final answer to "may this value exist" is: the template allows this field to
 * be drafted, AND — if it quotes policy — an approved source was found.
 */
export function dropUngroundedPolicy(
  fields: readonly FormField[],
  values: Record<string, string>,
  grounding: PolicyGrounding,
): { values: Record<string, string>; withheld: string[] } {
  if (!grounding.unverified) return { values, withheld: [] };

  const grounded = new Set(
    fields.filter((field) => field.policyGrounded).map((field) => field.key),
  );
  const kept: Record<string, string> = {};
  const withheld: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (grounded.has(key)) withheld.push(key);
    else kept[key] = value;
  }

  return { values: kept, withheld };
}

/**
 * ============================================================================
 * THE LAST GATE BEFORE THE ROW IS WRITTEN
 * ============================================================================
 *
 * `dropUngroundedPolicy` is the DECISION — it reads a grounding result and says
 * which policy fields may stand. This is the GUARD: it stands in front of the
 * write and refuses a policy-quoting value that does not carry verified
 * provenance, whatever the caller believed.
 *
 * WHY BOTH, AND WHY THIS ONE IS NOT REDUNDANT. The route used to write the
 * model's output and then try to blank the ungrounded fields afterwards, which
 * did not work — `enforceResponsibilities` drops empty strings, so the blanking
 * pass wrote nothing and the invented policy quotation stayed in
 * `form_instance_values`. The ordering is fixed, and a fix that lives only in
 * the order of two statements is one edit away from being undone. So the
 * property is asserted where it actually matters: at the write.
 *
 * IT IS GENERIC OVER `policyGrounded`, deliberately. The two fields that quote
 * policy today are the DPOA's and the Policy Review's, and a template published
 * tomorrow may mark a third. Nothing here names a field key.
 *
 * A value is allowed through only when its provenance says `verified: true` —
 * which `provenanceFor` sets only when `groundPolicy` returned passages above
 * the match floor. Absent provenance is refusal, not permission.
 */
export function refuseUnverifiedPolicyValues(
  fields: readonly FormField[],
  values: Record<string, string>,
  provenance: Record<string, Record<string, unknown>>,
): { values: Record<string, string>; refused: string[] } {
  const grounded = new Set(
    fields.filter((field) => field.policyGrounded).map((field) => field.key),
  );

  const kept: Record<string, string> = {};
  const refused: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!grounded.has(key)) {
      kept[key] = value;
      continue;
    }
    if (provenance[key]?.verified === true) {
      kept[key] = value;
      continue;
    }
    refused.push(key);
  }

  return { values: kept, refused };
}

/** The provenance stored against each grounded value. */
export function provenanceFor(
  fields: readonly FormField[],
  values: Record<string, string>,
  grounding: PolicyGrounding,
): Record<string, Record<string, unknown>> {
  const grounded = new Set(
    fields.filter((field) => field.policyGrounded).map((field) => field.key),
  );
  const provenance: Record<string, Record<string, unknown>> = {};

  for (const key of Object.keys(values)) {
    if (!grounded.has(key)) continue;
    provenance[key] = {
      grounded: true,
      verified: !grounding.unverified,
      sources: grounding.sources,
      matchFloor: POLICY_MATCH_FLOOR,
    };
  }

  return provenance;
}

/** The sentence the fill screen shows when policy could not be verified. */
export function groundingNotice(grounding: PolicyGrounding): string | null {
  if (!grounding.unverified) return null;
  return (
    grounding.reason ??
    "Ask Sunny could not find approved policy for this, so the policy fields are yours to complete."
  );
}
