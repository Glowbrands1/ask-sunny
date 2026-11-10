import { cardComplaintNotAccountEnabled, createCommandPointsToCardEnabled, createFromConversationPointsToCardEnabled, createReplyPlainEnabled } from "@/lib/config/chat-quality-flags";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

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

function squeezed(question: string): string {
  return (question ?? "").replace(/\s+/g, " ").trim();
}

function kindOf(question: string): "create" | "outdated" | "wrong" | null {
  const text = squeezed(question);
  if (createCommandPointsToCardEnabled() && CREATE_COMMAND.test(text)) return "create";
  // CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED: "Create a form from this conversation." (P6).
  if (createCommandPointsToCardEnabled() && createFromConversationPointsToCardEnabled() && CREATE_FROM_CONVERSATION.test(text)) return "create";
  const complaint = cardComplaintNotAccountEnabled() ? COMPLAINT.exec(text) : null;
  if (!complaint) return null;
  return /^out\s+o[fd]\s+[dfs]ate$|outdated|^old$/i.test(complaint[1]!) ? "outdated" : "wrong";
}

/**
 * CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED (QA's CI eval, 10 Nov 2026): a wording only this flag reads ("Create a
 * form from this conversation.") was answered from the card in the history, which lacks what the turn's own re-read
 * fills — the exit card lost its Date (s8), the coaching card its Policy (s7). Such a turn is answered as before the
 * flag, the whole conversation re-read, and only the reply becomes the press-Create line.
 */
function rereadsCard(question: string, cardKey?: string): boolean {
  const text = squeezed(question);
  if (!createFromConversationPointsToCardEnabled() || CREATE_COMMAND.test(text)) return false;
  if (CREATE_FROM_CONVERSATION.test(text)) return true;
  return createReplyPlainEnabled() && namesTheCardsForm(text, cardKey);
}

/*
 * CREATE_REPLY_PLAIN_ENABLED (QA's Bubbles round-16b live test, 10 Nov 2026): "Create a Coaching Form from this
 * conversation." with a Coaching card on screen got the card's whole read-back again. With the flag on, a create
 * command that names the card's OWN form ("a Coaching Form", "a CA") followed by "from this conversation" and the like
 * points to the card too; another form named stays a request.
 */
const FORM_NAME = /\b(?:coaching|coach|corrective\s+action|c\.?\s?a\.?|c\/a|dpoa|write[- ]?up)(?:\s+(?:form|document))?\b/i;

function namesTheCardsForm(text: string, cardKey: string | undefined): boolean {
  if (!cardKey || !FORM_NAME.test(text)) return false;
  if (!CREATE_FROM_CONVERSATION.test(text.replace(FORM_NAME, "form"))) return false;
  const intent = detectTemplateIntent(text);
  const key = intent.kind === "explicit" ? intent.templateKey : intent.kind === "corrective_action" ? "dpoa" : null;
  return key === cardKey;
}

/** CREATE_REPLY_PLAIN_ENABLED: the reply says the card above is ready, and nothing else — never its read-back again. */
export function plainCreateLine(templateName: string | undefined): string {
  const form = templateName ? `**${templateName}** card` : "card";
  return `The ${form} above is ready — press **Create draft** on it to make the draft. Nothing is saved to anyone's file until you press it.`;
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
  // CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED: answered as before (the whole conversation re-read); the reply is set after (`withPressCreateReply`).
  if (rereadsCard(request.question, request.continueProposalTemplateKey)) return null;
  const kind = kindOf(request.question);
  if (!kind) return null;
  const fromTurn = [...(request.history ?? [])]
    .reverse()
    .find((turn) => turn.role === "user" && typeof turn.content === "string" && kindOf(turn.content) === null);
  const from = fromTurn?.content;
  if (!from) return null;
  const line = kind === "create" ? PRESS_CREATE : kind === "outdated" ? WHAT_IS_OUT_OF_DATE : WHAT_IS_WRONG;

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
 * CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED, the last step of the turn: "Create a form from this conversation."
 * with only a card open was answered as before — the whole conversation re-read, so the card keeps its Date and Policy
 * (QA's CI eval s7, s8) — and its reply leads with the press-Create line, the card's read-back (fields, cited policy)
 * kept under it. Off, or any other turn, as it was.
 */
export function withPressCreateReply<T extends { content: string; formProposal?: unknown }>(
  answer: T,
  request: Pick<AskRequest, "question" | "continueProposalTemplateKey" | "activeFormInstanceId">,
): T {
  if (!createCommandPointsToCardEnabled() || !request.continueProposalTemplateKey || request.activeFormInstanceId) return answer;
  if (!rereadsCard(request.question, request.continueProposalTemplateKey) || !answer.formProposal || answer.content.startsWith(PRESS_CREATE)) return answer;
  // CREATE_REPLY_PLAIN_ENABLED: one plain line; the card (its fields, as the re-read built them) is attached, not repeated.
  if (createReplyPlainEnabled()) {
    const name = (answer.formProposal as { templateName?: string }).templateName;
    return { ...answer, content: plainCreateLine(name) };
  }
  // The line leads; the card's own read-back (its fields, the policy it cites) stays under it, as the re-read wrote it.
  return { ...answer, content: `${PRESS_CREATE}\n\n${answer.content.trim()}` };
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
