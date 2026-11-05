import { newPersonOwnWordsEnabled, newPersonRequestEnabled } from "@/lib/config/chat-quality-flags";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { withoutAppLines } from "./app-sentences";

/**
 * NEW_PERSON_REQUEST_ENABLED (QA, 30 Oct 2026; Pau: "OK"): with a card open
 * for one employee, "also create a ca for <another>, he was late on 10/20"
 * asked "Which of them is this Corrective Action Form for — <first> or
 * <another>?" and kept the first card; after Create, "now create a coaching
 * form for <another> …" made a Coaching card for the first employee. The
 * card was read from every turn of the conversation, so the first person
 * was still in it.
 *
 * A turn that asks to create a form for exactly one named person, when the
 * manager's earlier turns named only somebody else, starts a new form: the
 * card is read from that turn alone. Off, the whole conversation as before.
 */
export function startsFormForAnotherPerson(
  history: readonly { readonly role: string; readonly content: string }[],
  question: string,
): boolean {
  if (!newPersonRequestEnabled()) return false;
  /*
   * NEW_PERSON_OWN_WORDS_ENABLED (Pau via QA, 5 Nov 2026, sf-s22): "It needs
   * to be a CA, not a coaching form" reached here behind the stored state
   * ("The form is the Corrective Action Form. The employee is Wynne Sarrow."),
   * which read as a new request for her; the earlier turns named Tamsyn and
   * Corwen, so the card dropped the whole conversation and its Observation.
   * On, only the manager's own lines are read.
   */
  const said = newPersonOwnWordsEnabled() ? withoutAppLines(question) : question;
  const intent = detectTemplateIntent(said);
  const asksToCreate = intent.kind === "explicit" || (intent.kind === "corrective_action" && intent.requestedCreation);
  if (!asksToCreate) return false;
  const named = extractEmployeeNames(said);
  if (named.length !== 1) return false;
  const earlier = history.filter((turn) => turn.role === "user").flatMap((turn) => extractEmployeeNames(turn.content));
  return earlier.length > 0 && !earlier.some((name) => samePerson(name, named[0]!));
}
