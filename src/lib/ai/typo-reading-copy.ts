import { typoReadingCopyEnabled } from "@/lib/config/chat-quality-flags";
import { correctedText } from "@/lib/forms/typo-match";
import { typoVocabulary } from "@/lib/forms/typo-vocabulary";

import type { AskRequest } from "./types";

/**
 * TYPO_READING_COPY_ENABLED (QA, 27 Oct 2026; same flag in both apps): the
 * chat's readers see the manager's turns with each typo read as the one known
 * word it can only be — "coahed" coached, "amont" amount, "Manger" manager —
 * by the rules in `forms/typo-match.ts` (one edit, same first letter, no tie).
 * An employee's first, last or preferred name is never corrected. This is the
 * READING copy only: the stored messages, and so the record and the draft
 * notes, keep exactly what the manager typed. Off, the request as given.
 */
export function withTypoReadingCopy(request: AskRequest, names: ReadonlySet<string>): AskRequest {
  // "*": the directory could not be read, so no name is known to be safe — nothing is corrected.
  if (!typoReadingCopyEnabled() || names.has("*")) return request;
  const read = (text: string) => correctedText(text, typoVocabulary(), (word) => names.has(word)).text;
  const question = read(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = read(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/** Every employee name word, lower-cased, from directory rows. */
export function nameWords(
  people: readonly { firstName: string | null; lastName: string | null; preferredFirstName?: string | null }[],
): Set<string> {
  const out = new Set<string>();
  for (const person of people) {
    for (const part of [person.firstName, person.lastName, person.preferredFirstName]) {
      for (const word of (part ?? "").toLowerCase().split(/[^a-z]+/)) if (word) out.add(word);
    }
  }
  return out;
}
