import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * ============================================================================
 * AN OPEN DRAFT IS REUSED ONLY BY THE CHAT THAT MADE IT
 * ============================================================================
 *
 * DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED (QA, 25 Oct 2026). Drafts from another
 * chat were reopened and then overwritten (B18–B20). A duplicate draft is
 * recoverable; an overwritten one is not. So with the flag on, every lookup
 * that hands back an existing draft keeps only the drafts whose `created`
 * event records this chat (`draftConversation`, written at creation by
 * `noteConversationDraft`).
 *
 * FAILS CLOSED. No chat key, or a read that fails, keeps nothing, and the
 * create files a new draft.
 */

/** The chat a lookup must match: its conversation key, or null when the request named none. */
export interface SameChat {
  readonly conversationKey: string | null;
}

/** The ids among these drafts that this chat made. */
export async function draftsFromChat(instanceIds: readonly string[], conversationKey: string | null): Promise<Set<string>> {
  if (!conversationKey || instanceIds.length === 0) return new Set();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("form_instance_events")
      .select("instance_id, detail")
      .in("instance_id", [...instanceIds])
      .eq("kind", "created");
    if (error || !Array.isArray(data)) return new Set();
    return new Set(
      (data as { instance_id: unknown; detail: unknown }[])
        .filter((event) => (event.detail as { draftConversation?: unknown } | null)?.draftConversation === conversationKey)
        .map((event) => String(event.instance_id)),
    );
  } catch {
    return new Set();
  }
}

/** Only the rows this chat made when `sameChat` is given; every row otherwise. */
export async function keepSameChat<T extends { readonly id: string }>(
  rows: readonly T[],
  sameChat: SameChat | undefined,
): Promise<T[]> {
  if (!sameChat) return [...rows];
  const mine = await draftsFromChat(
    rows.map((row) => row.id),
    sameChat.conversationKey,
  );
  return rows.filter((row) => mine.has(row.id));
}
