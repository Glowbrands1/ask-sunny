import { writeItUpEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/**
 * WRITE_IT_UP_ENABLED: "write it up for <name>" asks for the Corrective Action
 * Form.
 *
 * QA, 26 Oct 2026 (Sunny tester; the same reader in the sibling app): after
 * "whats the policy on being late opening the salon", the manager's "write it
 * up for devon harlan" got long policy advice with invented facts instead of
 * a card; the card came only at "just make it". The form reader reads "write
 * up <name>" and "write her up", never "write it up for <name>".
 *
 * Before any reader sees a manager turn, "write (it / this / that) up for
 * <name>" is read as "create a corrective action form for <name>". The rest
 * of the turn stays as typed. Off, every turn is read as typed.
 *
 * The same file in the sibling app.
 */

const WRITE_IT_UP = /\bwrite\s+(?:(?:it|this|that)\s+)?up\s+(?:for|on)\s+(?!(?:me|you|us)\b)(?=[A-Za-z])/gi;

export function withWriteItUp(request: AskRequest): AskRequest {
  if (!writeItUpEnabled()) return request;
  const question = writeItUpRequest(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = writeItUpRequest(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/** "write it up for <name> …" as "create a corrective action form for <name> …". */
export function writeItUpRequest(text: string): string {
  if (typeof text !== "string") return text;
  return text.replace(WRITE_IT_UP, "create a corrective action form for ");
}
