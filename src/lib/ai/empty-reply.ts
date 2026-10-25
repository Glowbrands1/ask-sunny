import { AiError } from "./errors";
import type { AskResponse } from "./types";

/**
 * A TURN NEVER SAVES OR SHOWS A BLANK ANSWER.
 *
 * A failed turn already stores `content: ""` beside `metadata.error`, and the
 * thread renders that as an error card. A SUCCESSFUL answer with nothing in it
 * has no such card: the manager sees an empty bubble and the history keeps an
 * empty assistant row that looks like a failure nobody recorded. The model
 * itself cannot produce one (an empty stream is already `model_failed` in
 * `callClaude`), but the post-processors after it (marker stripping, the
 * cross-chat and shared-sources passes, the manual citation pass) and any
 * future branch that returns early can.
 *
 * An answer is blank when its prose is empty AND it carries nothing else for
 * the manager to act on. A form card, a form choice, an opened form or a form
 * update is an answer even when the sentence beside it is short.
 */

export const EMPTY_REPLY_MESSAGE =
  "Sunny did not write an answer to that, so nothing is shown. Nothing was answered from memory — try again in a moment.";

export function isEmptyReply(answer: Partial<AskResponse> | null | undefined): boolean {
  if (!answer) return true;
  const prose = typeof answer.content === "string" ? answer.content.trim() : "";
  if (prose.length > 0) return false;
  return !answer.formProposal && !answer.formSelection && !answer.formOpened && !answer.formUpdate;
}

export function emptyReplyError(): AiError {
  return new AiError("model_failed", EMPTY_REPLY_MESSAGE, 502);
}
