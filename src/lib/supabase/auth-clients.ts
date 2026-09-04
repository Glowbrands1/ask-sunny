import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  SUPABASE_URL_ENV,
  requireEnv,
} from "@/lib/config/server-env";

/**
 * THE SESSION CLIENT — the one Supabase client that acts AS THE SIGNED-IN
 * PERSON rather than as the server.
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE FILE FROM `server.ts`
 * ============================================================================
 *
 * `server.ts` holds `getSupabaseAdmin()`, which carries the secret key and
 * bypasses row level security entirely. This file carries the PUBLISHABLE key
 * and is bound to the caller's session cookies, so every query it makes is
 * subject to RLS with `auth.uid()` set to that person.
 *
 * The two must never be confused, and the failure mode is asymmetric: using
 * the session client where the admin client is needed produces a visible
 * permission error, while using the admin client as somebody's session client
 * silently serves every row in the database to whoever asked. So they live
 * apart, are named for what they are, and this one never reads a secret key —
 * `requireEnv(SUPABASE_PUBLISHABLE_KEY_ENV)` is the only key it can obtain.
 *
 * `import "server-only"` still applies. The publishable key is browser-safe,
 * but the COOKIES are not: this client reads and writes the session cookies of
 * whoever made the request, so it belongs to a request scope and must not be
 * constructed anywhere a request scope is ambiguous.
 */

/**
 * A client bound to the caller's cookies, for use in a Server Component or a
 * route handler.
 *
 * Cookie WRITES are attempted and swallowed. Next refuses `cookies().set()`
 * during the render of a Server Component, and a refreshed token that cannot
 * be written back is not an error worth failing a page render over — the
 * session is still valid for this request, and the next request that runs
 * through middleware or a route handler will persist the rotation. Letting the
 * exception escape would turn a routine token refresh into a 500 on an
 * otherwise healthy page.
 */
export async function getSupabaseSessionClient(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(
    requireEnv(SUPABASE_URL_ENV),
    requireEnv(SUPABASE_PUBLISHABLE_KEY_ENV),
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(entries) {
          try {
            for (const { name, value, options } of entries) {
              store.set(name, value, options);
            }
          } catch {
            /* Read-only cookie store during a Server Component render. */
          }
        },
      },
    },
  );
}

/**
 * A client bound to an EXPLICIT cookie jar rather than to `next/headers`.
 *
 * Two callers need this. Middleware holds a request/response pair rather than
 * the `cookies()` store, and it is the one place a rotated token can actually
 * be written back. And the auth provider identifies a caller from a raw
 * `Headers` object, because that is the shape `AuthProvider.identify()` is
 * defined against — which is what keeps the provider interface free of any
 * dependency on the web framework.
 */
export function getSupabaseSessionClientFor(jar: {
  getAll(): { name: string; value: string }[];
  setAll(entries: { name: string; value: string; options?: unknown }[]): void;
}): SupabaseClient {
  return createServerClient(
    requireEnv(SUPABASE_URL_ENV),
    requireEnv(SUPABASE_PUBLISHABLE_KEY_ENV),
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (entries) => jar.setAll(entries),
      },
    },
  );
}

/**
 * A read-only cookie jar built from a request's `cookie` header.
 *
 * Used by the auth provider, which is handed `Headers` and nothing else.
 * `setAll` is a deliberate no-op: identifying a caller must never mutate their
 * session, and a provider that could write cookies would be able to rotate a
 * token during what is supposed to be a pure read.
 */
export function cookieJarFromHeaders(headers: Headers) {
  const raw = headers.get("cookie") ?? "";
  return {
    getAll() {
      if (!raw.trim()) return [];
      return raw
        .split(";")
        .map((part) => {
          const value = part.trim();
          if (!value) return null;
          const eq = value.indexOf("=");
          // A cookie with no '=' is malformed; skip it rather than inventing a
          // name with an empty value, which would look like a real cookie.
          if (eq <= 0) return null;
          return {
            name: value.slice(0, eq),
            value: decodeURIComponent(value.slice(eq + 1)),
          };
        })
        .filter((entry): entry is { name: string; value: string } => entry !== null);
    },
    setAll() {
      /* Identification is a read. It does not rotate anybody's session. */
    },
  };
}
