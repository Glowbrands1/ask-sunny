import { formDateGiven, formDatedTodayFor } from "./incident-dates";

/*
 * ============================================================================
 * A FORM IS DATED THE DAY IT IS WRITTEN — THE LAST CHECK ON THE CARD (FORM_DATE_IS_TODAY_ENABLED)
 * ============================================================================
 *
 * Pau, 24 Nov 2026: "the form date is wrong i told it <P> was late to work on September 11, 2026. but it put the date
 * …, should be today right". `decideFormDate` and the agent loop leave the card undated (Create dates it today), but the
 * chat's later steps (the intent read's slots, the kept slots, the card's enrichment) read the incident's date back
 * from the conversation and put it on the card again. With the flag on, the last step on the card: a form dated by its
 * incident carries only the date the manager gave the form itself (`formDateGiven`), or none, and the reply's "Date"
 * line says the same. The incident's date stays in the account. Off, as before.
 */

const DATE_LINE = /^(- )?\*\*Date:\*\* .+$\n?/m;

interface CardLike {
  templateKey?: string;
  formDate?: string | null;
}

function slash(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`;
}

export function withFormDatedToday<T extends { content: string; formProposal?: CardLike | null }>(
  answer: T,
  managerTurns: readonly string[],
  today: string,
): T {
  const card = answer.formProposal;
  if (!card?.templateKey || !formDatedTodayFor(card.templateKey)) return answer;
  const given = formDateGiven(managerTurns.join("\n"), card.templateKey, today);
  if ((card.formDate ?? null) === given) return answer;
  const content = given
    ? answer.content.replace(DATE_LINE, (line, dash: string | undefined) => `${dash ?? ""}**Date:** ${slash(given)}${line.endsWith("\n") ? "\n" : ""}`)
    : answer.content.replace(DATE_LINE, "");
  return { ...answer, content, formProposal: { ...card, formDate: given } };
}
