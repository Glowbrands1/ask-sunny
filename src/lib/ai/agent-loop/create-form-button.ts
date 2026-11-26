import { createFormButtonPicksFormEnabled } from "@/lib/config/chat-quality-flags";
import { CREATE_FORM_FROM_CONVERSATION } from "@/lib/forms/proposal-continuation";

/**
 * ============================================================================
 * "CREATE A FORM FROM THIS CONVERSATION" PICKS THE FORM (CREATE_FORM_BUTTON_PICKS_FORM; Pau, 25 Nov 2026)
 * ============================================================================
 *
 * A manager's live chat about an employee's transfer: they pressed the rail's "Create a form from this conversation"
 * three times. The loop told them to press **Create draft** themselves, with no card under its reply, and then that "no
 * new card was made because a draft was already open". The manager could not tell whether a card was there at all. Pau:
 * "can we ask ai to detect what form the manager needs when we press 'Create a form from this conversation'?"
 *
 * The button sends the app's own sentence (`CREATE_FORM_FROM_CONVERSATION`), so the turn is known by that sentence, never
 * by reading what the manager meant. With the flag on, the loop's turn facts say the button was pressed and what is on
 * screen, and the model works out which form the conversation needs and makes its card. A turn that ends with a card on
 * screen and none under this reply is handed back once, so the reply always carries the card it points to. Off, null.
 */

function squeezed(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").toLowerCase();
}

const BUTTON = squeezed(CREATE_FORM_FROM_CONVERSATION);

/** The rail's button sent this turn (its own sentence; the trailing full stop optional). Off, false. */
export function isCreateFormButtonTurn(question: string): boolean {
  return createFormButtonPicksFormEnabled() && squeezed(question) === BUTTON;
}

export type CreateFormButtonScreen =
  /** A draft is open on the manager's screen. */
  | { readonly kind: "draft_open" }
  /** The last reply's card, not yet created, is on screen. */
  | { readonly kind: "card_open"; readonly form: string | null }
  /** Nothing is on screen yet. */
  | { readonly kind: "nothing" };

/** The turn fact for the loop's system prompt (`agentLoopSystem`). */
export function createFormButtonLine(screen: CreateFormButtonScreen, formsPageName: string): string {
  const head =
    "create_form_button: the manager pressed the app's \"Create a form from this conversation\" button. They want you to work out which form this conversation needs and make it. Never tell them to press Create draft unless THIS reply carries a card (propose_form this turn), and never ask which form when one in the list fits what the conversation is about.";
  if (screen.kind === "draft_open") {
    return `${head} A draft is open on their screen (the instance_id above): make no new card for that form and person. Read it with read_form, then say in one line which form is open and who it is for, that it is the draft on their screen, saved as a draft in ${formsPageName}, and that nothing new was made; end by asking what they want added to it. When the conversation is about a different person, propose that person's form instead.`;
  }
  if (screen.kind === "card_open") {
    const form = screen.form ? `the ${screen.form} card` : "the card";
    return `${head} ${form[0]!.toUpperCase()}${form.slice(1)} from your last reply is on their screen and not created yet: that is the form this conversation asked for. Call propose_form for it again now, with the same form, person and everything it already has (the account, the date, the level), so the card is under this reply. Then say in one line which card it is and who it is for, and to press **Create draft** on it to save the draft.`;
  }
  return `${head} Nothing is on their screen yet. Read the whole conversation: who it is about, what happened, and what the manager is trying to do. Pick the one form in the list above that fits it and call propose_form for it, with the person and the account the conversation gave. Say in one line which form you picked and why, in a few words. If the person is missing, ask only who it is for, naming the form you picked. If two forms fit equally, ask which, naming both. If no form in the list fits, say so plainly and name the forms that are.`;
}

/**
 * The hand-back when the button's turn ends with a card on screen and none under this reply (the live model said "press
 * Create draft" with nothing to press). One more model call, with this note.
 */
export function createFormButtonNoCardNote(form: string | null): string {
  return `[app check] The manager pressed "Create a form from this conversation" with ${form ? `the ${form} card` : "a card"} on screen, and your reply shows no card, so there is nothing under it to press. Call propose_form for that card again now (the same form, person and account the chat shows), then say in one line which card it is and to press **Create draft** on it.`;
}
