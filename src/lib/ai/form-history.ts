/**
 * History that belongs to the form being read.
 *
 * A fresh chat whose current turn is not yet in history used to keep only
 * the last assistant line. That dropped the manager's first message. One
 * earlier manager message is that opening account, and it stays. A later
 * re-send of it is a harness event, not a failed case.
 */

export interface FormHistoryTurn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
}

export function keptFormHistory<T extends FormHistoryTurn>(
  history: readonly T[],
  scopedFirstId: string | undefined,
  scopedCount: number,
): T[] {
  const at = scopedFirstId ? history.findIndex((message) => message.id === scopedFirstId) : -1;
  if (at >= 0) return history.slice(at);
  if (scopedFirstId && scopedCount === 1) {
    const users = history.filter((message) => message.role === "user");
    const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
    if (users.length <= 1) return [...users, ...(lastAssistant ? [lastAssistant] : [])];
    return lastAssistant ? [lastAssistant] : [];
  }
  return [...history];
}

/** True when the model payload no longer contains the chat's first manager message. */
export function firstMessageDropped(history: readonly FormHistoryTurn[], payload: readonly FormHistoryTurn[]): boolean {
  const first = history.find((message) => message.role === "user" && message.content.trim());
  if (!first) return false;
  return !payload.some((message) => message.role === "user" && message.content === first.content);
}
