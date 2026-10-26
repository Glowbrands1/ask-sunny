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

/**
 * QA-7, 26 Oct 2026: the quantifier must follow a request verb or open the
 * turn, the form must follow it, and nothing may negate it ("not another
 * coaching form", "do not create a new …", "… except rory vance"); "the new
 * date for the coaching form" and "separate the two dates" are edits.
 */
const FORM_WORD = "(?:coaching|ca|c\\/a|dpoa|corrective\\s+action|exit|write[- ]?up|policy\\s+review|form)";
const QUANTIFIER = "(?:another|a\\s+new|new|a\\s+second|second|one\\s+more|a\\s+separate)";
const NEW_FORM = new RegExp(
  `(?:^\\s*(?:(?:and|ok|okay|now|then|also)[,\\s]+)*|\\b(?:create|make|write|need|do|draft|start|open|prepare)\\s+(?:me\\s+)?)${QUANTIFIER}\\s+${FORM_WORD}\\b`,
  "i",
);
const NEGATED = /\b(?:not|never|no|don'?t|do\s+not|without|except|instead\s+of)\b/i;

function asksForNewForm(question: string): boolean {
  const hit = NEW_FORM.exec(question);
  if (!hit) return false;
  return !NEGATED.test(question.slice(0, hit.index + hit[0].length)) && !/\bexcept\b/i.test(question);
}

export function withNewFormOwnTurn(response: AskResponse, request: AskRequest): AskResponse {
  if (!newFormOwnTurnEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || proposal.sourceMessageIds.length === 0 || !asksForNewForm(request.question)) return response;
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
