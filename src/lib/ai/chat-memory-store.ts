import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { MemoryCue, MemoryFact } from "./chat-memory";

/**
 * user_memory rows for one user. The query always filters on user_id.
 * RLS on the table repeats that rule for an authenticated client.
 * This is not applied to production from here.
 */

export async function recallMemory(userId: string): Promise<MemoryFact[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_memory")
    .select("kind, key, value")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error || !Array.isArray(data)) return [];
  return data
    .map((row) => ({
      kind: row.kind as MemoryFact["kind"],
      key: String(row.key ?? ""),
      value: String(row.value ?? ""),
    }))
    .filter((row) => row.kind === "salon" || row.kind === "employee" || row.kind === "preference");
}

export async function rememberFact(input: MemoryCue & { userId: string; sourceConversationId: string | null }): Promise<void> {
  const { error } = await getSupabaseAdmin().from("user_memory").upsert(
    {
      user_id: input.userId,
      kind: input.kind,
      key: input.key,
      value: input.value,
      source_conversation_id: input.sourceConversationId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,kind,key" },
  );
  if (error) throw new Error("The memory note could not be saved.");
}
