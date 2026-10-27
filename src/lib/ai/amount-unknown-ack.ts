import { amountUnknownAckEnabled } from "@/lib/config/chat-quality-flags";

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

/** "i dont know the amount", "not sure of the amount", "idk the amount". */
export function saysAmountUnknown(text: string): boolean {
  const line = (text ?? "").trim().split("\n").pop()?.trim().replace(/[.!]+$/, "") ?? "";
  return line.length <= 60 && UNKNOWN_AMOUNT.test(line);
}

export function withAmountUnknownAck(response: AskResponse, request: AskRequest): AskResponse {
  if (!amountUnknownAckEnabled() || !response.formProposal || response.content.includes(AMOUNT_UNKNOWN_ACK)) return response;
  if (!saysAmountUnknown(request.question)) return response;
  const history = (request.history ?? []) as readonly Turn[];
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  if (!ASKED.test(lastAssistant)) return response;
  const lines = response.content.split("\n");
  const at = lines.findIndex((line) => /^Is payroll deduct applicable\? \*\*Yes\*\*/.test(line.trim()));
  const content = at < 0 ? `${response.content}\n\n${AMOUNT_UNKNOWN_ACK}` : [...lines.slice(0, at + 1), "", AMOUNT_UNKNOWN_ACK, ...lines.slice(at + 1)].join("\n");
  return { ...response, content };
}
