import { cardNamesEmployeeEnabled, didYouMeanStaysAskedEnabled, observationOwnPersonOnlyEnabled, oneFormEachPersonEnabled } from "@/lib/config/chat-quality-flags";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

import { peopleRequest } from "./two-forms-own-person";

/*
 * ============================================================================
 * AN UNANSWERED "DID YOU MEAN …?" IS ASKED AGAIN, AND A CARD NAMES ITS EMPLOYEE (QA's P7, Sunny live on the 13b chat code,
 * 10 Nov 2026; the people invented)
 * ============================================================================
 *
 * "Make me a coaching form for <A>, <B>, and <C> …" → "Did you mean <A> <s1> or <A> <s2>?" → "create draft for failure to
 * do closing duties and staying over hours" (which picks neither) gave a card for <A> <s1>, and its reply said "I have
 * the employee" without saying who.
 *
 * DID_YOU_MEAN_STAYS_ASKED_ENABLED: when the assistant's last message asked "Did you mean …?" and the manager's turn
 * picks none of the people it offered (by full name, last name, or "the first/second"), a card for one of them loses
 * its employee and the question is asked again. CARD_NAMES_EMPLOYEE_ENABLED: "I have the employee" on a card's reply
 * becomes "I have **<name>**". Both pure, the last steps of the turn; off, as before.
 */

type Turn = { readonly role: string; readonly content: string };

interface CardLike {
  employeeName: string | null;
  employeeRole?: string | null;
  status: string;
  supportsInlineDraft?: boolean;
}

const ASKED = /Did you mean ((?:\*\*[^*]+\*\*)(?:(?:, | or )\*\*[^*]+\*\*)+)\?[^\n]*/;
const NEXT_LINE = /^\*\*Next:\*\* [^\n]+$/m;
const ORDINALS = [/\b(?:first|1st|#?1)\b/i, /\b(?:second|2nd|#?2)\b/i, /\b(?:third|3rd|#?3)\b/i];

function fold(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\s'-]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** The manager's turn picks one of the offered people: their full name, their last name, or its place in the list. */
function picks(question: string, options: readonly string[]): boolean {
  const said = ` ${fold(question)} `;
  return options.some((option, index) => {
    const name = fold(option);
    const last = name.split(" ").pop() ?? "";
    return said.includes(` ${name} `) || (last.length > 1 && said.includes(` ${last} `)) || (ORDINALS[index]?.test(question) ?? false);
  });
}

export function withDidYouMeanStillAsked<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  input: { readonly question: string; readonly history: readonly Turn[] },
): T {
  if (!didYouMeanStaysAskedEnabled()) return answer;
  const card = answer.formProposal;
  const employee = card?.employeeName?.trim();
  if (!card || !employee) return answer;
  const last = [...input.history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const asked = ASKED.exec(last);
  if (!asked) return answer;
  const options = [...asked[1]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim());
  if (!options.some((option) => fold(option) === fold(employee)) || picks(input.question, options)) return answer;
  const queued = NEXT_LINE.exec(answer.content)?.[0];
  return {
    ...answer,
    content: queued ? `${asked[0]}\n\n${queued}` : asked[0],
    formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
  };
}

export function withCardNamingEmployee<T extends { content: string; formProposal?: CardLike | null }>(answer: T): T {
  if (!cardNamesEmployeeEnabled()) return answer;
  const employee = answer.formProposal?.employeeName?.trim();
  if (!employee || !/\bI have the employee\b/.test(answer.content)) return answer;
  return { ...answer, content: answer.content.replace(/\bI have the employee\b/g, `I have **${employee}**`) };
}

/*
 * OBSERVATION_OWN_PERSON_ONLY_ENABLED, with ONE_FORM_EACH_PERSON off (QA's gate, 10 Nov 2026): "CA for <A> and <B> for
 * being late" made a card for <A> and asked nothing — today too; the case asking "which of the two" held only because
 * both names stayed in the card's Observation, which this flag cleans. So a request that lists two or more people for
 * one form never puts one of them on the card unasked: the card has no employee and the reply asks which of them.
 * With ONE_FORM_EACH_PERSON on, the request is one form each instead. Off, as before.
 */
export function withSeveralPeopleAsked<T extends { content: string; formProposal?: (CardLike & { templateKey?: string }) | null }>(
  answer: T,
  question: string,
): T {
  if (!observationOwnPersonOnlyEnabled() || oneFormEachPersonEnabled()) return answer;
  const card = answer.formProposal;
  const employee = card?.employeeName?.trim();
  const asked = peopleRequest(question);
  if (!card || !employee || !asked) return answer;
  const first = fold(employee).split(" ")[0] ?? "";
  if (!asked.people.some((person) => fold(person) === fold(employee) || fold(person).split(" ")[0] === first)) return answer;
  const form = TEMPLATE_SEEDS.find((seed) => seed.key === (card.templateKey ?? asked.templateKey))?.name ?? "form";
  const names = asked.people.map((person) => `**${person}**`);
  return {
    ...answer,
    content: `Which of them is this **${form}** for — ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}? One form is for one person; tell me who, and ask for the next one after.`,
    formProposal: { ...card, employeeName: null, employeeRole: null, status: "needs_employee", supportsInlineDraft: false },
  };
}