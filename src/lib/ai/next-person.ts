import { nextPersonFormEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/**
 * NEXT_PERSON_FORM_ENABLED: "now one for <name> …" is a new form for that
 * person.
 *
 * QA, 26 Oct 2026 (both apps, names invented): after "ca for <A> late today",
 * the manager's "now one for <B>, he was rude to a guest" left the card on A.
 * "another one for <B> …" and "next one is for <B> …" the same. Only "a ca for
 * <B> …" moved it.
 *
 * Once a card is open, a manager turn that opens with "(and / ok / now)
 * (do / make) (another / the next / next) one (is) for <name>" is read as
 * "create a <that card's form> for <name> …", which every reader already
 * reads as a new request. The rest of the turn stays as typed. "for her",
 * "for the team", a time or a topic ("friday", "lunch", "being late"), and a
 * turn with no card before it are left alone; only the first "one for" is
 * read ("… and one for <B>" stays as typed). Off, every
 * turn is read as typed.
 *
 * The same file in the sibling app.
 */

const NEXT_ONE =
  /^\s*(?:(?:and|ok|okay|now|then|also)[,\s]+)*(?:(?:do|make|create|need|start)\s+)?(?:(?:another|the\s+next|next|a\s+second)\s+)?one\s+(?:is\s+)?for\s+(?=[A-Za-z])/i;
const NOT_A_PERSON =
  /^(?:her|him|them|me|you|us|the|a|an|my|our|your|this|that|it|everyone|everybody|anyone|all|team|staff|being|today|tonight|tomorrow|yesterday|now|later|lunch|break|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|last|attendance|lateness|cash|dress|phone|policy|\d)\b/i;
/** QA-7, 26 Oct 2026: the words after "for" must read as a first and a last name. */
const PERSON = /^[A-Za-z][A-Za-z'’-]+\s+[A-Za-z][A-Za-z'’-]+/;

export function withNextPersonForm(request: AskRequest): AskRequest {
  if (!nextPersonFormEnabled()) return request;
  let form: string | null = null;
  let changed = false;
  const history = request.history.map((turn) => {
    if (turn.role === "assistant") {
      form = turn.formProposal?.templateName ?? form;
      return turn;
    }
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = nextPersonRequest(turn.content, form);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  const question = nextPersonRequest(request.question, form);
  changed ||= question !== request.question;
  return changed ? { ...request, question, history } : request;
}

/** "now one for <name> …" as "create a <form> for <name> …", when a card is open. */
export function nextPersonRequest(text: string, openForm: string | null): string {
  if (!openForm || typeof text !== "string") return text;
  const lead = NEXT_ONE.exec(text);
  if (!lead) return text;
  const rest = text.slice(lead[0].length);
  // QA-6, 26 Oct 2026: "one for rory vance's team" is the team, not a person.
  if (NOT_A_PERSON.test(rest) || !PERSON.test(rest) || /^\S+\s+\S+['’]s\s+(?:team|staff|crew|salon|store|shift)\b/i.test(rest)) return text;
  const article = /^[aeiou]/i.test(openForm) ? "an" : "a";
  return `create ${article} ${openForm} for ${rest}`;
}
