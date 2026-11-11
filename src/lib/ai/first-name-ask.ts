import { firstNameAskEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * FIRST_NAME_ASK_ENABLED (QA S15, 27 Oct 2026; same flag in both apps): "I
 * have an employee ivy at our Grand Island location who …" / "Create a
 * Coaching Form from this conversation." / "Yes" — the card asked "Who is this
 * form for? Tell me the employee's full name." twice, word for word, and never
 * used the "ivy" the manager gave. With the flag on, a card that asks that
 * question uses the first name the manager typed for "employee <name>": "Is
 * this for ivy? Tell me her full name." Asked again on the next turn, the
 * words are new, so the same question is never shown twice. No field of the
 * card changes.
 */
const NAME_QUESTION = "Who is this form for? Tell me the employee's full name.";
const NOT_A_NAME = new Set(["who", "that", "which", "is", "was", "has", "had", "at", "in", "named", "called", "here", "there", "of", "for", "and", "the", "a", "an"]);
const NAMED = /\b(?:employee|team\s+member|associate|staff\s+member)\s+(?:named\s+|called\s+)?([a-z][a-z'’-]{1,20})\b/i;

function firstNameIn(turns: readonly string[]): string | null {
  for (const turn of [...turns].reverse()) {
    const named = NAMED.exec(turn)?.[1];
    if (named && !NOT_A_NAME.has(named.toLowerCase())) return named;
  }
  return null;
}

function possessive(turns: readonly string[]): string {
  const text = turns.join(" ");
  if (/\b(?:she|her)\b/i.test(text)) return "her";
  if (/\b(?:he|him|his)\b/i.test(text)) return "his";
  return "their";
}

type Turn = { readonly role: string; readonly content: string };

export function withFirstNameAsk(response: AskResponse, request: AskRequest): AskResponse {
  if (!firstNameAskEnabled() || !response.content.includes(NAME_QUESTION) || response.formProposal?.employeeName) return response;
  const history = (request.history ?? []) as readonly Turn[];
  const turns = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), request.question];
  const name = firstNameIn(turns);
  if (!name) return response;
  const asked = `Is this for ${name}? Tell me ${possessive(turns)} full name.`;
  const last = [...history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  // Never the same question twice in a row.
  const question = last.includes(asked) ? `I still need ${name}'s full name — first and last — to put on the form.` : asked;
  return { ...response, content: response.content.replace(NAME_QUESTION, question) };
}
