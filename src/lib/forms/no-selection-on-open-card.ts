import { noSelectionOnOpenCardEnabled } from "@/lib/config/chat-quality-flags";
import { formOpportunityLead } from "@/lib/forms/form-opportunity";
import type { AskResponse } from "@/lib/ai/types";

/**
 * ============================================================================
 * WITH A CARD ON SCREEN, NO "I CAN PREPARE:" FOR THE SAME FORM (NO_SELECTION_ON_OPEN_CARD_ENABLED)
 * ============================================================================
 *
 * Pau's sf-b6 (the sibling app's production, 4 Nov 2026; this app's twin): with <A>'s Corrective Action card on screen,
 * "can you have it include that we recieved a customer complaint from Sunday 11-1, …" was answered by the model, and
 * then the app added the form choice again — "Based on what you've described, I can prepare:" with the Corrective
 * Action Form first — so the reply ended at a colon above a choice of the form already being written.
 *
 * With the flag on, when the browser says a card of one form is on screen (`continueProposalTemplateKey`) and the
 * answer's form choice offers that same form, the choice and its lead are left off: the card on screen is the form. Any
 * other answer is left as it is. Pure.
 */
export function withoutSelectionOnOpenCard(answer: AskResponse, continueTemplateKey: string | undefined): AskResponse {
  const selection = answer.formSelection;
  if (!noSelectionOnOpenCardEnabled() || !continueTemplateKey || !selection) return answer;
  const offered = [selection.primary, ...(selection.additional ?? [])].map((choice) => choice.templateKey);
  if (!offered.includes(continueTemplateKey)) return answer;
  const { formSelection: _dropped, ...rest } = answer;
  void _dropped;
  const lead = formOpportunityLead().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { ...rest, content: rest.content.replace(new RegExp(`\\n*${lead}\\s*$`), "").trimEnd() };
}
