import { terminationTickNoteEnabled } from "@/lib/config/chat-quality-flags";
import { statesTermination } from "@/lib/forms/termination-stated";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * A TERMINATION THE APP DOES NOT TICK IS THE MANAGER'S TO TICK (TERMINATION_TICK_NOTE_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026 (the termination scan; same flag in both apps): when the manager's words mention termination but the
 * stated-termination reader (`forms/termination-stated.ts`, TERMINATION_STATED_TICKS) does not tick it — "my DM
 * approved her termination, write up the CA", "create a termination for <A>" — the card's only level line was "You'll
 * set the verbal/written warning level on the form — I won't guess at it.", which never says Termination. With the
 * flag that line reads TERMINATION_TICK_NOTE instead, the agent loop's hedge wording (G19), so both paths read alike.
 * A termination the reader ticks is left to `ai/termination-stated.ts`; nothing here ticks anything. Off, as built.
 */
export const TERMINATION_TICK_NOTE = "You'll tick Termination on the form yourself; it needs DM/HR approval before it's finalized.";

const CORRECTIVE = /corrective action/i;
const BOTH_ASKED =
  /You'll set the verbal\/written warning level and any prior coaching or corrective action on the form — I won't guess at them\./;
const LEVEL_ASKED = /You'll set the verbal\/written warning level on the form — I won't guess at it\./;
/** The manager's words mention termination at all ("terminate", "termination", "terminated", "term CA"). */
const MENTIONS = /\bterminat(?:e|ed|es|ing|ion)\b|\bterm\s+(?:ca|c\/a)\b/i;

export function withTerminationTickNote(response: AskResponse, request: AskRequest): AskResponse {
  if (!terminationTickNoteEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || !(proposal.templateKey === "dpoa" || CORRECTIVE.test(proposal.templateName ?? ""))) return response;
  if (proposal.warningLevel) return response;
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => String(turn.content)), request.question].join("\n");
  if (!MENTIONS.test(said) || statesTermination(said)) return response;
  let content = response.content;
  if (BOTH_ASKED.test(content)) {
    content = content.replace(BOTH_ASKED, `${TERMINATION_TICK_NOTE} You'll set any prior coaching or corrective action on the form — I won't guess at it.`);
  } else if (LEVEL_ASKED.test(content)) {
    content = content.replace(LEVEL_ASKED, TERMINATION_TICK_NOTE);
  } else if (!content.includes(TERMINATION_TICK_NOTE)) {
    // No level line at all: the note goes after the card's opening line, where the level line would be.
    const lines = content.split("\n");
    lines.splice(Math.min(1, lines.length), 0, "", TERMINATION_TICK_NOTE);
    content = lines.join("\n");
  }
  return { ...response, content: content.replace(/\n{3,}/g, "\n\n").trim() };
}
