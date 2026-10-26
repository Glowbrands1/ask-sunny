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

/** The turn with each bare salon comma part written as "at <salon>". */
export function placesMarked(text: string): string {
  if (typeof text !== "string" || !text.includes(",")) return text;
  const parts = text.split(/(,\s*)/);
  let changed = false;
  for (let index = 2; index < parts.length; index += 2) {
    const part = parts[index]!;
    const bare = part.trim();
    if (!bare || /^(?:at|in|from)\b/i.test(bare) || bare.split(/\s+/).length > 3 || !READERS.place(bare)) continue;
    parts[index] = part.replace(bare, `at ${bare}`);
    changed = true;
  }
  return changed ? parts.join("") : text;
}
