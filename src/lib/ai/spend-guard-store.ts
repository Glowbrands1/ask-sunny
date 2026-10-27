import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { TokenUsage } from "./model-prices";

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

/** Every traced model call's tokens since `sinceIso`, read a page at a time. */
export async function modelUsageSince(sinceIso: string): Promise<TokenUsage[]> {
  const out: TokenUsage[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await getSupabaseAdmin()
      .from("chat_traces")
      .select("model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens")
      .gte("created_at", sinceIso)
      .not("model", "is", null)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`chat_traces usage read failed: ${error.message}`);
    const rows = (data ?? []) as {
      model: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_input_tokens: number | null;
      cache_creation_input_tokens: number | null;
    }[];
    for (const row of rows) {
      out.push({
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadTokens: row.cache_read_input_tokens,
        cacheWriteTokens: row.cache_creation_input_tokens,
      });
    }
    if (rows.length < PAGE) return out;
  }
}
