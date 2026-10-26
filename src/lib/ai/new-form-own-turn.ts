import { newFormOwnTurnEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * NEW_FORM_OWN_TURN_ENABLED: a new form asked for after a card is drafted
 * from the turns after that card only.
 *
 * QA live run, 26 Oct 2026 (S20, conv_mvomozjati6imk; names invented): after
 * "coaching form for <name>, late today" and its card, "another coaching form
 * for <name>, she left early yesterday" drafted the second form with both
 * turns' text ("late today another coaching form for <name>, she left early
 * yesterday"): the new card cited the first request's turn.
 *
 * When the manager's turn asks for another, a new or a second form and an
 * earlier reply carried a card, the new card's source turns are only the ones
 * after that card. Any other turn, and a card with no earlier card, are left
 * as they are. Off, the card is as it is.
 *
 * The same file in the sibling app.
 */

const NEW_FORM = /\b(?:another|new|second|one\s+more|next|separate)\b[^.?!]*?\b(?:form|ca|c\/a|coaching|write[- ]?up|one)\b/i;

export function withNewFormOwnTurn(response: AskResponse, request: AskRequest): AskResponse {
  if (!newFormOwnTurnEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || proposal.sourceMessageIds.length === 0 || !NEW_FORM.test(request.question)) return response;
  let lastCard = -1;
  request.history.forEach((turn, index) => {
    if (turn.role === "assistant" && turn.formProposal) lastCard = index;
  });
  if (lastCard < 0) return response;
  const before = new Set(request.history.slice(0, lastCard + 1).map((turn) => turn.id));
  const kept = proposal.sourceMessageIds.filter((id) => !before.has(id));
  if (kept.length === proposal.sourceMessageIds.length) return response;
  return { ...response, formProposal: { ...proposal, sourceMessageIds: kept } };
}
