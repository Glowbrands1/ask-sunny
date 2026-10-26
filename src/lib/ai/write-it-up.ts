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
 * Before any reader sees a manager turn, the first "write (it / this / that)
 * up for <first> <last>" is read as "create a corrective action form for
 * <first> <last>". The rest of the turn stays as typed. A negation before it
 * ("never write it up for …", "no need to …"), a question ("how do i …"), and
 * a time, a pronoun, a group or a topic after "for" ("friday", "her", "the
 * team", "being late") leave the turn as typed (QA-7, 26 Oct 2026). Off,
 * every turn is read as typed.
 *
 * The same file in the sibling app.
 */

const WRITE_IT_UP = /\bwrite\s+(?:it|this|that)\s+up\s+for\s+/i;
/** QA-7, 26 Oct 2026: a negation before it, or a question, asks for nothing. */
const NEGATED = /\b(?:not|never|no\s+need|don'?t|do\s+not|didn'?t|did\s+not|without|except|instead\s+of)\b/i;
const QUESTION = /^\s*(?:how|what|when|why|where|should|can\s+i|do\s+i|is\s+it)\b|\?\s*$/i;
/** What follows "for" that is never a person: times, pronouns, groups, topics. */
const NOT_A_PERSON =
  /^(?:me|you|us|her|him|them|it|this|that|the|a|an|my|our|your|his|their|everyone|everybody|anyone|anybody|someone|somebody|all|team|staff|being|today|tonight|tomorrow|yesterday|now|later|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|last|this|attendance|lateness|tardiness|cash|dress|phone|policy|meeting|lunch|break|\d)/i;
/** Two words that read as a first and a last name. */
const PERSON = /^[A-Za-z][A-Za-z'’-]+\s+[A-Za-z][A-Za-z'’-]+/;

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
  if (typeof text !== "string" || QUESTION.test(text)) return text;
  const hit = WRITE_IT_UP.exec(text);
  if (!hit) return text;
  const clause = text.slice(0, hit.index).split(/[,.;!?]/).pop() ?? "";
  const rest = text.slice(hit.index + hit[0].length);
  if (NEGATED.test(clause) || NOT_A_PERSON.test(rest) || !PERSON.test(rest)) return text;
  // Only the first: "… and write it up for <other>" stays as typed.
  return `${text.slice(0, hit.index)}create a corrective action form for ${rest}`;
}
