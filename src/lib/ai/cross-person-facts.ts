import { crossPersonFreshFactsEnabled } from "@/lib/config/chat-quality-flags";
import { statedPayrollDeduct } from "@/lib/forms/payroll-deduct-answer";

import type { AskRequest, AskResponse } from "./types";

/*
 * ============================================================================
 * A NEW PERSON'S CARD NEVER KEEPS THE LAST PERSON'S DATE OR PAYROLL ANSWER (CROSS_PERSON_FRESH_FACTS_ENABLED)
 * ============================================================================
 *
 * conv_mvoetxo92fraflz (#236, 25 Oct 2026; still live per the October triage, 10 Nov 2026): "create a coaching document
 * for <A> regarding On 10-16-26 … did not complete required policy acknowledgements …", then "create a coaching
 * document for <B>": <B>'s card kept <A>'s Date, 10/16/2026. In the sibling app <A>'s payroll answer carried the same
 * way (Ask Bubbles #166). The card's date and payroll answer are read over the chat's turns for this form, and <A>'s
 * request is one of them.
 *
 * With the flag on, last on a card turn: when this turn starts another person's card (<B> first named here, an earlier
 * manager turn naming someone else on the roster), the card keeps a date or a payroll answer only when this turn says
 * one. Otherwise the Date line goes and the payroll read-back becomes the payroll question again. Off, the reply as built.
 */

const norm = (name: string | null | undefined): string => (name ?? "").toLowerCase().replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

/** A date in the turn's words: "10-16-26", "10/16", "on monday", "yesterday", "today". */
const SAYS_A_DATE =
  /\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b(?:today|yesterday|tonight|this\s+morning|last\s+(?:night|week|shift)|(?:on\s+)?(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;

const PAYROLL_READ_BACK = /^Is payroll deduct applicable\? \*\*(?:Yes|No)\*\* — tell me if that should change\.$/m;
const PAYROLL_QUESTION = "One more question: **Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.";
const PAYROLL_LINE = /^\*\*Payroll deduction:\*\*[^\n]*\n?/m;
const DATE_LINE = /^\*\*Date:\*\*[^\n]*\n?/m;

/**
 * CROSS_PERSON_FRESH_FACTS_ENABLED, last on a card turn: the card before this one was another person's, so the date and
 * payroll answer this card carries are kept only when this turn states them. Otherwise they are cleared from the card
 * and from its text — the Date line goes, and the payroll answer read back becomes the payroll question again. Off, or the
 * same person, the reply as built.
 */
/**
 * Whether this turn starts another person's card: the card's person is first named in this turn, and an earlier manager
 * turn names a different person on the roster (the chat's earlier card). The request's history carries no cards, so
 * the earlier person is read from the manager's own words.
 */
function startsAnotherPersonsCard(
  name: string,
  request: Pick<AskRequest, "history" | "question">,
  roster: readonly { readonly firstName: string; readonly lastName: string }[],
): boolean {
  const own = norm(name);
  const has = (text: string, full: string) => ` ${norm(text)} `.includes(` ${full} `);
  if (!has(request.question ?? "", own)) return false;
  const earlier = request.history.filter((turn) => turn.role === "user").map((turn) => String(turn.content));
  if (earlier.some((turn) => has(turn, own))) return false;
  return roster
    .map((person) => norm(`${person.firstName} ${person.lastName}`))
    .some((full) => full && full !== own && earlier.some((turn) => has(turn, full)));
}

export function withFreshPersonFacts(
  response: AskResponse,
  request: Pick<AskRequest, "history" | "question">,
  roster: readonly { readonly firstName: string; readonly lastName: string }[] = [],
): AskResponse {
  if (!crossPersonFreshFactsEnabled()) return response;
  const card = response.formProposal;
  if (!card?.employeeName || !startsAnotherPersonsCard(card.employeeName, request, roster)) return response;
  const own = request.question ?? "";
  let content = response.content;
  let next = card;
  if (next.formDate && !SAYS_A_DATE.test(own)) {
    next = { ...next, formDate: null };
    content = content.replace(DATE_LINE, "");
  }
  if (next.payrollDeduct && statedPayrollDeduct(own) === null) {
    next = { ...next, payrollDeduct: null };
    content = content.replace(PAYROLL_READ_BACK, PAYROLL_QUESTION).replace(PAYROLL_LINE, "");
  }
  if (next === card) return response;
  return { ...response, content: content.replace(/\n{3,}/g, "\n\n").trim(), formProposal: next };
}
