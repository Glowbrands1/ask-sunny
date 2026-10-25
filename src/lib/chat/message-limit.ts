/**
 * How long one chat message may be, and what to tell the manager about it.
 *
 * Client-safe: no server-only import, no environment read. The route and the
 * composer both use these numbers and this wording, so the warning a manager
 * sees before sending and the error the server returns cannot disagree.
 *
 * THE LIMIT. 4,000 characters is the limit main ships. With
 * CHAT_LONG_MESSAGE_ENABLED on it is 12,000. Pau's decision (25 Oct 2026):
 * raise it, warn before sending, never cut text silently. 12,000 comes from
 * the production data and the prompt budget:
 *
 *   - Ask Sunny, 3,131 manager messages (26 Aug to 25 Oct 2026): median 43
 *     characters, p99 401, p99.9 about 2,000, longest 5,089. Exactly one went
 *     over 4,000 (a 5,089-character paste); the route refused it after it was
 *     sent and the manager left the conversation. None is exactly 4,000, so
 *     nothing stored was cut.
 *   - Ask Bubbles, 908 manager messages (6 to 25 Oct 2026): p99 251, longest
 *     507.
 *   - 12,000 characters is about 3,000 tokens (4 characters a token), roughly
 *     2.4 times the longest message either app has seen, and room for a
 *     pasted policy section or a written statement plus a question.
 *   - The answering model has a 1M-token window. The largest prompt is the
 *     full-manual path: a 120,000-token manual budget, the system rules, ten
 *     history turns and the question, under 4,096 output tokens. Ten 12,000
 *     character turns add about 30,000 tokens, so the worst case stays well
 *     under a quarter of the window. The Haiku query rewrite (200K window)
 *     reads the question and short excerpts only.
 *   - The chat trace keeps 12,000 characters of the question
 *     (`redactTraceText`), so a message at the limit is traced in full.
 */

export const LEGACY_MESSAGE_LIMIT = 4_000;
export const LONG_MESSAGE_LIMIT = 12_000;

/** The counter turns into a warning at this share of the limit. */
export const MESSAGE_WARNING_RATIO = 0.9;

export function chatMessageLimit(longMessagesEnabled: boolean): number {
  return longMessagesEnabled ? LONG_MESSAGE_LIMIT : LEGACY_MESSAGE_LIMIT;
}

export type MessageLengthState = "ok" | "near" | "over";

export interface MessageLengthStatus {
  readonly state: MessageLengthState;
  /** Characters after trimming, the way the server counts them. */
  readonly length: number;
  readonly limit: number;
  /** Negative once the message is over the limit. */
  readonly remaining: number;
  /** False only when the message is over the limit. An empty message is the composer's own check. */
  readonly canSend: boolean;
  /** What to show beside the input, or null while there is nothing to say. */
  readonly notice: string | null;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}

/** The words for a message over the limit. The server's 400 uses the same sentence. */
export function messageTooLongNotice(length: number, limit: number): string {
  return `This message is ${count(length)} characters. The limit is ${count(limit)}. Shorten it or split it into two messages. Nothing was cut.`;
}

export function messageLengthStatus(text: string, limit: number): MessageLengthStatus {
  const length = text.trim().length;
  const remaining = limit - length;
  if (length > limit) {
    return { state: "over", length, limit, remaining, canSend: false, notice: messageTooLongNotice(length, limit) };
  }
  if (length >= Math.ceil(limit * MESSAGE_WARNING_RATIO)) {
    return {
      state: "near",
      length,
      limit,
      remaining,
      canSend: true,
      notice: `${count(remaining)} characters left of ${count(limit)}.`,
    };
  }
  return { state: "ok", length, limit, remaining, canSend: true, notice: null };
}
