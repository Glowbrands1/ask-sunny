import "server-only";

import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  SUPABASE_URL_ENV,
} from "@/lib/config/server-env";
import {
  cookieJarFromHeaders,
  getSupabaseSessionClientFor,
} from "@/lib/supabase/auth-clients";
import { getAppUser, type ProfileDenial } from "./app-user";
import type {
  AuthenticatedIdentity,
  AuthProvider,
  AuthRequestContext,
} from "./types";

/**
 * ============================================================================
 * SupabaseAuthProvider — the real one.
 * ============================================================================
 *
 * `isProductionGrade = true` and `verified = true`, and both are earned rather
 * than asserted. Two independent facts have to hold before this returns an
 * identity:
 *
 *   1. Supabase Auth validated the session token. `getUser()` is what does
 *      this, and the distinction from `getSession()` is the whole point —
 *      `getSession()` decodes whatever is in the cookie and hands it back
 *      WITHOUT verifying the signature, so a forged cookie satisfies it.
 *      `getUser()` calls the auth server and validates. An authorization
 *      decision may only ever rest on the second.
 *
 *   2. `public.app_users` holds an ACTIVE profile for that subject. This is
 *      where the role comes from. A valid credential with no profile is not a
 *      user of this application, and gets nothing.
 *
 * Neither fact can be supplied by the caller. The cookie is signed by Supabase,
 * and the profile is a server-side read under row level security.
 *
 * NOTHING IS LOGGED HERE. Not the token, not the cookie, not the refresh
 * token, not the subject id. `identify()` runs on every protected request, so
 * a single well-meaning `console.log` in this file would put access tokens
 * into the platform's log stream at the rate of the whole application's
 * traffic.
 */
export class SupabaseAuthProvider implements AuthProvider {
  readonly kind = "supabase" as const;
  readonly name = "Supabase Auth";
  readonly isProductionGrade = true;

  /**
   * Only the PUBLIC pair is listed. The secret key is emphatically not part of
   * this provider's configuration: it bypasses row level security and is never
   * used to identify a caller. `missingConfiguration` is also surfaced to the
   * Integrations screen, so listing a secret's NAME here would be the correct
   * amount of disclosure — but listing it at all would imply this provider
   * needs it, and it must not.
   */
  get missingConfiguration(): string[] {
    return [SUPABASE_URL_ENV, SUPABASE_PUBLISHABLE_KEY_ENV].filter(
      (name) => !process.env[name]?.trim(),
    );
  }

  /**
   * The most recent reason a caller was refused, for the sign-in screen to
   * explain itself with.
   *
   * Per-instance rather than returned, because `AuthProvider.identify()` is
   * defined to return `null` for "not signed in" and changing that shape would
   * move every call site — which is exactly what the seam exists to prevent.
   * The value is a REASON CODE, never a token, an email or a row.
   *
   * It is last-writer-wins across concurrent requests, which is acceptable
   * because nothing authorizes on it: it only ever improves an error message,
   * and a stale code produces a slightly less specific sentence.
   */
  lastDenial: ProfileDenial | null = null;

  async identify(context: AuthRequestContext): Promise<AuthenticatedIdentity | null> {
    if (this.missingConfiguration.length > 0) return null;

    const client = getSupabaseSessionClientFor(cookieJarFromHeaders(context.headers));

    /*
     * getUser(), never getSession(). See the note above — this is the line that
     * makes the provider production-grade, and it is worth the round trip.
     */
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) {
      this.lastDenial = null; // Not signed in is not a denial reason.
      return null;
    }

    const subject = data.user;
    const lookup = await getAppUser(client, subject.id);
    if (!lookup.ok) {
      /*
       * A VALID CREDENTIAL AND NO USABLE PROFILE. Returning null means the
       * guard raises "unauthenticated", which is the right answer: this person
       * is not a user of this application, whatever they hold.
       */
      this.lastDenial = lookup.denial;
      return null;
    }

    this.lastDenial = null;
    const profile = lookup.profile;

    return {
      subject: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      /*
       * FROM THE PROFILE ROW. Not from `subject.user_metadata`, which the
       * account holder can write to themselves via the Supabase client — a
       * role read from there would be a self-service promotion.
       */
      role: profile.role,
      scope: profile.scope,
      verified: true,
    };
  }
}
