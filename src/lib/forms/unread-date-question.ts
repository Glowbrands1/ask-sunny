import { dateReaderWideEnabled } from "@/lib/config/chat-quality-flags";

import { unreadDateQuestion, unreadDateTokens } from "./date-words";
import { datesInText } from "./form-date-answer";

/**
 * DATE_READER_WIDE_ENABLED: A DATE IS NEVER DROPPED SILENTLY.
 *
 * When the manager's turn holds words that look like a date and no reader can
 * place ("13/45", "32 october", "on 1345"), a turn that makes or changes a
 * form asks about the first of them ONCE — "I couldn't read the date "13/45"
 * — which date did you mean?" — and keeps every other date it read. A reply
 * that already asks which date is meant is left alone, so nothing is asked
 * twice. Off, the answer is returned as it came.
 */
export function withUnreadDateQuestion<T extends { content: string; formProposal?: unknown; formUpdate?: unknown }>(
  answer: T,
  question: string,
  today: string,
): T {
  if (!dateReaderWideEnabled() || (!answer.formProposal && !answer.formUpdate)) return answer;
  const typed = unreadDateTokens(question ?? "", datesInText(question ?? "", today))[0];
  if (!typed || /which date|couldn't read the date|what date/i.test(answer.content)) return answer;
  return { ...answer, content: `${answer.content.trimEnd()}\n\n${unreadDateQuestion(typed)}` };
}
