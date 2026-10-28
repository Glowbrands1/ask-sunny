import "server-only";

import { spendGuardAllCallsEnabled } from "@/lib/config/chat-quality-flags";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { TokenUsage } from "./model-prices";
import { readerUsageRow, type ReaderTraceRow } from "./spend-guard-reader";

/** Model calls this user made since `sinceIso`, one chat_traces row each. */
export async function modelCallsSince(userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await getSupabaseAdmin()
    .from("chat_traces")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", sinceIso)
    .not("model", "is", null);
  if (error) throw new Error(`chat_traces count failed: ${error.message}`);
  return count ?? 0;
}

const PAGE = 1000;
const MODEL_COLUMNS = "model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens";

interface UsageRow {
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  reader?: ReaderTraceRow | null;
  spend?: unknown;
}

/**
 * Every traced model call's tokens since `sinceIso`, read a page at a time. With
 * `withReader`, also the AI reader's call in each trace's `slots.reader`, and
 * the form turns that had one but no answering model call.
 */
async function readUsage(sinceIso: string, withReader: boolean): Promise<TokenUsage[]> {
  const out: TokenUsage[] = [];
  for (let from = 0; ; from += PAGE) {
    // SPEND_GUARD_ALL_CALLS_ENABLED: also each row's `slots.spend`, and the spend rows that carry only that.
    const allCalls = spendGuardAllCallsEnabled();
    const columns = withReader ? `${MODEL_COLUMNS}, reader:slots->reader` : MODEL_COLUMNS;
    const base = getSupabaseAdmin()
      .from("chat_traces")
      .select(allCalls ? `${columns}, spend:slots->spend` : columns)
      .gte("created_at", sinceIso);
    const { data, error } = await (allCalls
      ? base.or(withReader ? "model.not.is.null,slots->reader.not.is.null,slots->spend.not.is.null" : "model.not.is.null,slots->spend.not.is.null")
      : withReader
        ? base.or("model.not.is.null,slots->reader.not.is.null")
        : base.not("model", "is", null))
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`chat_traces usage read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as UsageRow[];
    for (const row of rows) {
      /*
       * A metered row's `slots.spend` holds every call of the turn, the answer
       * and the reader among them, so its model columns are not added again.
       */
      const spend = allCalls ? spendUsageRows(row.spend) : null;
      if (spend && spend.length > 0) {
        out.push(...spend);
        continue;
      }
      if (row.model !== null) {
        out.push({
          model: row.model,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_input_tokens,
          cacheWriteTokens: row.cache_creation_input_tokens,
        });
      }
      // The AI reader's call is in the trace's slots, not in the model columns (AI_READS_CODE_CHECKS_ENABLED).
      const reader = withReader ? readerUsageRow(row.reader) : null;
      if (reader) out.push(reader);
    }
    if (rows.length < PAGE) return out;
  }
}

/**
 * The month's usage for the budget. If the reader-aware read fails, the old
 * read (answering calls only) is used and the failure is logged: the budget
 * never falls to zero and the guard never loses its existing count because of
 * the new part.
 */
export async function modelUsageSince(sinceIso: string): Promise<TokenUsage[]> {
  try {
    return await readUsage(sinceIso, true);
  } catch (error) {
    console.warn(`spend.guard: reader-aware usage read failed, counting answering calls only: ${error instanceof Error ? error.message : String(error)}`);
    return readUsage(sinceIso, false);
  }
}

/** `slots.spend` as the meter wrote it (`spend-meter.ts`), or null for a row without it. */
export function spendUsageRows(spend: unknown): TokenUsage[] | null {
  if (!Array.isArray(spend)) return null;
  return spend
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry) => ({
      model: typeof entry.model === "string" ? entry.model : null,
      inputTokens: typeof entry.inputTokens === "number" ? entry.inputTokens : 0,
      outputTokens: typeof entry.outputTokens === "number" ? entry.outputTokens : 0,
      cacheReadTokens: typeof entry.cacheReadTokens === "number" ? entry.cacheReadTokens : 0,
      cacheWriteTokens: typeof entry.cacheWriteTokens === "number" ? entry.cacheWriteTokens : 0,
    }));
}

