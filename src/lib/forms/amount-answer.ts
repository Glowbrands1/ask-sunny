import { amountAnswerNotAccountEnabled } from "@/lib/config/chat-quality-flags";

/**
 * AMOUNT_ANSWER_NOT_ACCOUNT_ENABLED (QA, 27 Oct 2026, conv_mvqon26f2a5kvdh):
 * after "yes payroll deduct" and the amount question, "i dont know the
 * amount" was added to the card's Observation of Offense ("… the salon was
 * opened late i dont know the amount"). A turn that only answers the amount
 * ("i dont know the amount", "not sure of the amount", "idk the amount",
 * "$25") says nothing that happened, so it is no account text.
 */
const UNKNOWN_AMOUNT =
  /^(?:i\s+)?(?:do\s*n['’]?t|do\s+not)\s+know(?:\s+(?:what\s+)?the)?\s+(?:amount|figure|total)|^(?:not\s+sure|unsure)\s+(?:of|about|what)\s+(?:the\s+)?(?:amount|figure|total)|^idk\s+(?:the\s+)?(?:amount|figure|total)/i;
const AMOUNT = /^(?:it'?s\s+|about\s+|around\s+)?\$\s?\d[\d,]*(?:\.\d{2})?$/;

export function answersOnlyTheAmount(turn: string): boolean {
  const text = (turn ?? "").trim().replace(/[.!]+$/, "").trim();
  return text.length <= 60 && (UNKNOWN_AMOUNT.test(text) || AMOUNT.test(text));
}

/**
 * The manager turns an Observation is read from, without the lines that only
 * answer the amount (the routed turn carries the slot lines above the
 * manager's own words). Off, as given.
 */
export function withoutAmountAnswers(turns: readonly string[]): readonly string[] {
  if (!amountAnswerNotAccountEnabled()) return turns;
  return turns
    .map((turn) => turn.split("\n").filter((line) => !answersOnlyTheAmount(line)).join("\n"))
    .filter((turn) => turn.trim() !== "");
}
