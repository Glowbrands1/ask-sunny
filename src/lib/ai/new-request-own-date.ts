import { newRequestOwnDateEnabled } from "@/lib/config/chat-quality-flags";
import { datesInText } from "@/lib/forms/form-date-answer";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

/**
 * NEW_REQUEST_OWN_DATE_ENABLED (QA, live, 30 Oct 2026): "create a ca for
 * <name> … she was late on 10/20." then "also create a ca for <name>, she was
 * late on 10/21" left the new card with no Date — the date readers saw two
 * incident dates across the chat and set none — and Create filed the form
 * dated today. A turn that asks to create a form and states its own date is
 * dated by that turn alone. Off, as before.
 */
export function newRequestWithOwnDate(question: string, today: string): boolean {
  if (!newRequestOwnDateEnabled()) return false;
  const intent = detectTemplateIntent(question);
  const asksToCreate = intent.kind === "explicit" || (intent.kind === "corrective_action" && intent.requestedCreation);
  return asksToCreate && datesInText(question, today).length > 0;
}
