/**
 * A longer history window.
 *
 * The answering call used to send the last 10 non-empty messages. That cap
 * exists because every prior turn is sent again, on the answering model, on
 * every question. Ten turns bounds that cost and the latency that comes with it.
 *
 * With the flag on, the window is the newest messages that fit in a token
 * budget, and at most 40 of them. Turns that fall outside become a short
 * summary instead of being sent in full. A rough token is four characters.
 */

export const LONG_CONTEXT_MAX_MESSAGES = 40;
export const LONG_CONTEXT_TOKEN_BUDGET = 6000;

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function selectLongContext<T extends { content: string }>(
  messages: readonly T[],
  options: { readonly maxMessages?: number; readonly tokenBudget?: number } = {},
): { kept: T[]; older: T[] } {
  const maxMessages = options.maxMessages ?? LONG_CONTEXT_MAX_MESSAGES;
  const tokenBudget = options.tokenBudget ?? LONG_CONTEXT_TOKEN_BUDGET;
  const kept: T[] = [];
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.content.trim().length === 0) continue;
    const next = estimateTokens(message.content);
    const overBudget = tokens + next > tokenBudget && kept.length > 0;
    if (kept.length >= maxMessages || overBudget) break;
    kept.push(message);
    tokens += next;
  }
  kept.reverse();
  const keptSet = new Set(kept);
  const older = messages.filter((message) => message.content.trim().length > 0 && !keptSet.has(message));
  return { kept, older };
}
