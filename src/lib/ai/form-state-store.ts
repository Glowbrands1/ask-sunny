import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { parseFormState, type ConversationFormState } from "./form-state";

/**
 * chat_form_state, one row per user and conversation.
 *
 * The table is additive and is not applied from here. A missing table
 * returns null on read and is ignored on write, so a chat turn still answers.
 */

export async function loadFormState(userId: string, conversationId: string): Promise<ConversationFormState | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("chat_form_state")
      .select("state")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error || !data) return null;
    return parseFormState(data.state);
  } catch {
    return null;
  }
}

export async function saveFormState(
  userId: string,
  conversationId: string,
  state: ConversationFormState,
): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().from("chat_form_state").upsert(
      {
        user_id: userId,
        conversation_id: conversationId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,conversation_id" },
    );
    if (error) return;
  } catch {
    // The migration has not been applied. The turn keeps the answer it has.
  }
}
