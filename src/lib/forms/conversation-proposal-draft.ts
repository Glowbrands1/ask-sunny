import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { loadInstance, type InstanceRow } from "./instances";
import { isProposalId } from "./proposal-id";

/**
 * One draft per conversation and proposal.
 *
 * The caller's own assistant drafts only. A match does not depend on the
 * employee name or the salon: those can change between presses of the same
 * card. A different conversation does not match.
 */

const WINDOW_MS = 24 * 3_600_000;

export async function findConversationProposalDraft(input: {
  readonly createdBy: string;
  readonly proposalId: string;
  readonly conversationKey: string;
  readonly now?: Date;
}): Promise<InstanceRow | null> {
  if (!isProposalId(input.proposalId) || !input.conversationKey) return null;
  const supabase = getSupabaseAdmin();
  const since = new Date((input.now ?? new Date()).getTime() - WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("form_instances")
    .select("id")
    .eq("created_by", input.createdBy)
    .eq("source", "ask_sunny")
    .eq("status", "draft")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const ids = (data as { id: unknown }[]).map((row) => String(row.id));
  const { data: events, error: eventsError } = await supabase
    .from("form_instance_events")
    .select("instance_id, detail")
    .in("instance_id", ids)
    .eq("kind", "created");
  if (eventsError || !Array.isArray(events)) return null;

  const same = (events as { instance_id: unknown; detail: unknown }[]).find((event) => {
    const detail = event.detail as { proposalId?: unknown; conversationKey?: unknown } | null;
    return detail?.proposalId === input.proposalId && detail?.conversationKey === input.conversationKey;
  });
  if (!same) return null;
  const loaded = await loadInstance(String(same.instance_id));
  return loaded?.instance ?? null;
}
