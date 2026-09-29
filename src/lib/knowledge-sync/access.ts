import type { AudienceDecision } from "./types";

/**
 * ============================================================================
 * WHO MAY SEE A SYNCED DOCUMENT
 * ============================================================================
 *
 * ASK SUNNY HAS ONE KNOWLEDGE AUDIENCE TODAY: every signed-in user. Row level
 * security on `knowledge_documents` is `using (true)` for `authenticated`, and
 * retrieval does not filter by role, salon or position. So the only access
 * boundary a synced document can be given is "in Ask Sunny" or "not in Ask
 * Sunny".
 *
 * That makes the mapping from a source's audience simple and strict:
 *
 *   company-wide in the source   → in Ask Sunny
 *   anything narrower or unknown → held for review, NOT in Ask Sunny
 *
 * An administrator decides a held audience ONCE, by its label ("All Teams",
 * "Managers"), not item by item. The decision is keyed on the audience, so a
 * record whose audience later changes in the source is re-evaluated rather
 * than carried through on an old approval.
 *
 * Woven positions are not mapped onto Ask Sunny roles anywhere in this
 * codebase (see docs/woven-employee-sync.md §4), so "Managers only" cannot be
 * honoured as "Managers only" — sharing it is sharing it with everyone, and the
 * review screen says so.
 */

export type AccessDecision =
  | { kind: "company_wide"; basis: "public_audience" | "admin_decision" }
  | { kind: "excluded"; basis: "admin_decision" }
  | { kind: "review" };

export const NO_AUDIENCE_KEY = "(none stated)";

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The key an audience is decided under: its labels, normalised, de-duplicated
 * and sorted, so "Managers, All Teams" and "all teams , managers" are one key.
 */
export function audienceKey(audience: readonly string[] | null): string {
  if (audience === null) return NO_AUDIENCE_KEY;
  const labels = [...new Set(audience.map(normalizeLabel).filter((l) => l.length > 0))].sort();
  return labels.length === 0 ? NO_AUDIENCE_KEY : labels.join(" | ");
}

/** A readable label for the review screen: the original spelling, joined. */
export function audienceLabel(audience: readonly string[] | null): string {
  if (audience === null) return "No audience stated";
  const labels = [...new Set(audience.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 0))];
  return labels.length === 0 ? "No audience stated" : labels.join(", ");
}

/**
 * The access decision for one record.
 *
 * An administrator's decision wins, in both directions: they may keep a Public
 * item out, or share a narrower one. Otherwise only an audience made entirely
 * of the source's company-wide labels is shared.
 */
export function decideAccess(
  audience: readonly string[] | null,
  companyWideLabels: readonly string[],
  decisions: ReadonlyMap<string, AudienceDecision>,
): AccessDecision {
  const key = audienceKey(audience);
  const decided = decisions.get(key);
  if (decided) {
    return decided.decision === "company_wide"
      ? { kind: "company_wide", basis: "admin_decision" }
      : { kind: "excluded", basis: "admin_decision" };
  }

  if (audience !== null && key !== NO_AUDIENCE_KEY) {
    const publicLabels = new Set(companyWideLabels.map(normalizeLabel));
    const labels = key.split(" | ");
    if (labels.every((label) => publicLabels.has(label))) {
      return { kind: "company_wide", basis: "public_audience" };
    }
  }
  return { kind: "review" };
}
