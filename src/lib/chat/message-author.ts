import type { ChatMessage, ChatMessageAuthor, User } from "@/types";

/**
 * ============================================================================
 * WHOSE INITIALS GO BESIDE A QUESTION
 * ============================================================================
 *
 * The avatar used to be the signed-in person's initials, always. On a shared
 * salon computer that is wrong in the worst direction: this browser's history
 * holds threads other people started, and every one of their questions was
 * drawn as if the person now at the keyboard had asked it.
 *
 * In order:
 *
 *   THE STAMP WINS. A question sent since `author` existed says who asked it.
 *
 *   AN ACCOUNT CONVERSATION IS THE ACCOUNT'S. Anything the server returned for
 *   this session is scoped to its `user_id`, so its unstamped turns are the
 *   signed-in person's own.
 *
 *   OTHERWISE NOBODY. An unstamped thread that exists only in this browser could
 *   be anybody's who used it. Null renders a neutral avatar rather than a guess.
 *
 * Client-safe and pure.
 */

/** The stamp a question gets when the signed-in person sends it. */
export function authorFromSession(
  user: Pick<User, "id" | "avatarInitials">,
  displayName: string,
): ChatMessageAuthor {
  return { userId: user.id, name: displayName, initials: user.avatarInitials };
}

export function askerFor(
  message: Pick<ChatMessage, "author">,
  signedIn: ChatMessageAuthor,
  ownedBySignedIn: boolean,
): ChatMessageAuthor | null {
  if (message.author) return message.author;
  return ownedBySignedIn ? signedIn : null;
}
