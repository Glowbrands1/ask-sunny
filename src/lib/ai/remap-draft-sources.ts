import { remapDraftSourcesEnabled } from "@/lib/config/chat-quality-flags";

import { slotClause } from "./form-full-remap";
import { currentRequestStart } from "./remap-incident";
import type { AskResponse } from "./types";

/**
 * ============================================================================
 * A REMAP CARD NAMES THE MANAGER'S TURNS IT WAS READ FROM
 * ============================================================================
 *
 * REMAP_DRAFT_SOURCES_ENABLED (QA H1, 25 Oct 2026). The full remap built its
 * card with `sourceMessageIds: []`, and the draft is written from exactly the
 * manager turns those ids name (`draftNotesFromConversation`). So every remap
 * card's Create draft filed a blank form: "Your draft was created, but there
 * wasn't enough in the conversation … to prefill it", with What happened,
 * Policy and Action Plan empty although the card showed them.
 *
 * On, a remap card that names no turns names this form's manager turns: from
 * the request that started it (`currentRequestStart`, the remap's own rule
 * for "a later create request with its own incident starts a new form") to
 * the turn being answered. A card that already names turns, and every
 * proposal-flow card, is left as it is. Off, unchanged.
 */
export function withRemapDraftSources(
  response: AskResponse,
  request: {
    readonly history: readonly { readonly id?: string; readonly role: string; readonly content: string }[];
    readonly question: string;
    readonly questionMessageId?: string;
  },
): AskResponse {
  const proposal = response.formProposal;
  if (!remapDraftSourcesEnabled() || !proposal || proposal.sourceMessageIds.length > 0) return response;
  const turns = [
    ...request.history.filter((turn) => turn.role === "user"),
    { id: request.questionMessageId, role: "user", content: request.question },
  ];
  const start = currentRequestStart({
    turns: turns.map((turn) => turn.content),
    employeeName: proposal.employeeName,
    slotClause,
  });
  const ids = turns
    .slice(start)
    .map((turn) => turn.id)
    .filter((id): id is string => typeof id === "string" && id !== "");
  const unique = [...new Set(ids)];
  if (unique.length === 0) return response;
  return { ...response, formProposal: { ...proposal, sourceMessageIds: unique } };
}
