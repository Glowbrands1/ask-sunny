import { unknownNameAskEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * A NAME NOT ON THE DIRECTORY IS NAMED BACK; THE NAME QUESTION IS NEVER REPEATED WORD FOR WORD
 * (UNKNOWN_NAME_ASK_ENABLED, default off; port of the sibling app's flag, QA BF7 live there, 27 Oct 2026)
 * ============================================================================
 *
 * QA's round-6 audit (8 Nov 2026) ran the sibling app's BF7 chain here: "i need to issue a ca for someone being late"
 * / "<name> was late on 10/20 and the salon was opened late" / … — the typed name is not on the directory, so it was
 * never read, and all six replies asked "Who is this **Corrective Action Form** for? Give me their name and I'll
 * draft it …" (every other one behind "I still need to know who this is for"). The name was never said back.
 *
 * With the flag on, while the card has no employee:
 *   - a name the manager typed ("<first> <last> was/is/has …") is named back, once: "I couldn't match **<name>** to
 *     anyone on the directory.";
 *   - the same question is never shown twice in a row: a repeat asks who the form is for in new words.
 * Every reply still asks "Who is this … for?" (the replay pack's `stillAsks` check). No field of the card changes.
 * Off, the reply is as it was.
 */
const OPENING = /Who is this \*\*([^*]+)\*\* for\? Give me their name and I'll draft it from what you've told me(?: — you can set the warning level and anything else on the form itself)?\./;
const NOT_A_NAME = new Set([
  "she", "he", "they", "her", "his", "the", "a", "an", "my", "our", "this", "that", "it", "i", "we", "you", "someone", "somebody",
  "employee", "team", "salon", "store", "manager", "staff", "everyone", "yes", "no",
]);
const TYPED = /(?:^|[.!?\n]\s*)([a-z][a-z'’-]{1,20})\s+([a-z][a-z'’-]{1,20})\s+(?:was|is|has|had|did|didn['’]?t|came|left|showed|called|missed|got|clocked|arrived|opened|took)\b/gi;

/** The latest "<first> <last> was …" the manager typed, or null. */
export function typedName(turns: readonly string[]): string | null {
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
  const form = opening[1]!;
  const history = (request.history ?? []) as readonly Turn[];
  const turns = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), request.question];
  const last = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  const name = typedName(turns);
  const named = name ? `I couldn't match **${name}** to anyone on the directory. Who is this **${form}** for? Tell me their full name as it is on the directory.` : null;
  const askedBefore = (text: string) => history.some((turn) => turn.role === "assistant" && turn.content.includes(text));
  // The typed name is named back once; after that, who the form is for in new words, never the reply before word for word.
  const options = [
    ...(named && !askedBefore(named) ? [named] : []),
    ...(name ? [`**${name}** isn't on the directory. Who is this **${form}** for? Their full name as the directory has it.`] : []),
    `Who is this **${form}** for? I need the employee's full name before I can start it.`,
    `To start the **${form}** I need one thing: who is it for? Their full name as it is on the directory.`,
  ];
  if (!name && !OPENING.test(last)) return response;
  const question = options.find((option) => !last.includes(option)) ?? options[options.length - 1]!;
  return { ...response, content: response.content.replace(opening[0], question) };
}
