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

  let results: SearchResult[] = [];
  try {
    results = await getKnowledgeProvider().search({
      query,
      scopeId: ACTIVE_BRAND.knowledgeScopeId,
      // The corpus's own category for the manual. Named from the app's
      // taxonomy rather than invented here, so a retrieval that finds nothing
      // means "no approved policy", not "wrong filter".
      categories: ["policies_compliance"],
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
      reason:
        "No approved policy matched closely enough to quote. The policy fields are left for the manager to complete.",
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
