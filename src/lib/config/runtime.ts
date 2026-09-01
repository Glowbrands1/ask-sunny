/**
 * RUNTIME MODE — the one place the app decides whether it is running the
 * seeded demo or talking to live services.
 *
 * Client-safe: reads only NEXT_PUBLIC_ variables, which are compile-time
 * inlined by Next. No secret is ever read here.
 *
 * Two rules this module exists to enforce:
 *   1. Demo mode works with no Supabase and no Anthropic.
 *   2. Live mode NEVER silently falls back to seeded answers. If live mode is
 *      requested and a service is missing, the app reports the missing
 *      configuration — it does not quietly hand the question to the mock.
 */

export type RuntimeMode = "demo" | "live";

/**
 * THE SINGLE SOURCE OF TRUTH FOR DEMO MODE.
 *
 * Every module that needs to know asks this function. It used to be read in two
 * places with contradictory defaults — `runtime.ts` treated an unset variable as
 * DEMO, `session-context.tsx` treated it as LIVE — so a deployment that simply
 * never set the variable ran with a permissive data layer behind a login screen
 * that offered no way in. Neither module was wrong on its own; having two
 * answers was.
 *
 * THE THREE STATES, and they are exhaustive:
 *
 *   "false"  LIVE. Seeded content is off; Chat, Knowledge and Forms use the
 *            configured services and report missing configuration rather than
 *            falling back to a mock. The login screen offers no demo entry, so
 *            a real identity provider must be connected for anyone to sign in.
 *
 *   "true"   DEMO. Seeded content throughout, and the login screen offers the
 *            role-preview entry. Note that Salon Performance still reads real
 *            reporting data: it queries Supabase directly and does not consult
 *            this flag.
 *
 *   unset    DEMO, identical to "true". A prototype with no configuration must
 *            start rather than fail, and demo mode is the state that needs no
 *            services at all. Live mode is the deliberate choice, and it is
 *            made by writing the word "false".
 *
 * Only the exact string "false" selects live mode. Anything else — "0", "no",
 * "False", a typo — is demo, because a misspelled variable must not silently
 * point a prototype at live services.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}

export function runtimeMode(): RuntimeMode {
  return isDemoMode() ? "demo" : "live";
}

/**
 * True when the browser bundle has been given the public Supabase values.
 *
 * NOT YET USED, and deliberately not wired into readiness: every Supabase call
 * currently runs server-side under the secret key, so the browser needs neither
 * value. This becomes the gate for the browser client that arrives with
 * authentication.
 *
 * Presence of the URL does not mean the database is reachable or migrated — it
 * only means this build was configured to attempt live mode.
 */
export function supabasePublicConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
