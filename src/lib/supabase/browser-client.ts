"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseUrlUsable } from "@/lib/config/runtime";

/**
 * THE BROWSER CLIENT — used for exactly three things and nothing else:
 * signing in, requesting a password reset, and signing out.
 *
 * ============================================================================
 * WHAT THIS CLIENT IS NOT FOR
 * ============================================================================
 *
 * It is not for reading application data. Every read that decides what a
 * person may see happens on the server, against `app_users`, because a client
 * holds no authority over its own permissions. This client's entire job is to
 * exchange a password for a session cookie and to end that session.
 *
 * It carries the PUBLISHABLE key, which is compiled into the bundle and is
 * meant to be public. There is no code path from here to the secret key:
 * `server.ts` and `auth-clients.ts` both declare `import "server-only"`, so
 * importing either from a client component is a build error rather than a
 * review catch.
 *
 * NO CREDENTIAL IS EVER STORED. The password is passed straight to Supabase
 * Auth and never written to state that outlives the call, never logged, and
 * never sent anywhere else. Ask Sunny has no password database of its own and
 * hashes nothing itself — that is Supabase Auth's job, and duplicating it
 * would mean owning a credential store we have no business owning.
 */

let client: SupabaseClient | null = null;

/**
 * Throws a plain, user-facing error when the build was not given the public
 * Supabase values, naming the VARIABLES rather than dumping a stack. A login
 * screen that says "NEXT_PUBLIC_SUPABASE_URL is not configured" is diagnosable;
 * one that says "Cannot read properties of undefined" is not.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // `supabaseUrlUsable` rather than a presence check, so a scheme-less URL
  // produces this sentence instead of "Invalid supabaseUrl" from the library.
  const missing = [
    !supabaseUrlUsable(url) ? "NEXT_PUBLIC_SUPABASE_URL" : null,
    !key?.trim() ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" : null,
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new Error(
      `Sign-in is not configured for this deployment. Missing: ${missing.join(", ")}.`,
    );
  }

  client = createBrowserClient(url!, key!);
  return client;
}

/** True when this build can attempt a sign-in at all. */
export function browserAuthConfigured(): boolean {
  return (
    supabaseUrlUsable(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim())
  );
}
