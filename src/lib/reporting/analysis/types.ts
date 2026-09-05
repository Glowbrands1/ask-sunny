/**
 * The wire contract for report analysis.
 *
 * No `server-only` import: the panel in the browser needs these types, and they
 * are types, not behaviour. What matters is what the REQUEST cannot express.
 *
 * THERE IS NO FIELD HERE THROUGH WHICH A FIGURE CAN TRAVEL. The request names a
 * date, a window, an estate summary card, a metric and some salon numbers —
 * every one of them a question about which rows to read. The browser cannot
 * send a number and have it treated as true, because there is nowhere to put
 * one. That is deliberate: the screen renders numbers, and a screen is not
 * evidence about money.
 */

/** One prior turn in a same-view conversation. Prose only, never data. */
export interface SalesTotalsAnalysisTurn {
  role: "user" | "assistant";
  content: string;
}

/** What the reader is looking at. All optional; the server resolves defaults. */
export interface SalesTotalsAnalysisRequest {
  question: string;
  reportDate?: string | null;
  window?: string | null;
  estateSummaryKey?: string | null;
  salonIds?: string[] | null;
  metric?: string | null;
  /**
   * Earlier turns of this conversation, so a follow-up can say "those stores"
   * without repeating the first question.
   *
   * PROSE, NOT DATA. These are sentences that were already said; the server
   * rebuilds the authoritative report grounding from the database on every
   * question and tells the model that the fresh grounding wins wherever the two
   * disagree. A prior answer therefore cannot carry a figure forward, and a
   * hand-made request cannot smuggle one in as remembered dialogue.
   */
  history?: SalesTotalsAnalysisTurn[] | null;
  /**
   * The fingerprint of the view that history belongs to.
   *
   * The server recomputes the fingerprint of the view it ACTUALLY resolved and
   * uses the history only if the two match. A conversation therefore cannot
   * follow the reader across a change of date, window, measure or selection —
   * not because the browser remembers to clear it, but because the server will
   * not accept it.
   */
  historyFingerprint?: string | null;
}

/** What the server actually analysed, echoed back so the panel can show it. */
export interface SalesTotalsAnalysisProvenance {
  reportType: "Sales Totals";
  reportDate: string;
  reportDateLabel: string;
  window: "daily" | "mtd";
  windowLabel: string;
  salonCount: number;
  isAllSalons: boolean;
  selectedMetric: string;
  estateSummaryLabel: string | null;
}

export interface SalesTotalsAnalysisResponse {
  content: string;
  /**
   * The fingerprint of the view this answer was read from.
   *
   * Sent back so the panel can pin its transcript to a view and hand the same
   * value up with the next question. It names rows, never values — see
   * `view-fingerprint.ts`.
   */
  fingerprint: string;
  /**
   * Where the answer came from — the report, its date, its window and the
   * selection. NOT a document citation: nothing was retrieved from the
   * knowledge base for this answer, and a numbered source card here would be a
   * reference to a document that does not exist.
   */
  provenance: SalesTotalsAnalysisProvenance;
}

/** Starter questions the panel offers. Plain report reading, no causation. */
/**
 * Starter questions the panel offers.
 *
 * EVERY ONE OF THEM MUST BE ANSWERABLE FROM THE GROUNDING BLOCK, and one of the
 * originals was not: "How does this delivery compare with the estate average?"
 * asked for precisely the comparison the data rules forbid. The estate summary
 * rows are per-salon averages over 249 salons and the salon rows are this
 * delivery's fifteen; they are different populations, and the grounding text
 * says outright that they must never be directly compared. Offering it as a
 * suggested question invited the model to break a rule the same prompt had just
 * given it, and put the app's own name on the request.
 *
 * They also stay free of causation — "why is Aurora down" has no answer in a
 * report that carries no staffing, promotions or weather.
 */
export const SALES_TOTALS_STARTER_PROMPTS: readonly string[] = [
  "Summarise this view.",
  "Which salons stand out, high or low?",
  "What should I look at first?",
  "Compare the selected salons.",
];
