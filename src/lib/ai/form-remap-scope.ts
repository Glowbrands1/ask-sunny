import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { FormRemapSlots } from "./form-full-remap";

/**
 * History and saved slots for one conversation.
 *
 * The browser's history is not trusted when a turn's id is already stored
 * on a different conversation. A salon and a payroll amount from an earlier
 * chat must not fill this one. Saved slots are the last extraction for this
 * conversation id only. A later turn overwrites a field; it does not erase
 * one by leaving it blank.
 */

type HistoryTurn = { id?: string; role: string; content: string };

const SAVED_KEYS = [
  "templateKey",
  "employeeName",
  "jobTitle",
  "store",
  "locationId",
  "incidentDateIso",
  "incidentTime",
  "warningLevel",
  "payrollDeduct",
  "payrollAmount",
  "policySection",
  "observation",
  "priorActions",
  "actionPlan",
  "closeMatchNote",
] as const;

export function keepThisConversation<T extends { id?: string }>(
  history: readonly T[],
  foreignIds: ReadonlySet<string>,
): T[] {
  return history.filter((turn) => !turn.id || !foreignIds.has(turn.id));
}

export function savedSlotsFromTrace(value: unknown): Partial<FormRemapSlots> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const saved: Partial<FormRemapSlots> = {};
  for (const key of SAVED_KEYS) {
    const item = row[key];
    if (typeof item === "string" && item.trim() !== "") {
      (saved as Record<string, string>)[key] = item.trim();
    }
  }
  return Object.keys(saved).length > 0 ? saved : null;
}

export async function historyForRemap(input: {
  readonly userId: string;
  readonly conversationId: string;
  readonly history: readonly HistoryTurn[];
}): Promise<{ history: { role: string; content: string }[]; saved: Partial<FormRemapSlots> | null }> {
  const supabase = getSupabaseAdmin();
  const conversation = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("user_id", input.userId)
    .eq("client_conversation_id", input.conversationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (conversation.error) throw new Error(conversation.error.message);

  const ownId = typeof conversation.data?.id === "string" ? conversation.data.id : null;
  let stored: { id: string; role: string; content: string }[] = [];
  if (ownId) {
    const messages = await supabase
      .from("chat_messages")
      .select("client_message_id, role, content, position")
      .eq("user_id", input.userId)
      .eq("conversation_id", ownId)
      .order("position", { ascending: true });
    if (messages.error) throw new Error(messages.error.message);
    stored = (messages.data ?? []).flatMap((row) => {
      const id = stringField(row, "client_message_id");
      const role = stringField(row, "role");
      const content = stringField(row, "content");
      return id && role && content != null ? [{ id, role, content }] : [];
    });
  }

  const clientIds = input.history.flatMap((turn) => (turn.id ? [turn.id] : []));
  const foreign = new Set<string>();
  if (clientIds.length > 0) {
    const found = await supabase
      .from("chat_messages")
      .select("client_message_id, conversation_id")
      .eq("user_id", input.userId)
      .in("client_message_id", clientIds);
    if (found.error) throw new Error(found.error.message);
    for (const row of found.data ?? []) {
      const id = stringField(row, "client_message_id");
      const conversationId = stringField(row, "conversation_id");
      if (id && conversationId && conversationId !== ownId) foreign.add(id);
    }
  }

  const storedIds = new Set(stored.map((turn) => turn.id));
  const extra = keepThisConversation(input.history, foreign).filter((turn) => !turn.id || !storedIds.has(turn.id));
  const history = [
    ...stored.map((turn) => ({ role: turn.role, content: turn.content })),
    ...extra.map((turn) => ({ role: turn.role, content: turn.content })),
  ];

  const trace = await supabase
    .from("chat_traces")
    .select("slots")
    .eq("user_id", input.userId)
    .eq("conversation_id", input.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (trace.error) throw new Error(trace.error.message);

  return { history, saved: savedSlotsFromTrace(trace.data?.slots ?? null) };
}

function stringField(row: unknown, key: string): string | null {
  if (!row || typeof row !== "object") return null;
  const value = (row as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}
