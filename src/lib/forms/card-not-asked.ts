import type { AskResponse } from "@/lib/ai/types";
import { twoFormsCardNotAskedEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A CARD THAT HAS ITS EMPLOYEE IS NEVER ASKED "WHICH OF THEM"
 * ============================================================================
 *
 * TWO_FORMS_CARD_NOT_ASKED_ENABLED (QA, 8 Nov 2026, live check conv ef902fec after round 4; default off). "Coaching
 * form for <A>. Also a CA for <B>." made the Coaching card for A (status ready) and offered B's Corrective Action,
 * but the reply above the card still asked "Which of them is this **Coaching Form** for — **<A>** or **<B>**?". The
 * replay pack's readers do not reach that reply today (the live one came from the models' reading of the names), so
 * this is a guard on the final reply, whatever wrote it: when the card names its employee and a "Which of them is
 * this **<the card's form>** for — …?" line offers that same employee as a choice, the line is left out. A card with
 * no employee keeps its question; a choice that does not include the card's employee is kept. Pure; off, as before.
 */
const WHICH_LINE = /^Which of them is this \*\*([^*\n]+)\*\* for — (.+?)\?(?: Tell me and I'll draft it from what you've already described\.)?$/;

function choices(list: string): string[] {
  return [...list.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim().toLowerCase());
}

export function withoutWhichAskOnSeatedCard(answer: AskResponse): AskResponse {
  if (!twoFormsCardNotAskedEnabled()) return answer;
  const card = answer.formProposal;
  const employee = card?.employeeName?.trim();
  if (!card || !employee || card.subject === "team" || card.status === "needs_employee") return answer;
  const form = (card.templateName ?? "").trim().toLowerCase();
  const lines = answer.content.split("\n");
  const kept = lines.filter((line) => {
    const which = WHICH_LINE.exec(line.trim());
    return !(which && which[1]!.trim().toLowerCase() === form && choices(which[2]!).includes(employee.toLowerCase()));
  });
  if (kept.length === lines.length) return answer;
  return { ...answer, content: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}
