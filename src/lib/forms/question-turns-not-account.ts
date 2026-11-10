import { questionTurnsNotAccountEnabled } from "@/lib/config/chat-quality-flags";
import { isQuestion } from "@/lib/forms/employment-change";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE QUESTIONS ASKED BEFORE THE REQUEST ARE NOT ITS ACCOUNT (QUESTION_TURNS_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * Pau, sf-s25 (5 Nov 2026): "closing policy" → "What policy would it be if a tanning consultant did not complete the
 * closing correctly and i have already talked to her about it" (both answered from the manual) → "Write a CA for <A>
 * she is TC … on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01 …". The card's Observation began with
 * the earlier question: the turns before the request were read as part of its account.
 *
 * With the flag on, when this turn asks for a form by name and no form card came before it in the chat, the earlier
 * manager turns that asked the app which policy or form applies ("what policy would it be …", a bare "<topic> policy") and the answers to them are left
 * out of the history the request is answered with. The stored conversation is unchanged. Pure.
 */

const TOPIC_QUERY = /^\s*(?:the\s+)?[a-z][a-z\s'-]{0,40}\s+polic(?:y|ies)\s*\??\s*$/i;
const ABOUT_POLICY = /\b(?:what|which)\s+(?:polic(?:y|ies)|section|form)\b|\bpolic(?:y|ies)\s+(?:would|should|does|is)\b|\bwhat\s+(?:would|does)\s+(?:it|this|that)\s+(?:be|fall)\b/i;
const CARD_REPLY = /Here is what I would put on a \*\*|I'll draft a \*\*|I can create a \*\*|\*\*(?:Corrective Action|Coaching|Exit|Resignation)[^*]*Form\*\* for \*\*/;

/** The turn asks for a form (named, or a corrective action / coaching one), whatever else it says. */
function asksForForm(turn: string): boolean {
  const intent = detectTemplateIntent(turn) as { kind: string; requestedCreation?: boolean };
  return intent.kind === "explicit" || intent.requestedCreation === true;
}

export function asksTheApp(turn: string): boolean {
  const said = turn.trim();
  // Only a question ABOUT the policy or the form: "can you help, she was late 3 times?" is still an account.
  return said !== "" && (TOPIC_QUERY.test(said) || (isQuestion(said) && ABOUT_POLICY.test(said))) && !asksForForm(said);
}

export function withoutQuestionsBeforeRequest(question: string, history: readonly ChatMessage[]): ChatMessage[] {
  if (!questionTurnsNotAccountEnabled() || !asksForForm(question)) return [...history];
  if (history.some((turn) => turn.role === "assistant" && typeof turn.content === "string" && CARD_REPLY.test(turn.content))) return [...history];
  const dropped = new Set<number>();
  history.forEach((turn, index) => {
    if (turn.role !== "user" || typeof turn.content !== "string" || !asksTheApp(turn.content)) return;
    dropped.add(index);
    if (history[index + 1]?.role === "assistant") dropped.add(index + 1);
  });
  return history.filter((_turn, index) => !dropped.has(index));
}
