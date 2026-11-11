import { listPolicyIsEditEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "PLEASE LIST THE POLICY" WITH A FORM OPEN IS AN EDIT, NOT A POLICY QUESTION
 * (LIST_POLICY_IS_EDIT_ENABLED, default off; QA, 8 Nov 2026)
 * ============================================================================
 *
 * With a draft open, a turn that was ONLY "please list the policy" (or "list the policy", "can you list the policy",
 * "add the policy") read as a question (QUESTION_NOT_FORM: `isQuestionNotForm`), so it skipped the edit paths and was
 * answered as a general policy question. EDIT_POLICY_ASK (`forms/edit-policy-ask.ts`) answers exactly that ask on the
 * open form, but only when the edit path gets the turn.
 *
 * With the flag on, a form open and the whole turn only asking to list, add, include, cite or show the policy on it,
 * the turn is not a question: the edit path takes it. A turn that asks about a policy ("what policy covers
 * lateness?", "does attendance fall under standards of conduct?") is still a question. Off, false.
 */
const LIST_POLICY =
  /^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:list|add|include|cite|show|state|put|quote|reference|attach)\s+(?:the|a|its|her|his|their)\s+(?:company\s+|manual(?:'s)?\s+)?polic(?:y|ies)(?:\s+(?:line|section))?(?:\s+(?:on|to|in|into)\s+(?:the|this|my|her|his|their)?\s*(?:form|draft|document|card|coaching(?:\s+form)?|it))?(?:\s+(?:too|also|as\s+well|please))?\s*[.!?]*$/i;

export function asksOnlyToListPolicy(question: string): boolean {
  return LIST_POLICY.test((question ?? "").trim().replace(/[‘’]/g, "'"));
}

/** A turn on an open form that only asks to list the policy: never a question. Off, false. */
export function listPolicyIsEdit(question: string, formOpen: boolean): boolean {
  return listPolicyIsEditEnabled() && formOpen && asksOnlyToListPolicy(question);
}

/*
 * ============================================================================
 * WITH ONLY A CARD OPEN (no draft yet): THE CARD SAYS WHERE THE POLICY GOES (QA, 8 Nov 2026, option b)
 * ============================================================================
 *
 * EDIT_POLICY_ASK writes to a draft, so on a card alone "please list the policy" stays a card turn: never a question,
 * the card proposed again from the manager's last turn, and, when the card shows no manual policy line of its own,
 * one sentence saying the policy is listed on the draft at Create. Never a "**Policy:**" line: the card's Policy
 * heading is read onto the draft (CARD_POLICY_TO_DRAFT), and this sentence names no policy.
 */
export const LISTED_AT_CREATE = "I'll list the manual's policy that matches what happened on the draft when you create it.";
const SHOWS_POLICY = /^\*\*Policy:\*\*|JBA Policy Manual(?: p\.\s?\d+)?/m;

interface CardTurn {
  readonly question: string;
  readonly history: readonly { readonly role: string; readonly content: string }[];
  readonly continueProposalTemplateKey?: string | null;
  readonly activeFormInstanceId?: string | null;
}

/** A card open, no draft, and the turn only asks to list the policy. Off, false. */
export function listPolicyOnCard(request: CardTurn): boolean {
  return listPolicyIsEdit(request.question, Boolean(request.continueProposalTemplateKey)) && !request.activeFormInstanceId;
}

/** The question the card is proposed again from: the manager's last turn before this one, or this one. */
export function cardRequestTurn(request: CardTurn): string {
  return request.history.filter((turn) => turn.role === "user").at(-1)?.content ?? request.question;
}

/** The card shows its manual policy line already, or gains the one sentence saying it goes on the draft. */
export function withPolicyListedAtCreate<T extends { content: string; formProposal?: unknown }>(response: T): T {
  if (!response.formProposal || SHOWS_POLICY.test(response.content) || response.content.includes(LISTED_AT_CREATE)) return response;
  return { ...response, content: `${response.content.trimEnd()}\n\n${LISTED_AT_CREATE}` };
}
