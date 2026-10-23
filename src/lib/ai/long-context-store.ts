import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * The rolling summary of turns that no longer fit in the history window.
 * Service role only. LONG_CONTEXT_ENABLED off never reads or writes it.
 */

export interface StoredContextSummary {
  readonly summary: string;
  readonly throughMessageId: string | null;
}

export async function loadContextSummary(input: {
  readonly userId: string;
  readonly conversationId: string;
}): Promise<StoredContextSummary | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("chat_context_summaries")
    .select("summary, through_message_id")
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { summary: string | null; through_message_id: string | null };
  if (!row.summary) return null;
  return { summary: row.summary, throughMessageId: row.through_message_id };
}

export async function saveContextSummary(input: {
  readonly userId: string;
  readonly conversationId: string;
  readonly summary: string;
  readonly throughMessageId: string | null;
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from("chat_context_summaries").upsert(
    {
      user_id: input.userId,
      conversation_id: input.conversationId,
      summary: input.summary,
      through_message_id: input.throughMessageId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_id" },
  );
  if (error) throw new Error("context summary was not stored");
}
