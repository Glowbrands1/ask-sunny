import { nameBeforeTitleEnabled } from "@/lib/config/chat-quality-flags";
import { extractJobTitle } from "@/lib/forms/proposal";

import type { AskRequest } from "./types";

/**
 * NAME_BEFORE_TITLE_ENABLED: a two-word name right before a job title is the
 * name, and the title ends it.
 *
 * QA live run in Ask Bubbles, 26 Oct 2026 (tester 1, B10/B12; reproduced here
 * with the production flags; names invented): "create a
 * verbal ca for <first> <last>, team member at <salon>, …" in lowercase gave a
 * card with no Employee and the name as What happened; "… for <First> <Last>
 * Team Member at <salon> …" (no comma) read only the first name. "… for <First>
 * <Last>, team member at …" was read.
 *
 * Before any reader sees a manager turn, "<form word> for <word> <word>(,)
 * <job title>" is read as "<form word> for <Word> <Word>, <job title>": the
 * two words in Title Case, then a comma. Only when the words after the name
 * are a job title (or a role word such as "team member") on their own, and the name is not itself a title, a
 * pronoun or a word like "the". The rest stays as typed. Off, every turn is
 * read as typed.
 *
 * The same file in the sibling app.
 */

const LEAD =
  /\b((?:ca|c\/a|dpoa|corrective\s+action(?:\s+form)?|coaching(?:\s+form)?|coach|exit(?:\s+form)?|write\s*up|form))\s+(for)\s+([A-Za-z][A-Za-z'’-]+)\s+([A-Za-z][A-Za-z'’-]+)\s*,?\s+/gi;
/** Role words every company uses, read as a title here even where the company's titles do not list them. */
const GENERIC_ROLE = /^(?:team\s+member|team\s?mate|associate|employee|staff\s+member|crew\s+member)$/i;
const NOT_A_NAME =
  /^(?:the|a|an|my|our|her|his|their|this|that|one|team|staff|everyone|all|being|not|no|late|today|yesterday|at|on|in|and|or|she|he|they)$/i;

export function withNameBeforeTitle(request: AskRequest): AskRequest {
  if (!nameBeforeTitleEnabled()) return request;
  const question = nameBeforeTitle(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = nameBeforeTitle(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/** "ca for wren halvorsen team member at …" as "ca for Wren Halvorsen, team member at …". */
export function nameBeforeTitle(text: string): string {
  if (typeof text !== "string") return text;
  LEAD.lastIndex = 0;
  const lead = LEAD.exec(text);
  if (!lead) return text;
  const [whole, form, word, first, last] = lead as unknown as [string, string, string, string, string];
  if (NOT_A_NAME.test(first) || NOT_A_NAME.test(last) || extractJobTitle(first) || extractJobTitle(last)) return text;
  const rest = text.slice(lead.index + whole.length);
  const title = titleAhead(rest);
  if (!title) return text;
  return `${text.slice(0, lead.index)}${form} ${word} ${titleCase(first)} ${titleCase(last)}, ${rest}`;
}

/** The job title the text opens with (one to three words, then "at", a comma, or the end), or null. */
function titleAhead(rest: string): string | null {
  const words = rest.split(/\s+/);
  for (let count = 1; count <= 3 && count <= words.length; count++) {
    const phrase = words.slice(0, count).join(" ");
    const clean = phrase.replace(/[,.;]+$/, "");
    const closed = phrase !== clean || count === words.length || /^at$/i.test(words[count] ?? "");
    if (closed && (extractJobTitle(clean) || GENERIC_ROLE.test(clean))) return clean;
  }
  return null;
}

function titleCase(word: string): string {
  if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
  return word.toLowerCase().replace(/(^|[-'’])([a-z])/g, (_, mark: string, letter: string) => `${mark}${letter.toUpperCase()}`);
}
