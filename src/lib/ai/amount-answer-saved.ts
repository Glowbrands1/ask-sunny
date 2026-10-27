import { amountAnswerSavedEnabled } from "@/lib/config/chat-quality-flags";
import { PAYROLL_AMOUNT_LABEL } from "@/lib/forms/payroll-amount-field";
import { payrollAmountReply } from "@/lib/forms/payroll-deduct";

import type { AskRequest, AskResponse } from "./types";

/**
 * AMOUNT_ANSWER_SAVED_ENABLED (QA, 27 Oct 2026, conv_mvqon20g24chpan): after
 * "yes payroll deduct" and "**Payroll deduction amount**?", the manager's
 * "$25" was not read back and the card's payrollDeductAmount stayed null
 * (Create still saved it: the instance route reads the conversation). The turn
 * the form path reads has the slot lines above the manager's words ("… Payroll
 * amount: 25.\n$25"), so the bare-figure reader, which wants the whole turn
 * to be the figure, did not see it. With the flag on, the manager's own last
 * line is read the same way: a bare figure right after the amount question,
 * on a card with payroll Yes and no amount yet, is the amount. It is read
 * back and goes to Create with the card. A figure inside a longer sentence is
 * left to the readers that already handle it.
 */
type Turn = { readonly role: string; readonly content: string };

export function withStatedAmount(response: AskResponse, request: AskRequest): AskResponse {
  if (!amountAnswerSavedEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || proposal.payrollDeduct !== "yes" || proposal.payrollDeductAmount) return response;
  const history = (request.history ?? []) as readonly Turn[];
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const said = (request.question ?? "").trim().split("\n").pop() ?? "";
  const figure = payrollAmountReply(said, lastAssistant);
  if (!figure) return response;
  const line = `**${PAYROLL_AMOUNT_LABEL}:** ${figure} — tell me if that should change.`;
  const lines = response.content.split("\n");
  const at = lines.findIndex((text) => /^Is payroll deduct applicable\? \*\*Yes\*\*/.test(text.trim()));
  const content = at < 0 ? `${response.content}\n\n${line}` : [...lines.slice(0, at + 1), "", line, ...lines.slice(at + 1)].join("\n");
  return { ...response, content, formProposal: { ...proposal, payrollDeductAmount: figure } };
}
