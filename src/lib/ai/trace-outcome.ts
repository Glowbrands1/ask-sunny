import type { AskResponse } from "./types";
import { chatTraceDraft, updateChatTrace } from "./chat-trace-store";

/**
 * Tags a traced turn when it offered no form card, or retrieval returned
 * almost nothing. Stored on the existing intent column so a weekly read of
 * chat_traces can find them without a new column.
 *
 * Zero or one retrieved chunk is low retrieval. A turn that never searched
 * leaves retrievalCount null and is not marked low.
 */

export const LOW_RETRIEVAL_AT_MOST = 1;

export function traceIntent(
  base: string | null,
  outcome: { readonly noCard: boolean; readonly lowRetrieval: boolean },
): string {
  const parts = [base, outcome.noCard ? "no_card" : "card"];
  if (outcome.lowRetrieval) parts.push("low_retrieval");
  return parts.filter((part): part is string => Boolean(part)).join("|");
}

export function noteTraceOutcome(response: Pick<AskResponse, "formProposal" | "formSelection">): void {
  const draft = chatTraceDraft();
  if (!draft) return;
  const noCard = !response.formProposal && !response.formSelection;
  const lowRetrieval = draft.retrievalCount !== null && draft.retrievalCount <= LOW_RETRIEVAL_AT_MOST;
  updateChatTrace({ intent: traceIntent(draft.intent, { noCard, lowRetrieval }) });
}
