import { unreadDateAskEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest, AskResponse } from "./types";

/**
 * UNREAD_DATE_ASK_ENABLED (QA, 27 Oct 2026; same flag in both apps): "she was
 * late last tuesday" read as no date, the card said nothing, and Create dated
 * the form today without a word. With the flag on, when a card has no date and
 * the manager wrote a day the reader cannot turn into one ("last tuesday",
 * "last week", "the other day", "3 days ago"), the card says so and asks:
 *
 *   **Date:** I couldn't read "last tuesday" — which date? (for example 10/20), or set it on the form.
 *
 * Nothing is chosen for them. A card that has a date, or turns with no such
 * words, are left as they were.
 */
const DAY = String.raw`(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?`;
const UNREAD_DAY = new RegExp(
  [
    String.raw`\b(?:last|this\s+past|past|on)\s+${DAY}\b(?!\s*,?\s*(?:the\s+)?\d)`,
    String.raw`\byesterday\b`,
    String.raw`\b(?:last|this\s+past|past)\s+(?:week(?:end)?|night)\b`,
    String.raw`\bover\s+the\s+weekend\b`,
    String.raw`\bthe\s+other\s+day\b`,
    String.raw`\b(?:a\s+(?:few|couple(?:\s+of)?)|\d{1,2}|two|three|four|five|six)\s+days?\s+ago\b`,
  ].join("|"),
  "gi",
);

type Turn = { readonly role: string; readonly content: string };

/** The last day the manager wrote that the date reader does not read, or null. */
export function unreadDayIn(turns: readonly string[]): string | null {
  for (const turn of [...turns].reverse()) {
    const found = [...turn.matchAll(UNREAD_DAY)].pop()?.[0];
    if (found) return found.trim();
  }
  return null;
}

/** Above the Observation if the card shows one, else under its Issue line, else last. */
function withLine(content: string, line: string): string {
  const observation = content.indexOf("**Observation of Offense:**");
  if (observation >= 0) return `${content.slice(0, observation)}${line}\n\n${content.slice(observation)}`;
  const lines = content.split("\n");
  const issue = lines.findIndex((text) => text.startsWith("**Issue:**"));
  if (issue >= 0) return [...lines.slice(0, issue + 1), "", line, ...lines.slice(issue + 1)].join("\n");
  return `${content}\n\n${line}`;
}

export function withUnreadDateAsk(response: AskResponse, request: AskRequest): AskResponse {
  if (!unreadDateAskEnabled()) return response;
  const proposal = response.formProposal;
  if (!proposal || proposal.formDate || /\*\*Date:\*\*/.test(response.content)) return response;
  const history = (request.history ?? []) as readonly Turn[];
  const said = unreadDayIn([...history.filter((turn) => turn.role === "user").map((turn) => turn.content), request.question]);
  if (!said) return response;
  const line = `**Date:** I couldn't read "${said}" — which date? (for example 10/20), or set it on the form.`;
  return { ...response, content: withLine(response.content, line) };
}
