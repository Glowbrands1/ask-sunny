import type { TokenUsage } from "./model-prices";

/**
 * AI_READS_CODE_CHECKS_ENABLED: the AI reader's call is recorded in the chat
 * trace's `slots.reader` — `{ model?, usage: { inputTokens, outputTokens,
 * cacheReadTokens, cacheWriteTokens }, … }` — and in none of the trace's own
 * model columns, so the monthly budget read only the answering call and never
 * the reader's. This turns that entry into one more row for the budget.
 *
 * `model` is the reader's own (`slots.reader.model`); a trace without it is
 * priced as Haiku 4.5, the dearer Haiku, so the guard errs strict. A turn the
 * reader fell back on (`{ fallback }`) carries no usage and counts nothing.
 */
export interface ReaderTraceRow {
  readonly model?: unknown;
  readonly usage?: {
    readonly inputTokens?: unknown;
    readonly outputTokens?: unknown;
    readonly cacheReadTokens?: unknown;
    readonly cacheWriteTokens?: unknown;
  } | null;
}

const DEFAULT_READER_MODEL = "claude-haiku-4-5";

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

export function readerUsageRow(reader: ReaderTraceRow | null | undefined): TokenUsage | null {
  const usage = reader?.usage;
  if (!usage || typeof usage !== "object") return null;
  const row = {
    model: typeof reader?.model === "string" && reader.model !== "" ? reader.model : DEFAULT_READER_MODEL,
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    cacheReadTokens: count(usage.cacheReadTokens),
    cacheWriteTokens: count(usage.cacheWriteTokens),
  };
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens > 0 ? row : null;
}
