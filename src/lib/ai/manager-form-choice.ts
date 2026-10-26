import { managerFormChoiceEnabled } from "@/lib/config/chat-quality-flags";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import type { AskRequest } from "./types";

/**
 * MANAGER_FORM_CHOICE_ENABLED: the form the manager named is the form.
 *
 * Ask Bubbles conv_mvofmpei2c50lhp, 25 Oct 2026: "an employee opened the
 * store 15 min late and needs CA" and "write ca" were answered as questions
 * about the process — the reply argued a Coaching Form was the right tool and
 * no card came — and the "Create a form from this conversation." button
 * then asked "Which form do you need?" although the manager had named the
 * Corrective Action twice. The same reading is in Ask Sunny.
 *
 * On, before the turn is read:
 *   - "needs CA", "write ca", "do a CA" ask for the Corrective Action Form, as
 *     "needs a CA" already does; the turn is read as that request;
 *   - a request for "a form" that names none uses the form the manager last
 *     named in this chat, Corrective Action or Coaching.
 * A turn that names a form, or a chat where the manager named none, is read as
 * typed. Off, every turn is read as typed.
 *
 * The same file in Ask Bubbles.
 */

const NEEDS_CA = /\b(?:needs?|write|do|file)\s+(?:an?\s+|the\s+)?(?:ca|c\/a|corrective\s+actions?)\b(?!\s+(?:policy|process|step))/i;
const GENERIC_FORM =
  /^\s*(?:please\s+)?(?:create|make|build|draft|start|generate|do)\s+(?:me\s+)?(?:a|the)\s+form(?:\s+(?:from|out\s+of|with)\s+(?:this|the)\s+(?:conversation|chat))?\s*[.!]?\s*$/i;

const NAMED: Record<string, string> = {
  dpoa: "Corrective Action Form",
  coaching: "Coaching Form",
};

export function withManagerFormChoice(request: AskRequest): AskRequest {
  if (!managerFormChoiceEnabled()) return request;
  const question = chosenFormQuestion(
    request.question,
    request.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
  );
  return question === request.question ? request : { ...request, question };
}

/** The turn as the request for the form the manager chose, or as typed. */
export function chosenFormQuestion(question: string, earlier: readonly string[]): string {
  const reading = detectTemplateIntent(question);
  if (reading.kind === "corrective_action" && !reading.requestedCreation && NEEDS_CA.test(question)) {
    return `Create a Corrective Action Form. ${question}`;
  }
  if (reading.kind === "ambiguous" && GENERIC_FORM.test(question)) {
    const named = lastNamedForm(earlier);
    if (named) return `Create a ${NAMED[named]} from this conversation.`;
  }
  return question;
}

function lastNamedForm(turns: readonly string[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const reading = detectTemplateIntent(turns[index]!);
    if (reading.kind === "explicit" && NAMED[reading.templateKey]) return reading.templateKey;
    if (reading.kind === "corrective_action" && (reading.requestedCreation || NEEDS_CA.test(turns[index]!))) return "dpoa";
  }
  return null;
}
