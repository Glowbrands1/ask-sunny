import {
  cardComplaintNotAccountEnabled,
  copyPastePointsToCardEnabled,
  createCommandPointsToCardEnabled,
  createFromConversationPointsToCardEnabled,
} from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * A TURN ABOUT THE CARD ITSELF, WITH ONLY THE CARD OPEN (QA's sf-s38, 8 Nov 2026)
 * ============================================================================
 *
 * Sunny production, 7 Nov 2026: with a Corrective Action card open (no draft yet),
 *   - "create it" and "create  the draft" each sent the same proposal text again; the draft was only made by the
 *     card's button (CREATE_COMMAND_POINTS_TO_CARD_ENABLED);
 *   - "this proposal is out od fate" became the card's "**Observation of Offense:** this proposal is out od fate"
 *     (CARD_COMPLAINT_NOT_ACCOUNT_ENABLED).
 *
 * With its flag on, such a turn is answered as a turn about the card: the card on screen is kept exactly as it was
 * (its own source turns, so Create drafts from the account, never the complaint), or, with none in the history,
 * proposed again from the manager's last turn that was not one of these; and the reply is one line instead of the
 * card's text again: where to press, or what to change. The card stays attached, so its **Create draft** button is
 * still there. Off, null.
 */

export const PRESS_CREATE =
  "To create it, press **Create draft** on the card — I can't create the draft from a chat message. Nothing is saved to anyone's file until you press it.";
/** COPY_PASTE_POINTS_TO_CARD_ENABLED: "Do i need to copy and paste it?" with the card on screen. */
export const NOTHING_TO_COPY =
  "No — there's nothing to copy or paste. The card above already has it: press **Create draft** on it, and the draft opens here for you to edit. Nothing is saved to anyone's file until you press it.";
export const WHAT_IS_OUT_OF_DATE = "What on the proposal is out of date? Tell me what to change and I'll update the card.";
export const WHAT_IS_WRONG = "What on the proposal is wrong? Tell me what to change and I'll update the card.";

/** "create it", "create  the draft", "please create the form", "go ahead and create it", "make the draft". */
const CREATE_COMMAND =
  /^(?:(?:ok(?:ay)?|yes|yep|sure|great|thanks?)[,.!\s]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:go\s+ahead\s+(?:and\s+)?)?(?:create|make|start|generate|build|do)\s+(?:it|this|that|the\s+(?:draft|form|ca|corrective\s+action(?:\s+form)?|coaching(?:\s+form)?)|a\s+draft|(?:it|the\s+form)\s+(?:now|please))(?:\s+(?:now|please|for\s+me))?\s*[.!?]*$/i;

/*
 * CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED (QA's P6, Sunny live, 10 Nov 2026; the person invented): with a
 * Corrective Action card open and its payroll question asked, "Create a form from this conversation." got the same reply
 * word for word: CREATE_COMMAND reads "create it" / "create the draft", not "a form" nor "from this conversation". With
 * the flag on, a create command also reads "a form" / "a new draft" / "my form", with "from this conversation", "from our
 * chat", "based on this", "with this information" and the like after it. Only the generic nouns: a named form ("create
 * a coaching form") may be another form than the card's, and stays a request.
 */
const CREATE_FROM_CONVERSATION = new RegExp(
  String.raw`^(?:(?:ok(?:ay)?|yes|yep|sure|great|thanks?|perfect)[,.!\s]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:go\s+ahead\s+(?:and\s+)?)?(?:create|make|start|generate|build|do|draft|prepare)\s+(?:(?:a|the|this|that|my|our)\s+)?(?:new\s+)?(?:draft|form|it|this|that)` +
    String.raw`(?:\s+(?:(?:from|out\s+of|using|based\s+on|with)\s+(?:(?:this|the|our|that|all\s+(?:of\s+)?(?:this|that))\s*)(?:conversation|chat|discussion|thread|info(?:rmation)?|details)?|from\s+what\s+(?:we|i)\s+(?:discussed|talked\s+about|said|told\s+you)|now|please|for\s+me|here))*\s*[.!?]*$`,
  "i",
);

/** "this proposal is out od fate", "the card is wrong", "that form looks outdated". */
const COMPLAINT =
  /^(?:(?:but|hmm|um|uh|ok(?:ay)?)[,\s]+)?(?:this|that|the|your)\s+(?:proposal|card|form|draft)\s+(?:is|looks|seems|was)\s+(?:(?:all|still|kind\s+of|completely)\s+)?(out\s+o[fd]\s+[dfs]ate|outdated|old|wrong|incorrect|not\s+right|off)\s*[.!?]*$/i;

/**
 * COPY_PASTE_POINTS_TO_CARD_ENABLED (ported from Ask Bubbles, QA's 17i live test, 11 Nov 2026): "Do i need to copy and
 * paste it?", "do I have to copy it", "should I copy paste this into the form?", "where do I paste it?" — a question
 * about moving the card's text by hand.
 */
const COPY_QUESTION =
  /^(?:(?:so|ok(?:ay)?|and|wait)[,\s]+)?(?:(?:do|should|must|would|will)\s+i\s+(?:(?:need|have)\s+to\s+)?|(?:how|where)\s+do\s+i\s+|can\s+i\s+(?:just\s+)?)(?:copy(?:\s*(?:and|&|n|\/)?\s*paste)?|paste)\b[^?]{0,60}\??$/i;

function squeezed(question: string): string {
  return (question ?? "").replace(/\s+/g, " ").trim();
}

function kindOf(question: string): "create" | "copy" | "outdated" | "wrong" | null {
  const text = squeezed(question);
  if (copyPastePointsToCardEnabled() && COPY_QUESTION.test(text)) return "copy";
  if (createCommandPointsToCardEnabled() && CREATE_COMMAND.test(text)) return "create";
  // CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED: "Create a form from this conversation." (P6).
  if (createCommandPointsToCardEnabled() && createFromConversationPointsToCardEnabled() && CREATE_FROM_CONVERSATION.test(text)) return "create";
  const complaint = cardComplaintNotAccountEnabled() ? COMPLAINT.exec(text) : null;
  if (!complaint) return null;
  return /^out\s+o[fd]\s+[dfs]ate$|outdated|^old$/i.test(complaint[1]!) ? "outdated" : "wrong";
}

export interface CardMetaTurn {
  /** The card on screen, as it was (the last assistant turn's, for this template): the reply carries it unchanged. */
  readonly card: AskResponse | null;
  /** The manager's last turn that is not about the card itself: the card is proposed again from it when none is on screen. */
  readonly from: string;
  /** The reply: one line, with the card attached. */
  readonly answer: (again: AskResponse) => AskResponse;
}

/** A turn about the card itself, with only a card open (no draft). Off, or any other turn, null. */
export function cardMetaTurn(
  request: Pick<AskRequest, "question" | "history" | "continueProposalTemplateKey" | "activeFormInstanceId" | "questionMessageId">,
): CardMetaTurn | null {
  if (!request.continueProposalTemplateKey || request.activeFormInstanceId) return null;
  const kind = kindOf(request.question);
  if (!kind) return null;
  const fromTurn = [...(request.history ?? [])]
    .reverse()
    .find((turn) => turn.role === "user" && typeof turn.content === "string" && kindOf(turn.content) === null);
  const from = fromTurn?.content;
  if (!from) return null;
  const line = kind === "create" ? PRESS_CREATE : kind === "copy" ? NOTHING_TO_COPY : kind === "outdated" ? WHAT_IS_OUT_OF_DATE : WHAT_IS_WRONG;
  /*
   * The card as it was: its own source turns, so Create drafts from the account, never from "create it" or the
   * complaint (proposing it again from `from` would point the card at this turn).
   */
  const onScreen = [...(request.history ?? [])]
    .reverse()
    .find((turn) => turn.role === "assistant" && (turn as { formProposal?: AskResponse["formProposal"] }).formProposal?.templateKey === request.continueProposalTemplateKey) as
    | { formProposal?: AskResponse["formProposal"] }
    | undefined;
  const card: AskResponse | null = onScreen?.formProposal
    ? { content: line, citations: [], coverage: "not_applicable", recommendedVideoIds: [], formProposal: onScreen.formProposal }
    : null;
  return {
    card,
    from,
    /*
     * Proposed again from `from`, the card would point at this turn: Create drafts from the card's source turns, so
     * they are the account's, never "create it" or the complaint.
     */
    answer: (again) => {
      if (!again.formProposal) return again;
      const ids = (again.formProposal.sourceMessageIds ?? []).filter((id) => id !== request.questionMessageId);
      const sourceMessageIds = fromTurn?.id && !ids.includes(fromTurn.id) ? [...ids, fromTurn.id] : ids;
      return { ...again, content: line, formProposal: { ...again.formProposal, sourceMessageIds } };
    },
  };
}

/**
 * At Create (the draft route's notes, the manager's turns one per line or paragraph): a turn that is only "create it"
 * or only a complaint about the card is no account, so it never becomes what the manager described. Each kind only
 * with its own flag. Off, the text as given.
 */
export function withoutCardMetaTurns(notes: string): string {
  if (!createCommandPointsToCardEnabled() && !cardComplaintNotAccountEnabled()) return notes;
  return (notes ?? "")
    .split("\n")
    .filter((line) => line.trim() === "" || kindOf(line) === null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
