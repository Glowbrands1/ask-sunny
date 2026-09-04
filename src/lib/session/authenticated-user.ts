import { ROLE_LABEL } from "@/lib/permissions";
import type { AccessScope, Role, User } from "@/types";

/**
 * THE AUTHENTICATED SESSION, as it crosses from the server into the browser.
 *
 * A plain object on purpose — it is serialized through a Server Component's
 * props, so it holds no class instances, no dates and no functions.
 *
 * WHAT IS NOT HERE MATTERS MORE THAN WHAT IS. No access token, no refresh
 * token, no session object. The browser holds its Supabase session in an
 * HTTP-only cookie it cannot read, and this is the app's own description of
 * who that cookie belongs to — the profile, not the credential.
 */
export interface AuthenticatedSession {
  subject: string;
  email: string;
  displayName: string;
  role: Role;
  scope: AccessScope;
}

/** Initials for the avatar, from whatever the display name turns out to be. */
export function initialsFor(displayName: string, email: string): string {
  const source = displayName.trim() || email.trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[words.length - 1]![0]}`.toUpperCase();
}

/**
 * Builds the `User` object the UI renders from an authenticated session.
 *
 * The UI has always been handed a `User`, and every screen reads it. Rather
 * than change all of them, a real session is projected into the same shape —
 * which is also what keeps the demo and real paths from diverging into two
 * different sets of components.
 *
 * FIELDS THE PROFILE DOES NOT CARRY ARE FILLED HONESTLY, not plausibly:
 *
 *   title           The role's own label. A real job title is not in
 *                   `app_users`, and inventing one would put a fabricated
 *                   string on screen next to a real person's name.
 *   isSalonAccount  False. This described a demo convention where a whole salon
 *                   shared one seeded login; a real profile is one person.
 *   lastActiveAt    Now. This render IS the activity, so it is the one value
 *                   here that is not a guess.
 *   createdAt       Empty. Available from the profile row where a screen needs
 *                   it, and not smuggled in as a plausible-looking timestamp.
 */
export function userFromSession(session: AuthenticatedSession): User {
  return {
    id: session.subject,
    name: session.displayName,
    email: session.email,
    role: session.role,
    scope: session.scope,
    isSalonAccount: false,
    active: true,
    avatarInitials: initialsFor(session.displayName, session.email),
    title: ROLE_LABEL[session.role],
    lastActiveAt: new Date().toISOString(),
    createdAt: "",
  };
}
