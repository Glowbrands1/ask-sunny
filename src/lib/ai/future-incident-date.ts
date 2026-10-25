import { futureIncidentDateConfirmEnabled } from "@/lib/config/chat-quality-flags";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * AN INCIDENT DATE IN THE FUTURE IS ASKED ABOUT ONCE
 * (FUTURE_INCIDENT_DATE_CONFIRM_ENABLED)
 * ============================================================================
 *
 * The sibling app's QA history (conv_mvikc78w58v710y, 21 Oct 2026): "create a written CA for
 * <name> for not attending the monthly meeting on 12-20-26 …", typed on
 * 10-21-26, went on the form as 12/20/2026 without a word.
 *
 * With the flag, an incident date after today is asked about once: "That date
 * is in the future — is 12-20-26 right?". The date is never changed here.
 * Whatever the manager answers — "yes", "that's right", the same date again,
 * or nothing about it — the question is not asked again for that date in the
 * conversation; a corrected date is read by the form path as any later date
 * is, and is asked about only if it too is in the future. Only the incident
 * date the form carries — the Corrective Action Form's and the Coaching Form's
 * date — never a follow-up or review date, and never another form's date.
 *
 * Asked where a card is answered: the proposal flow's reply (`grounded-turn.ts`),
 * which the intent reading feeds, and the full remap's.
 */

/** The forms whose card date is the incident's. */
const INCIDENT_DATED = new Set(["dpoa", "coaching"]);

/** "12-20-26" for 2026-12-20. */
function spoken(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}-${day}-${year!.slice(-2)}`;
}

export function futureDateQuestion(iso: string): string {
  return `That date is in the future — is ${spoken(iso)} right?`;
}

/**
 * The question to ask this turn, or null: the flag is on, `iso` is a calendar
 * date after `today`, and no earlier reply in this conversation asked it for
 * that date.
 */
export function futureDateToAsk(input: {
  readonly iso: string | null | undefined;
  readonly today: string;
  readonly history: readonly { readonly role: string; readonly content: string }[];
}): string | null {
  if (!futureIncidentDateConfirmEnabled()) return null;
  const iso = input.iso ?? null;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso <= input.today) return null;
  const question = futureDateQuestion(iso);
  const asked = input.history.some((turn) => turn.role === "assistant" && turn.content.includes(question));
  return asked ? null : question;
}

/**
 * A form reply whose card carries a future incident date not yet asked about:
 * the card stays and the reply is the question alone. Nothing else is asked
 * that turn, and the reply names nothing else, so a bare "yes" answers this
 * question only (a "yes" after a reply that mentions payroll deduct is read as
 * the payroll answer, `payroll-deduct.ts`). Anything else, and flag off:
 * unchanged.
 */
export function withFutureDateQuestion(
  response: AskResponse,
  input: { readonly today: string; readonly history: readonly { readonly role: string; readonly content: string }[] },
): AskResponse {
  const proposal = response.formProposal;
  if (!proposal || !INCIDENT_DATED.has(proposal.templateKey)) return response;
  const question = futureDateToAsk({ iso: proposal.formDate, today: input.today, history: input.history });
  return question ? { ...response, content: question } : response;
}
