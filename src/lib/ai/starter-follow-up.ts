import { starterFollowUpExampleEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * A STARTER QUESTION'S FOLLOW-UP IS EASY TO ANSWER (STARTER_FOLLOW_UP_EXAMPLE_ENABLED, default off; QA item 24)
 * ============================================================================
 *
 * The production audit (20 Nov 2026): managers tapped the home starter "Create a coaching form." or "Show me training
 * related to this issue." with nothing else said; Sunny asked who, or which issue, and three managers left. With the
 * flag on, when the starter is the chat's first message, its follow-up question carries one short example of an answer:
 *   - "Create a coaching form." → after "Who is this **Coaching Form** for? …": For example: "coaching for <name> on
 *     greeting guests".
 *   - "Show me training related to this issue." → when the reply showed no training and asks which: For example:
 *     "training on greeting guests" or "training on selling lotion".
 * Keyed to the app's own starter text (`QUICK_QUESTIONS`), never to a manager's own words. Nothing else changes. Off, as
 * before.
 */
export const COACHING_STARTER = "Create a coaching form.";
export const TRAINING_STARTER = "Show me training related to this issue.";

const COACHING_EXAMPLE = 'For example: "coaching for <name> on greeting guests".';
const TRAINING_EXAMPLE = 'For example: "training on greeting guests" or "training on selling lotion".';
/* The app's own who-questions: "Who is this **Coaching Form** for? …" and "Who is this form for? Tell me …". */
const WHO_QUESTION = /Who is this (?:\*\*[^*]+\*\*|form) for\?[^\n]*/;

export function withStarterFollowUp(response: AskResponse, request: AskRequest): AskResponse {
  if (!starterFollowUpExampleEnabled()) return response;
  const firstMessage = !(request.history ?? []).some((turn) => turn.role === "user");
  if (!firstMessage) return response;
  const asked = request.question.trim();
  if (asked === COACHING_STARTER && !response.formProposal?.employeeName) {
    const who = WHO_QUESTION.exec(response.content);
    if (!who || response.content.includes(COACHING_EXAMPLE)) return response;
    return { ...response, content: response.content.replace(who[0], `${who[0]}\n\n${COACHING_EXAMPLE}`) };
  }
  if (asked === TRAINING_STARTER) {
    const showedTraining = (response.recommendedVideoIds?.length ?? 0) > 0 || (response.citations?.length ?? 0) > 0;
    if (showedTraining || !response.content.trim().endsWith("?") || response.content.includes(TRAINING_EXAMPLE)) return response;
    return { ...response, content: `${response.content.trim()}\n\n${TRAINING_EXAMPLE}` };
  }
  return response;
}
