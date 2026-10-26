import { statedTitleWinsEnabled } from "@/lib/config/chat-quality-flags";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * THE CARD CARRIES THE STATED TITLE AS STATED (STATED_TITLE_WINS_ENABLED)
 * ============================================================================
 *
 * The intent reading writes the title it kept onto the question as the app's
 * own line, "Job title: HR Assistant." The proposal flow's label reader
 * (`titleAfterJobTitleLabel`) reads up to six words and lets a full stop
 * through, so a title that is not on the list ran into the next app line and
 * the card said "HR Assistant. It happened" (the sibling app's QA, 25 Oct
 * 2026, "she is an HR assistant"). With the flag, a card title that is the
 * app's line's title followed by a full stop and more words is that title.
 * Anything else, and flag off: unchanged.
 */
const APP_TITLE_LINE = /\bJob title:\s*([^.\n]+)\./i;

export function withStatedTitleOnCard(response: AskResponse, question: string): AskResponse {
  const proposal = response.formProposal;
  if (!statedTitleWinsEnabled() || !proposal?.employeeRole) return response;
  const title = APP_TITLE_LINE.exec(question)?.[1]?.trim();
  if (!title) return response;
  const role = proposal.employeeRole;
  if (!role.toLowerCase().startsWith(`${title.toLowerCase()}.`) || role.length <= title.length + 1) return response;
  const content = response.content.split(role).join(title);
  return { ...response, content, formProposal: { ...proposal, employeeRole: title } };
}
