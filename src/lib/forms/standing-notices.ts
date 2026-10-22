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
 *     approved one ("requires owner confirmation").
 *
 * Pure, so the form card and its tests share it.
 */

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

