import "server-only";

import { createHash } from "node:crypto";

/**
 * The opaque key a browser stamps its chats with (NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED,
 * `chat/local-owner.ts`): stable per account, and not the account id.
 */
export function accountKey(subject: string): string {
  return createHash("sha256").update(`chat-local-owner:${subject}`).digest("hex").slice(0, 24);
}
