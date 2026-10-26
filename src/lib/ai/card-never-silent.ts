import { cardNeverSilentEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * CARD_NEVER_SILENT_ENABLED: a form turn always answers the manager.
 *
 * Ask Sunny conv_mvoenhk42lu3cxo, 25 Oct 2026: "i verified everythign i jsut
 * need to finalize it", "i need to edit this can you make it to where i can
 * edit", "can you make the form the same way again" and "Create a Corrective
 * Action Form from this conversation." were each answered with the card
 * reply word for word as before, so nothing the manager asked was answered.
 *
 * When the reply on a card turn is empty or the same as the previous reply,
 * one line in front of it answers the turn: how to edit and finalize (press
 * Create draft; the form opens for editing; Finalize is a button on the
 * form), or what the card still needs. Any other reply is returned as it is.
 * The card itself is not touched.
 *
 * The same file in Ask Bubbles.
 */

const FINALIZE = /\b(?:finali[sz]e|finish(?:ed)?|submit|sign(?:ed)?|verified|done|complete\s+(?:it|this|the\s+form))\b/i;
const EDIT = /\b(?:edit(?:able)?|change|fix|update|correct|adjust)\b/i;
const MAKE =
  /^(?:y|yes|yeah|yep|yup|ok(?:ay)?|sure|please|go\s+ahead|do\s+it|just\s+(?:make|do|create)\s+it)\b|\b(?:make|create|generate|build|draft|do|redo)\b/i;

export const CREATE_DRAFT_LINE =
  "Press **Create draft** on the card below. The form then opens right here for editing, and **Finalize** is a button on the form once you've checked it.";
const EDIT_LINE =
  "To edit it, press **Create draft** on the card below. The form opens right here and every field can be changed; **Finalize** is a button on the form when you're done.";
const UNCHANGED_LINE =
  "Nothing on the card changed with that message. Tell me what to change, or press **Create draft** below to open the form and edit it there.";
const NEEDS_LINE = "The card below still needs what it asks for before the draft can be created. Tell me here, and I'll fill it in.";

export function withCardNeverSilent(response: AskResponse, request: AskRequest): AskResponse {
  if (!cardNeverSilentEnabled()) return response;
  return speakOnCardTurn({ response, question: request.question, history: request.history });
}

export function speakOnCardTurn(input: {
  readonly response: AskResponse;
  readonly question: string;
  readonly history: readonly { readonly role: string; readonly content: string }[];
}): AskResponse {
  const proposal = input.response.formProposal;
  if (!proposal || input.response.formOpened) return input.response;
  const content = input.response.content ?? "";
  const previous = [...input.history].reverse().find((turn) => turn.role === "assistant");
  const silent = !content.trim() || (previous !== undefined && same(previous.content, content));
  if (!silent) return input.response;
  const line = BARE_FORM_WORD.test(input.question.trim())
    ? bareFormLine(proposal.templateName)
    : answerLine(input.question, proposal.status === "ready" && proposal.supportsInlineDraft);
  return { ...input.response, content: content.trim() ? `${line}\n\n${content.trim()}` : line };
}

function same(a: string, b: string): boolean {
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  return flat(a) === flat(b);
}

/**
 * QA, 26 Oct 2026 (both apps): "ca" alone opened a blank card with no text.
 * A turn that is only a form word asks for the facts the form needs.
 */
const BARE_FORM_WORD = /^(?:(?:a|an|new)\s+)?(?:ca|c\/a|dpoa|coach|coaching|exit|write\s*up|corrective\s+action)(?:\s+form)?[.!?]*$/i;

function bareFormLine(templateName: string): string {
  return `Who is this **${templateName}** for, and what happened? Tell me their name, the date and what they did, and I'll fill in the card.`;
}

/** QA-6/QA-7, 26 Oct 2026: "don't finalize", "do not make it", "no edit please", "I haven't verified it yet". */
const NEGATED = /\b(?:not|never|no|don'?t|do\s+not|haven'?t|have\s+not|isn'?t|without)\b/i;

/**
 * QA-4, 26 Oct 2026: "don't edit it, finalize it", "I haven't verified it yet
 * but finalize it", "not yet, i need to edit it first". Negation is read per
 * clause: a negated verb never counts, a positive verb in another clause of
 * the same turn still does.
 */
const CLAUSE = /\s*(?:[,;.!?]+|\s-\s|\b(?:but|and|then|so)\b)\s*/i;

function answerLine(question: string, canCreate: boolean): string {
  if (!canCreate) return NEEDS_LINE;
  const clauses = question
    .trim()
    .split(CLAUSE)
    .map((clause) => clause.trim())
    .filter(Boolean);
  // A clause that says not to finalize, make or edit is a change that did not happen.
  const asked = clauses.filter((clause) => !NEGATED.test(clause));
  if (asked.some((clause) => FINALIZE.test(clause))) return CREATE_DRAFT_LINE;
  if (asked.some((clause) => EDIT.test(clause))) return EDIT_LINE;
  if (asked.some((clause) => MAKE.test(clause))) return CREATE_DRAFT_LINE;
  return UNCHANGED_LINE;
}
