import { unknownNameAskEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * UNKNOWN_NAME_ASK_ENABLED (ported from Ask Bubbles, QA BF7 live, 27 Oct 2026):
 * "i need to issue a ca for someone being late" / "<name> was late on 10/20
 * and the salon was opened late" / … — the typed name is not on the
 * directory, so it was never read, and every reply was the same sentence:
 * "Who is this Corrective Action Form for? Give me their name and I'll draft
 * it …", five times. With the flag on, while the card has no employee:
 *
 *   a name the manager typed ("<first> <last> was/is/has …") is named back,
 *   once: "I couldn't match <name> to anyone on the directory. Tell me the
 *   employee's full name as it is on the directory.";
 *   the same question is never shown twice in a row — a repeat says what is
 *   still needed in new words.
 *
 * No field of the card changes.
 */
const OPENING = /Who is this \*\*([^*]+)\*\* for\? Give me their name and I'll draft it from what you've told me(?: — you can set the warning level and anything else on the form itself)?\./;
const NOT_A_NAME = new Set([
  "she", "he", "they", "her", "his", "the", "a", "an", "my", "our", "this", "that", "it", "i", "we", "you", "someone", "somebody",
  "employee", "team", "salon", "manager", "staff", "everyone", "yes", "no",
]);
const TYPED = /(?:^|[.!?\n]\s*)([a-z][a-z'’-]{1,20})\s+([a-z][a-z'’-]{1,20})\s+(?:was|is|has|had|did|didn['’]?t|came|left|showed|called|missed|got|clocked|arrived|opened|took)\b/gi;

function typedName(turns: readonly string[]): string | null {
  let found: string | null = null;
  for (const turn of turns) {
    for (const match of turn.matchAll(TYPED)) {
      const [first, last] = [match[1]!, match[2]!];
      if (NOT_A_NAME.has(first.toLowerCase()) || NOT_A_NAME.has(last.toLowerCase())) continue;
      found = `${first} ${last}`;
    }
  }
  return found;
}

type Turn = { readonly role: string; readonly content: string };

export function withUnknownNameAsk(response: AskResponse, request: AskRequest): AskResponse {
  if (!unknownNameAskEnabled() || response.formProposal?.employeeName) return response;
  const opening = OPENING.exec(response.content);
  if (!opening) return response;
  const history = (request.history ?? []) as readonly Turn[];
  const turns = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), request.question];
  const last = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const name = typedName(turns);
  const named = name ? `I couldn't match **${name}** to anyone on the directory. Tell me the employee's full name as it is on the directory.` : null;
  const askedBefore = (text: string) => history.some((turn) => turn.role === "assistant" && turn.content.includes(text));
  // The typed name is named back once; after that, what is still needed, never the reply before word for word.
  const options = [
    ...(named && !askedBefore(named) ? [named] : []),
    ...(name ? [`I still need a name that is on the directory — **${name}** isn't. What is the employee's full name as the directory has it?`] : []),
    `I still need the employee's full name to start the **${opening[1]}**.`,
    `To start the **${opening[1]}** I need one thing: the employee's full name as it is on the directory.`,
  ];
  if (!name && !OPENING.test(last)) return response;
  const question = options.find((option) => !last.includes(option)) ?? options[options.length - 1]!;
  return { ...response, content: response.content.replace(opening[0], question) };
}
