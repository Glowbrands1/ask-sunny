import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { chatTraceDraft, runChatTrace, type ChatTraceDraft } from "./chat-trace-store";

/**
 * Write one chat_traces row after the turn, without blocking or failing it.
 *
 * View live rows in the Supabase table editor as `chat_traces`, or run
 * `select * from chat_traces_live order by created_at desc` in the SQL editor.
 * The table is service-role only. With CHAT_TRACE_ENABLED off, nothing is written.
 */

const SECRET = /sk-ant-[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

export function redactTraceText(text: string): string {
  return text.replace(SECRET, "[redacted]").slice(0, 12000);
}

export function openChatTrace(input: {
  readonly conversationId?: string | null;
  readonly messageId?: string | null;
  readonly userId?: string | null;
  readonly originalQuery: string;
  readonly formInProgress: boolean;
}): ChatTraceDraft {
  return {
    startedAt: Date.now(),
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    userId: input.userId ?? null,
    originalQuery: input.originalQuery,
    rewrittenQuery: null,
    intent: null,
    retrievalCount: null,
    retrieved: [],
    prompt: null,
    formInProgress: input.formInProgress,
    modelCall: null,
    errorSubtype: null,
    errorClass: null,
    errorStatus: null,
    succeeded: null,
  };
}

export async function finishChatTrace<T>(draft: ChatTraceDraft, run: () => Promise<T>): Promise<T> {
  try {
    const value = await runChatTrace(draft, run);
    if (draft.succeeded === null) draft.succeeded = draft.errorSubtype === null;
    return value;
  } catch (error) {
    draft.succeeded = false;
    if (!draft.errorClass && error instanceof Error) draft.errorClass = error.name;
    throw error;
  } finally {
    scheduleChatTrace(draft);
  }
}

export function scheduleChatTrace(draft: ChatTraceDraft): void {
  void persistChatTrace(draft);
}

async function persistChatTrace(draft: ChatTraceDraft): Promise<void> {
  try {
    const model = draft.modelCall;
    const admin = getSupabaseAdmin();
    await admin.from("chat_traces").insert({
      conversation_id: draft.conversationId,
      message_id: draft.messageId,
      user_id: draft.userId,
      original_query: redactTraceText(draft.originalQuery),
      rewritten_query: draft.rewrittenQuery ? redactTraceText(draft.rewrittenQuery) : null,
      intent: draft.intent,
      retrieved: draft.retrieved,
      retrieval_count: draft.retrievalCount,
      prompt: draft.prompt,
      model: model?.model ?? null,
      max_tokens: model?.maxTokens ?? null,
      stop_reason: model?.stopReason ?? null,
      input_tokens: model?.inputTokens ?? null,
      output_tokens: model?.outputTokens ?? null,
      thinking_tokens: model?.thinkingTokens ?? null,
      cache_creation_input_tokens: model?.cacheCreationInputTokens ?? null,
      cache_read_input_tokens: model?.cacheReadInputTokens ?? null,
      first_token_ms: model?.firstTokenMs ?? null,
      latency_ms: model?.latencyMs ?? Date.now() - draft.startedAt,
      error_subtype: draft.errorSubtype,
      error_class: draft.errorClass,
      error_status: draft.errorStatus,
      form_in_progress: draft.formInProgress,
      slots: draft.slots ?? {},
      retryable: model?.retryable ?? false,
      retried: false,
      succeeded: draft.succeeded === true,
    });
  } catch {
    // Tracing never changes what the manager sees.
  }
}

export function traceIsOpen(): boolean {
  return chatTraceDraft() !== undefined;
}
