/**
 * ============================================================================
 * WHAT A REOPENED FORM STILL HAS TO SAY (owner decisions, 22 Oct 2026)
 * ============================================================================
 *
 * Read off the stored record — the values and their provenance — never off a
 * drafting response, so a refresh or a form reopened next week says what the
 * draft said when it was written:
 *
 *   * the policy quoted is from a manual no owner has confirmed as Ask Sunny's
 *     approved one ("requires owner confirmation"); and
 *   * the Type of Warning on a Corrective Action is Ask Sunny's suggestion, not
 *     a level the manager chose — said, with a Confirm button, so the two are
 *     never confused. It never blocks Finalize (owner, 22 Oct 2026).
 *
 * Pure, so the form card and its tests share it.
 */
import { checkboxGroupsForVariant, type FormDocument } from "./document";
import { WARNING_GROUP_KEY, warningLevelConfirmed } from "./warning-level-gate";

export interface StandingValueRow {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly checked: readonly string[];
  readonly filledBy: string;
  readonly provenance?: Record<string, unknown> | null;
}

/**
 * A citation written before `ownerConfirmed` was stored carries only how the
 * manual was found. In this app a manual found by its name was never confirmed, so such a
 * citation reads as unconfirmed.
 */
const LEGACY_FALLBACK_IS_UNCONFIRMED = true;

/** The title of the manual a stored citation came from, where no owner confirmed it; null when none. */
export function unconfirmedManualOf(rows: readonly StandingValueRow[]): string | null {
  for (const row of rows) {
    const provenance = row.provenance;
    if (!provenance || provenance.source !== "official_policy_manual") continue;
    if ((row.value ?? "").trim() === "") continue;
    const confirmed =
      typeof provenance.ownerConfirmed === "boolean"
        ? provenance.ownerConfirmed
        : !(LEGACY_FALLBACK_IS_UNCONFIRMED && provenance.matchedBy === "fallback");
    if (!confirmed) {
      const title = typeof provenance.documentTitle === "string" ? provenance.documentTitle.trim() : "";
      return title || "the policy manual";
    }
  }
  return null;
}

export function manualStandingNotice(rows: readonly StandingValueRow[]): string | null {
  const title = unconfirmedManualOf(rows);
  if (!title) return null;
  return `The policy quoted on this form is from "${title}", which requires owner confirmation as Ask Sunny's approved policy manual. The section and page are cited; check the quoted wording against your current manual before you finalize.`;
}

/** What the form says about a Type of Warning the assistant suggested, while it is a draft; null otherwise. */
export function warningLevelStandingNotice(input: {
  readonly status: string;
  readonly document: FormDocument;
  readonly variantKey: string | null;
  readonly rows: readonly StandingValueRow[];
}): string | null {
  if (input.status !== "draft") return null;
  const group = checkboxGroupsForVariant(input.document, input.variantKey).find((entry) => entry.key === WARNING_GROUP_KEY);
  if (!group) return null;
  const row = input.rows.find((entry) => entry.fieldKey === WARNING_GROUP_KEY);
  if (warningLevelConfirmed(row)) return null;
  const labels = (row?.checked ?? []).map((key) => group.options.find((option) => option.key === key)?.label ?? key);
  if (row && row.filledBy === "ai" && labels.length > 0) {
    return `Type of Warning: ${labels.join(", ")} is Ask Sunny's suggestion. Confirm it or choose another — tick it on the form, or tell Ask Sunny in the chat.`;
  }
  return null;
}
