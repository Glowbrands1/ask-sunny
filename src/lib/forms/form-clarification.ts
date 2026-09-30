import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * "COACHING GUIDANCE, OR A COACHING FORM?" — AND THE ANSWER TO IT
 * ============================================================================
 *
 * The question `proposeFormForTurn` asks when a manager writes "coach Avery"
 * (see `clarifyFormOrGuidance` there), and the reader for the reply that
 * chooses the form. Pure and separate from the orchestrator because
 * `answerQuestion` needs it BEFORE the forms branch runs: "the form" names no
 * form and carries no continuation, so without this the reply would never
 * reach the form path at all.
 *
 * What it confers is a routing decision and nothing else. The template key is
 * revalidated against the published library and the actor's permission, and
 * the employee is re-read from the manager's own turns, exactly as for a typed
 * request — so an assistant turn edited in browser storage gains nothing.
 */
export const FORM_OR_GUIDANCE_QUESTION = "Do you want coaching guidance, or do you want me to start a";

export const CLARIFIED_TEMPLATE_KEY = "coaching";

const CHOOSES_THE_FORM =
  /^(?:(?:yes|yeah|yep|ok|okay)[,.!\s]+)?(?:(?:the|a)\s+)?(?:(?:start|do|make|open)\s+(?:it|one|the\s+form|a\s+form)|form|forms|the\s+form|document(?:\s+it)?|paperwork|write[- ]?up|second(?:\s+one)?|option\s+(?:2|two|b)|2|the\s+latter)(?:\s+please)?[.!\s]*$/i;

/** Whether this turn answers the clarification above by choosing the form. */
export function answersFormClarification(
  history: readonly Pick<ChatMessage, "role" | "content" | "error">[],
  question: string,
): boolean {
  const last = [...history].reverse().find((message) => message.role === "assistant");
  if (!last || last.error || !last.content.startsWith(FORM_OR_GUIDANCE_QUESTION)) return false;
  return CHOOSES_THE_FORM.test(question.trim());
}
