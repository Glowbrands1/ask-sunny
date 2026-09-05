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

/** What the reader is looking at. All optional; the server resolves defaults. */
export interface SalesTotalsAnalysisRequest {
  question: string;
  reportDate?: string | null;
  window?: string | null;
  estateSummaryKey?: string | null;
  salonIds?: string[] | null;
  metric?: string | null;
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
   * Where the answer came from — the report, its date, its window and the
   * selection. NOT a document citation: nothing was retrieved from the
   * knowledge base for this answer, and a numbered source card here would be a
   * reference to a document that does not exist.
   */
  provenance: SalesTotalsAnalysisProvenance;
}

/** Starter questions the panel offers. Plain report reading, no causation. */
export const SALES_TOTALS_STARTER_PROMPTS: readonly string[] = [
  "Summarise this report for me.",
  "Which salons stand out, high or low?",
  "What should I look at first?",
  "How does this delivery compare with the estate average?",
];
