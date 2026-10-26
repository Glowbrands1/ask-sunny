import { editInstructionReplacesEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/**
 * EDIT_INSTRUCTION_REPLACES_ENABLED: an edit instruction is an instruction,
 * never a name (QA, 26 Oct 2026).
 *
 * "Change Observation of Offense to: kira clocked in 25 minutes late …" —
 * in sentence case the employee readers took "Change Observation" for a
 * person and the card's Employee became "Change". Before any reader sees the
 * turn, the instruction's own words (the verb, the field and "to:") are put
 * in lower case. The manager's text after them is untouched, and so is every
 * turn that is not an edit of What happened. Off, the request is as sent.
 *
 * The same file in both apps.
 */

const LEAD = String.raw`(?:(?:ok(?:ay)?|yes|great|thanks|and|also|now|so)\b[,.!]?\s*)*(?:(?:please|pls)\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:(?:please|pls)\s+)?`;
const FIELD = String.raw`(?:the\s+)?(?:observation(?:\s+of\s+(?:the\s+)?offen[cs]e)?|what\s+happened|offen[cs]e\s+description|description(?:\s+of\s+(?:the\s+)?offen[cs]e)?|narrative|issue)`;

const INSTRUCTION = new RegExp(
  String.raw`^(\s*${LEAD})((?:change|update|set|edit|make|rewrite|reword)\s+${FIELD}\s+(?:to(?:\s+(?:say|read))?|so\s+(?:that\s+)?it\s+(?:says|reads)|as|with|into)|replace\s+${FIELD}\s+with|${FIELD}\s+(?:should|must|needs?\s+to)\s+(?:say|read|be)|(?:also\s+)?add\s+to\s+${FIELD})(?=\s|:|-|–|—|$)`,
  "i",
);

/** The turn with its edit instruction's own words in lower case; any other turn as typed. */
export function lowercaseEditInstruction(turn: string): string {
  return turn
    .split("\n")
    .map((line) => line.replace(INSTRUCTION, (_whole, lead: string, words: string) => `${lead.toLowerCase()}${words.toLowerCase()}`))
    .join("\n");
}

/** The request the readers see: the question and the manager's earlier turns, each edit instruction in lower case. */
export function withEditInstructionRead(request: AskRequest): AskRequest {
  if (!editInstructionReplacesEnabled()) return request;
  const question = lowercaseEditInstruction(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user") return turn;
    const content = lowercaseEditInstruction(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}
