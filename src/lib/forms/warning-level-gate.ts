/**
 * ============================================================================
 * A DISCIPLINARY LEVEL IS THE MANAGER'S, CONFIRMED, BEFORE THE RECORD IS FILED
 * ============================================================================
 *
 * Owner decision, 22 Oct 2026: Ask Sunny may SUGGEST a Type of Warning, but a
 * suggestion is never filed as the manager's decision. A level counts as
 * confirmed when the manager ticked it on the form, stated it in the chat
 * ("create a written CA for …", "make it verbal"), or confirmed the suggestion
 * ("confirm the written warning") — and not when only Ask Sunny ticked it, or
 * nothing is ticked. Finalizing is refused until then; nothing else is.
 */
export const WARNING_LEVEL_CONFIRMATION_REQUIRED = "warning_level_confirmation_required";
export const WARNING_GROUP_KEY = "warning_type";

export class UnconfirmedWarningLevelError extends Error {
  constructor(suggested: readonly string[]) {
    super(
      suggested.length > 0
        ? "The Type of Warning is Ask Sunny's suggestion and hasn't been confirmed. Confirm it or choose the level (tick it on the form, or tell Ask Sunny in the chat), then finalize."
        : "Choose the Type of Warning before finalizing this Corrective Action.",
    );
    this.name = "UnconfirmedWarningLevelError";
  }
}

/** Whether a Type of Warning row holds a level the manager chose or confirmed. */
export function warningLevelConfirmed(row: { checked: readonly string[]; filledBy: string; provenance?: Record<string, unknown> | null } | undefined): boolean {
  if (!row || row.checked.length === 0) return false;
  if (row.filledBy === "manager") return true;
  const source = row.provenance?.source;
  return source === "manager_statement" || source === "manager_confirmation";
}

/** A change asked of a form that is no longer a draft: it is refused, never applied in place. */
export class FinalizedFormError extends Error {
  constructor() {
    super("This form is finalized, so it can't be changed. Open it as a new draft to change it.");
    this.name = "FinalizedFormError";
  }
}

export class WarningLevelNotOfferedError extends Error {
  constructor() {
    super("This form has no such Type of Warning to choose.");
    this.name = "WarningLevelNotOfferedError";
  }
}
