import "server-only";

import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getSupabaseSessionClientFor } from "@/lib/supabase/auth-clients";

/**
 * Exchanges a one-time PKCE code for a session, writing the session cookies
 * onto the RESPONSE that is about to be returned.
 *
 * ============================================================================
 * WHY THE RESPONSE HAS TO EXIST FIRST
 * ============================================================================
 *
 * A route handler that writes to the `cookies()` store and then returns a
 * `NextResponse.redirect` loses those writes: the redirect is a different
 * response object, and the store's mutations do not follow it. So the caller
 * builds the redirect first and hands it here, and the Supabase client sets
 * cookies directly on it.
 *
 * Shared by `/auth/recovery` and `/auth/callback` so there is ONE
 * implementation of this. They differ only in where they send somebody
 * afterwards — recovery to a fixed path, the older callback to a validated
 * same-site one — and that difference stays in the routes, where it is visible.
 *
 * ============================================================================
 * THE CODE IS A CREDENTIAL
 * ============================================================================
 *
 * It is passed to Supabase and dropped. It is never logged, never returned,
 * never put in a message: a code in a log is a credential in a log aggregator,
 * and a code reflected into an error page is one in a browser history and a
 * referrer header. This function's entire result is a boolean.
 */
export async function exchangeCodeOntoResponse(
  code: string,
  response: NextResponse,
): Promise<boolean> {
  const store = await cookies();

  const client = getSupabaseSessionClientFor({
    getAll: () => store.getAll(),
    setAll: (entries) => {
      for (const entry of entries) {
        response.cookies.set({
          name: entry.name,
          value: entry.value,
          ...(entry.options as Record<string, unknown>),
        });
      }
    },
  });

  const { error } = await client.auth.exchangeCodeForSession(code);

  // Deliberately a boolean. The provider's message can name the code and says
  // nothing a person can act on beyond "the link did not work".
  return !error;
}
