import { namePlaceAnswerEnabled } from "@/lib/config/chat-quality-flags";
import { readSalonMentions } from "@/lib/forms/salon-mention";

import type { AskRequest } from "./types";

/**
 * NAME_PLACE_ANSWER_ENABLED: a salon named on its own in a comma list is where.
 *
 * QA live runs, 26 Oct 2026 (both apps, names invented): the answer "<name>,
 * <salon>, <title>, use today's date" to "Who is this form for?" left the salon
 * unset, while "<name>, at <salon>, …" set it; "employee name: <name>, <salon>,
 * late today" the same. The salon reader reads a bare salon word only after "at".
 *
 * Before any reader sees a manager turn, a comma part after the first that is
 * only one salon ("wornall", "lawrence") is read as "at <salon>". The rest of the
 * turn stays as typed. Off, every turn is read as typed.
 *
 * The same file in the sibling app; only `READERS` differs.
 */

/** This app's reader of one salon named on its own. */
const READERS = {
  /** The turn already names one salon the reader reads. */
  named: (text: string): boolean => readSalonMentions(text).some((mention) => mention.salonIds.length === 1),
  place: (text: string): boolean => readSalonMentions(`at ${text}`).some((mention) => mention.salonIds.length === 1),
};

export function withNamePlaceAnswer(request: AskRequest): AskRequest {
  if (!namePlaceAnswerEnabled()) return request;
  const question = placesMarked(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = placesMarked(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/** "rory vance" or "employee name: rory vance": the first comma part names the person. */
const NAME_FIRST = /^\s*(?:(?:employee(?:'s)?\s+)?name(?:\s+is)?\s*:?\s*)?[A-Za-z][A-Za-z'’-]+\s+[A-Za-z][A-Za-z'’-]+\s*$/i;
/** One to three plain words, none of them a preposition, a verb or an account word. */
const PLAIN_PLACE = /^[A-Za-z][A-Za-z.'’-]*(?:\s+[A-Za-z][A-Za-z.'’-]*){0,2}$/;
const NOT_A_PLACE_WORD = /\b(?:at|in|on|from|to|was|is|were|late|early|today|yesterday|because|of|she|he|they|her|his)\b/i;

/**
 * The turn with the salon after the name written as "at <salon>": only in
 * "<name>, <salon>[, …]", only the part right after the name, and never when
 * the turn already names a salon (QA-6, 26 Oct 2026: "…, late at lawrence"
 * became "at late at lawrence", a second salon was added, and "she was late,
 * lawrence, because of traffic" was read as the salon). With two people in
 * one turn only the first one's salon is marked.
 */
export function placesMarked(text: string): string {
  if (typeof text !== "string" || !text.includes(",") || READERS.named(text)) return text;
  const parts = text.split(/(,\s*)/);
  if (parts.length < 3 || !NAME_FIRST.test(parts[0]!)) return text;
  const bare = parts[2]!.trim();
  if (!PLAIN_PLACE.test(bare) || NOT_A_PLACE_WORD.test(bare) || !READERS.place(bare)) return text;
  parts[2] = parts[2]!.replace(bare, `at ${bare}`);
  return parts.join("");
}
