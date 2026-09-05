/**
 * ============================================================================
 * THE IDENTITY OF A REPORT VIEW
 * ============================================================================
 *
 * A short deterministic string naming exactly which Sales Totals view a
 * conversation is about. Two questions share a fingerprint only when they are
 * about the same date, the same window, the same estate summary card, the same
 * measure and the same salons.
 *
 * WHY A CONVERSATION NEEDS ONE. Follow-up questions are the point of a chat
 * panel — "which salons stand out?", then "what about EFTs for those stores?"
 * — and answering the second needs the first. But a manager can change the date
 * or the salon filter between the two, and then the earlier turn is about a
 * different set of numbers. Carrying it forward would let Tuesday's figures
 * shape Wednesday's answer while the provenance strip claimed Wednesday.
 *
 * So history travels with a fingerprint, and the SERVER recomputes the
 * fingerprint from the view it actually resolved before deciding whether to use
 * the history. A browser that sends the wrong one — stale state, a replayed
 * request, a hand-made call — gets its history dropped rather than believed.
 *
 * NO FIGURE IS PART OF THE IDENTITY. Every component is an identifier the
 * caller was always allowed to name. The fingerprint says which rows, never
 * what they say, so it can be handed back to the browser without disclosing
 * anything the browser did not already send.
 *
 * Pure and dependency-free — no `server-only` — because the panel computes it
 * too, to know when to start a new conversation on screen. The browser's copy
 * is a convenience; the server's is the one that decides.
 */

/** The canonical fields that identify a view. */
export interface SalesTotalsViewDescriptor {
  readonly reportDate: string;
  readonly window: string;
  readonly estateSummaryKey: string | null;
  readonly metric: string;
  /** Order is not part of the identity — see below. */
  readonly salonIds: readonly string[];
}

/**
 * The fingerprint. Stable across reorderings and duplicate salon ids, because
 * picking the same three salons in a different order is the same view and
 * should not silently discard a conversation.
 */
export function viewFingerprint(view: SalesTotalsViewDescriptor): string {
  const salons = [...new Set(view.salonIds.map((id) => String(id).trim()).filter(Boolean))]
    .sort()
    .join("+");

  return [
    `date=${view.reportDate}`,
    `window=${view.window}`,
    `estate=${view.estateSummaryKey ?? ""}`,
    `metric=${view.metric}`,
    // "all" rather than an empty string, so "no filter" is a value in its own
    // right rather than something that could be confused with a missing field.
    `salons=${salons || "all"}`,
  ].join("|");
}
