import { futureIncidentDateAskEnabled } from "@/lib/config/chat-quality-flags";
import type { AskRequest, AskResponse } from "@/lib/ai/types";
import { FUTURE_DATE_TAG, futureDateQuestion, futureIncidentDate } from "@/lib/forms/incident-dates";

/**
 * FUTURE_INCIDENT_DATE_ASK_ENABLED, the last step of a card turn (October triage #11; Sunny #285, the sibling app's
 * #207 BH5). With INTENT_EXTRACTION on, the card's date is grounded in `intent-slots.ts`, not `decideFormDate`, so
 * "… not attending the monthly meeting on 12-20-26", written on 10/25, still dated the card 12/20/2026. Whatever path
 * dated it: a card dated after today, by an incident date in the manager's own words, is undated and the manager is
 * asked once what date it happened. A deadline, a "by"/"due" date or a date given to the form is never asked about
 * (`futureIncidentDate`). Off, or any other card, as it was.
 */
const DATE_LINE = /\n?\*\*Date:\*\*[^\n]*/;

export function withFutureDateQuestion(response: AskResponse, request: Pick<AskRequest, "question" | "history" | "context">): AskResponse {
  if (!futureIncidentDateAskEnabled()) return response;
  const proposal = response.formProposal;
  const today = request.context?.todayIso;
  if (!proposal?.formDate || !today || proposal.formDate <= today) return response;
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content), request.question].join("\n");
  if (futureIncidentDate(said, today) !== proposal.formDate) return response;
  const asked = (request.history ?? []).some((turn) => turn.role === "assistant" && turn.content.includes(FUTURE_DATE_TAG)) || response.content.includes(FUTURE_DATE_TAG);
  const content = response.content.replace(DATE_LINE, "").trimEnd();
  return {
    ...response,
    content: asked ? content : `${content}\n\n${futureDateQuestion(proposal.formDate, today)}`,
    formProposal: { ...proposal, formDate: null },
  };
}
