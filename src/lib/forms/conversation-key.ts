/**
 * The conversation half of a duplicate-create key.
 *
 * An explicit conversation id wins. Otherwise the first message id already
 * sent with the create is the conversation. A proposal id alone is the
 * other half, applied by the caller.
 */

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function conversationKeyOf(input: {
  readonly conversationId?: unknown;
  readonly conversation?: unknown;
}): string | null {
  if (typeof input.conversationId === "string" && ID.test(input.conversationId)) return input.conversationId;
  if (!Array.isArray(input.conversation)) return null;
  for (const turn of input.conversation) {
    if (!turn || typeof turn !== "object") continue;
    const id = (turn as { id?: unknown }).id;
    if (typeof id === "string" && ID.test(id)) return id;
  }
  return null;
}
