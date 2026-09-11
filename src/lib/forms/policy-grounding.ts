import "server-only";

import { getKnowledgeProvider } from "@/lib/knowledge";
import { ACTIVE_BRAND } from "@/lib/brand";
import type { KnowledgeCategory, SearchResult } from "@/types";

import type { FormField } from "./document";

/**
 * POLICY-GROUNDED FIELDS FAIL CLOSED.
 *
 * The Corrective Action Form and the Policy Review both ask which policy
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

/**
 * ============================================================================
 * WHERE APPROVED POLICY IS ALLOWED TO COME FROM
 * ============================================================================
 *
 * THIS WAS `["policies_compliance"]` ALONE, AND IT WAS WHY THE POLICY FIELDS
 * CAME BACK BLANK ON EVERY CORRECTIVE ACTION FORM.
 *
 * The old comment here said the single category was "the corpus's own category
 * for the manual", so a retrieval finding nothing meant "no approved policy"
 * rather than "wrong filter". That assumption was simply untrue of the live
 * corpus: the Driven to Shine Policy Manual — the document that actually holds
 * Dress for Success, Attendance, Absenteeism and the Standards of Conduct — is
 * filed under OPERATIONS. So the one document a corrective action needs to
 * quote was the one document this search could not see, and the form dutifully
 * reported that no approved policy matched.
 *
 * A CATEGORY IS HOW THE BUSINESS FILES A DOCUMENT, NOT WHAT MAKES IT
 * AUTHORITATIVE. Whoever uploads the manual picks the shelf it sits on, and
 * they are not thinking about this function when they do it. Naming one shelf
 * made retrieval depend on a filing decision nobody knew was load-bearing.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY EXCLUDED, AND WHY THAT IS THE IMPORTANT HALF
 * ============================================================================
 *
 * This is a widening, so the exclusions are what still enforce the source
 * hierarchy the whole feature is built on:
 *
 *   `leadership_coaching` HOLDS THE PERFORMANCE MANAGEMENT FRAMEWORK. The
 *   framework says HOW to reason, classify and document; it is explicitly NOT
 *   a source of official policy, and letting it answer "which policy was
 *   violated" would collapse exactly the distinction this area exists to keep.
 *
 *   `training` and `sales_client_experience` are teaching material. A training
 *   deck describing the dress code is not the dress code.
 *
 *   `reports_analytics` is data, and `other` is the uncategorised shelf —
 *   treating a catch-all as approved policy would make anything anybody
 *   uploaded quotable on a disciplinary record.
 *
 * WHAT IS INCLUDED is the set of shelves that hold RULES the company issues:
 * the policy manual wherever it was filed, operations standards, safety rules,
 * equipment procedures, and the pay and bonus policy.
 */
export const APPROVED_POLICY_CATEGORIES: readonly KnowledgeCategory[] = [
  "policies_compliance",
  "operations",
  "safety",
  "equipment_procedures",
  "bonuses_compensation",
];

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
      categories: [...APPROVED_POLICY_CATEGORIES],
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
 * policy today are the Corrective Action Form's and the Policy Review's, and a
 * template published
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

/**
 * ============================================================================
 * A CATEGORY IS NOT A POLICY
 * ============================================================================
 *
 * "Type of Offense: ☑ Dress Code Violation" is a CLASSIFICATION the manager
 * ticks. "Policy Violated" is the TITLE OR SECTION of a policy that exists in
 * the approved manual. QA found the assistant copying the first into the
 * second — Policy Violated read "Dress Code Violation", which is not a policy,
 * is not in any manual, and cannot be looked up by anybody who later has to
 * defend the record.
 *
 * It is a distinct failure from an invented quotation, and the existing guards
 * miss it for a specific reason: it only arises when retrieval SUCCEEDED. With
 * nothing retrieved the field is withheld outright and there is nothing to
 * echo. With a passage retrieved the field is permitted, and the model, having
 * been handed both the offense list and the policy text, sometimes fills it
 * from the wrong one.
 *
 * SO THE TEST IS AGAINST THE RETRIEVED TEXT, not against a list of forbidden
 * words. A value that appears nowhere in what was actually retrieved — neither
 * in a passage nor in a source document's title — while matching an option
 * label on this very form is an echo, and it is withheld exactly as an
 * unverified value is. A real policy title that happens to resemble an option
 * label survives, because it will be present in the passage that named it.
 */
export function refuseOffenseLabelEchoes(
  fields: readonly FormField[],
  values: Record<string, string>,
  optionLabels: readonly string[],
  grounding: PolicyGrounding,
): { values: Record<string, string>; withheld: string[] } {
  const grounded = new Set(
    fields.filter((field) => field.policyGrounded).map((field) => field.key),
  );
  const labels = new Set(optionLabels.map(normaliseForMatch).filter((label) => label !== ""));
  const retrieved = normaliseForMatch(
    [
      ...grounding.passages.map((passage) => passage.text),
      ...grounding.sources.map((source) => `${source.documentTitle} ${source.locator}`),
    ].join(" "),
  );

  const kept: Record<string, string> = {};
  const withheld: string[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!grounded.has(key)) {
      kept[key] = value;
      continue;
    }
    const candidate = normaliseForMatch(value);
    if (candidate !== "" && labels.has(candidate) && !retrieved.includes(candidate)) {
      withheld.push(key);
      continue;
    }
    kept[key] = value;
  }

  return { values: kept, withheld };
}

/** Case, punctuation and spacing removed, so "Dress Code Violation." matches. */
function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
