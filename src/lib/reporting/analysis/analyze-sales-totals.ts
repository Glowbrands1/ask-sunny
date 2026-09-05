import "server-only";

import { callClaude } from "@/lib/ai/call-claude";
import { AiError } from "@/lib/ai/errors";
import { buildReportAnalysisSystemPrompt } from "./analysis-prompt";
import {
  resolveSalesTotalsAnalysisContext,
  type AnalysisContextFailure,
} from "./sales-totals-context";
import type {
  SalesTotalsAnalysisRequest,
  SalesTotalsAnalysisResponse,
} from "./types";

/**
 * ============================================================================
 * ANALYSING A SALES TOTALS VIEW
 * ============================================================================
 *
 * Three steps, in this order and no other:
 *
 *   1. Reload the view from the reporting database (`sales-totals-context`).
 *   2. Build the report-analysis system prompt (`analysis-prompt`).
 *   3. Ask Claude, through the SAME helper the knowledge-base path uses.
 *
 * WHAT THIS FUNCTION DOES NOT DO, each for a reason:
 *
 *   NO RETRIEVAL. The knowledge base is not searched, so no chunk is embedded,
 *   no vector index is queried, and no document is cited. Report figures are
 *   not knowledge-base content and are never written into it to make the model
 *   able to see them — they are read from the reporting tables at request time
 *   and discarded when the response is sent.
 *
 *   NO ATTACHMENT, NO RE-UPLOAD. Nothing here touches the original email or its
 *   attachment. A snapshot already ingested and already on the dashboard is
 *   analysable exactly as it stands.
 *
 *   NO SECOND DATE. `resolveSalesTotalsAnalysisContext` reads one snapshot,
 *   through an API that takes one date. There is no call available from here
 *   that could reach another one and add it.
 *
 * AUTHORIZATION IS NOT DONE HERE, and that is not an omission — it is done by
 * the route, before this function is called, so no unauthorized request can
 * reach the point of spending money at Anthropic. This function is the paid
 * work; the gate is upstream of it.
 */

/** Output ceiling. A report reading is a few paragraphs, not an essay. */
const ANALYSIS_MAX_TOKENS = 1600;

/** Longest question accepted. Bounded before it reaches the model. */
export const ANALYSIS_QUESTION_LIMIT = 1000;

/**
 * What to tell a reader when the view could not be resolved.
 *
 * NONE OF THESE SENTENCES CONTAINS A FIGURE, a salon name or a date the caller
 * did not already supply. An error is a place report data leaks by accident:
 * "salon 1234 reported $0" would disclose a restricted value to somebody the
 * gate was about to refuse anyway.
 */
const FAILURE_MESSAGES: Record<AnalysisContextFailure, string> = {
  no_reports:
    "No Sales Totals report has been received yet, so there is nothing to analyse.",
  no_snapshot:
    "That report date and window has no Sales Totals data. Pick another date, or switch between daily and month-to-date.",
  no_salon_data:
    "This report carries no salon rows for the current selection, so there is nothing to analyse.",
};

export async function analyzeSalesTotals(
  request: SalesTotalsAnalysisRequest,
): Promise<SalesTotalsAnalysisResponse> {
  const question = request.question.trim();
  if (!question) {
    throw new AiError("bad_request", "A question is required.", 400);
  }

  /*
   * THE FIGURES ARE READ HERE, SERVER-SIDE, FROM THE DATABASE. Everything the
   * browser sent was used to decide WHICH rows to read. Not one number in the
   * grounding block came from the request.
   */
  const context = await resolveSalesTotalsAnalysisContext({
    reportDate: request.reportDate,
    window: request.window,
    estateSummaryKey: request.estateSummaryKey,
    salonIds: request.salonIds,
    metric: request.metric,
  });

  if (!context.ok) {
    throw new AiError("bad_request", FAILURE_MESSAGES[context.failure], 404);
  }

  const content = await callClaude({
    system: buildReportAnalysisSystemPrompt(),
    grounding: `REPORT CONTEXT\n\n${context.grounding}`,
    // No history. Each question is answered against the view as it stands now,
    // so a figure from an earlier turn cannot be carried into a later answer
    // after the reader has changed the date or the selection underneath it.
    history: [],
    question,
    maxTokens: ANALYSIS_MAX_TOKENS,
  });

  return { content, provenance: context.provenance };
}
