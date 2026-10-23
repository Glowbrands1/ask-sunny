import "server-only";

import { fewShotExamplesEnabled } from "@/lib/config/chat-quality-flags";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { fewShotPrompt, scopeForExchange, selectFewShot, type RatedExchange } from "./feedback-replay";

/**
 * Highly rated past exchanges for this company, as examples.
 *
 * The flag is off: nothing is read and the prompt is unchanged. A missing
 * table or a failed read returns an empty block. This file only selects.
 */

export async function fewShotBlock(input: { readonly question: string; readonly scopeId: string }): Promise<string> {
  if (!fewShotExamplesEnabled()) return "";
  try {
    const exchanges = await loadHighRatedExchanges(input.scopeId);
    return fewShotPrompt(selectFewShot({ question: input.question, scopeId: input.scopeId, exchanges }));
  } catch {
    return "";
  }
}

async function loadHighRatedExchanges(scopeId: string): Promise<RatedExchange[]> {
  if (!scopeId) return [];
  const supabase = getSupabaseAdmin();
  const { data: ratings, error } = await supabase
    .from("ask_sunny_feedback")
    .select("rating, activity_event_id")
    .gte("rating", 5)
    .limit(100);
  if (error || !ratings || ratings.length === 0) return [];
  const ids = ratings
    .map((row) => (typeof row.activity_event_id === "string" ? row.activity_event_id : ""))
    .filter((id) => id !== "");
  if (ids.length === 0) return [];
  const { data: answers, error: answerError } = await supabase
    .from("chat_messages")
    .select("conversation_id, position, role, content, turn_id, metadata")
    .in("turn_id", ids);
  if (answerError || !answers) return [];
  const conversationIds = [...new Set(answers.map((row) => String(row.conversation_id)))];
  const { data: messages, error: messageError } = await supabase
    .from("chat_messages")
    .select("conversation_id, position, role, content, turn_id")
    .in("conversation_id", conversationIds);
  if (messageError || !messages) return [];

  const byTurn = new Map(ratings.map((row) => [String(row.activity_event_id), Number(row.rating)]));
  const exchanges: RatedExchange[] = [];
  for (const answer of answers) {
    if (answer.role !== "assistant") continue;
    const scope = scopeForExchange(answer.metadata, scopeId);
    if (!scope) continue;
    const rating = byTurn.get(String(answer.turn_id));
    if (rating === undefined || rating < 5) continue;
    const question = messages
      .filter(
        (message) =>
          message.conversation_id === answer.conversation_id &&
          message.role === "user" &&
          Number(message.position) < Number(answer.position),
      )
      .sort((a, b) => Number(b.position) - Number(a.position))[0];
    if (!question || typeof question.content !== "string" || typeof answer.content !== "string") continue;
    exchanges.push({
      id: String(answer.turn_id),
      rating,
      scopeId: scope,
      question: question.content,
      answer: answer.content,
    });
  }
  return exchanges;
}
