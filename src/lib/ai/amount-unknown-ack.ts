import { amountUnknownAckEnabled } from "@/lib/config/chat-quality-flags";
import { PAYROLL_AMOUNT_QUESTION } from "@/lib/forms/payroll-amount-field";

import { payrollAnswerThenAmountUnknown } from "./payroll-clause-not-account";

import type { AskRequest, AskResponse } from "./types";

/**
 * AMOUNT_UNKNOWN_ACK_ENABLED (QA live, 27 Oct 2026; same flag in both apps):
 * after "yes payroll deduct" and the amount question, "i dont know the amount"
 * got the card back with no word about it. With the flag on, a turn that only
 * says the amount is not known, right after the amount question, is answered:
 *
 *   Noted — I'll leave the **Payroll deduction amount** blank for you to fill on the form once you know it.
 *
 * under the payroll Yes line of the card. Nothing on the card changes.
 */
export const AMOUNT_UNKNOWN_ACK =
  "Noted — I'll leave the **Payroll deduction amount** blank for you to fill on the form once you know it.";

const UNKNOWN_AMOUNT =
  /^(?:i\s+)?(?:do\s*n['’]?t|do\s+not)\s+know(?:\s+(?:what\s+)?the)?\s+(?:amount|figure|total)|^(?:not\s+sure|unsure)\s+(?:of|about|what)\s+(?:the\s+)?(?:amount|figure|total)|^idk\s+(?:the\s+)?(?:amount|figure|total)/i;
const ASKED = /Payroll deduction amount\**\s*\?/;

type Turn = { readonly role: string; readonly content: string };

/** The last assistant turn asked for the Payroll deduction amount. */
export function askedTheAmount(history: readonly { readonly role: string; readonly content: unknown }[] | undefined): boolean {
  const lastAssistant = [...(history ?? [])].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  return ASKED.test(String(lastAssistant));
}

/**
 * The amount is not known, and the words are about payroll (QA's #1028 review, MEDIUM):
 * - a direct reply to the app's payroll-amount question that starts with the not-known words ("i dont know the
 *   amount", "not sure of the amount", "idk the amount"), main's reader;
 * - or the payroll answer then the not-known amount, and nothing else, in the same message ("yes payroll but I don't
 *   know the amount"; QA, batch J). The clause is anchored (AMOUNT_NOT_KNOWN), so "she was late, but I don't know the
 *   amount of time" and "she was $40 short, idk the total" are not.
 */
export function saysAmountUnknown(
  text: string,
  history: readonly { readonly role: string; readonly content: unknown }[] | undefined,
  options: { readonly amountOpen?: boolean } = {},
): boolean {
  const line = (text ?? "").trim().split("\n").pop()?.trim().replace(/[.!]+$/, "") ?? "";
  if (payrollAnswerThenAmountUnknown(line)) return true;
  /* `amountOpen`: the caller knows payroll is Yes and the amount is the open question (the agent loop, whose model asks it in its own words). */
  return line.length <= 60 && UNKNOWN_AMOUNT.test(line) && (options.amountOpen === true || askedTheAmount(history));
}

export function withAmountUnknownAck(response: AskResponse, request: AskRequest): AskResponse {
  if (!amountUnknownAckEnabled() || !response.formProposal || response.content.includes(AMOUNT_UNKNOWN_ACK)) return response;
  const history = (request.history ?? []) as readonly Turn[];
  if (!saysAmountUnknown(request.question, history)) return response;
  /*
   * Batch J (QA, 15 Nov 2026): "yes payroll but I don't know the amount" answers payroll and the amount in one
   * message, so the card's own amount question this turn is answered: the acknowledgement takes its place.
   */
  if (payrollAnswerThenAmountUnknown(request.question.trim().split("\n").pop() ?? "") && response.content.includes(PAYROLL_AMOUNT_QUESTION)) {
    return { ...response, content: response.content.replace(PAYROLL_AMOUNT_QUESTION, AMOUNT_UNKNOWN_ACK) };
  }
  if (!askedTheAmount(history)) return response;
  const lines = response.content.split("\n");
  const at = lines.findIndex((line) => /^Is payroll deduct applicable\? \*\*Yes\*\*/.test(line.trim()));
  const content = at < 0 ? `${response.content}\n\n${AMOUNT_UNKNOWN_ACK}` : [...lines.slice(0, at + 1), "", AMOUNT_UNKNOWN_ACK, ...lines.slice(at + 1)].join("\n");
  return { ...response, content };
}
