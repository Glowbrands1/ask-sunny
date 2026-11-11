import { warningLevelAndClauseEnabled } from "@/lib/config/chat-quality-flags";
import { statedWarningLevel, type StatedWarningLevel } from "@/lib/forms/warning-level";

import type { AskRequest, AskResponse } from "./types";

/**
 * WARNING_LEVEL_AND_CLAUSE_ENABLED (QA S12 / SF4, 27 Oct 2026): "this should
 * be a written and note a verbal ca was given on 9-1-26" left the warning level
 * blank — "this should be a written" is read only when it is the whole
 * sentence, and the sentence goes on about the earlier step. With the flag on,
 * a Corrective Action card with no level reads the manager's turns a clause at
 * a time ("… and …"), latest turn first; one level stated in a clause of its
 * own is the card's level, and the reply says so in the words a stated level
 * gets. Two levels, or a level only in the step's history, state nothing.
 */
const ASKED = "You'll set the verbal/written warning level on the form — I won't guess at it.";

function label(level: StatedWarningLevel): string {
  return level === "verbal" ? "Verbal Warning" : "Written Warning";
}

/** The one level a turn states in an "and"-clause of its own, or null. */
export function levelInOwnClause(turn: string): StatedWarningLevel | null {
  const levels = new Set<StatedWarningLevel>();
  for (const sentence of turn.split(/[.;!?\n]+/)) {
    const clauses = sentence.split(/\s+and\s+/i);
    if (clauses.length < 2) continue;
    for (const clause of clauses) {
      const level = statedWarningLevel(clause, { undecidedStatesNothing: true });
      if (level) levels.add(level);
    }
  }
  return levels.size === 1 ? [...levels][0]! : null;
}

export function withWarningLevelFromClause(response: AskResponse, request: AskRequest): AskResponse {
  if (!warningLevelAndClauseEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || proposal.warningLevel || !response.content.includes(ASKED)) return response;
  const turns = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => String(turn.content)), request.question];
  let level: StatedWarningLevel | null = null;
  for (const turn of [...turns].reverse()) {
    level = levelInOwnClause(turn);
    if (level) break;
  }
  if (!level) return response;
  const line = `**Type of Warning:** ${label(level)}, as you said — I'll tick it on the form. Tell me if that should change.`;
  return { ...response, content: response.content.replace(ASKED, line), formProposal: { ...proposal, warningLevel: level } };
}
