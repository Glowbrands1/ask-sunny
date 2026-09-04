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
 * NOW LOAD-BEARING: `getAuthProvider()` uses this to decide whether live mode
 * can offer real authentication at all, and the browser client uses the same
 * two values to sign somebody in. A live deployment missing either one gets the
 * unconfigured provider, which refuses — not a downgrade to the role switcher.
 *
 * Presence of the URL does not mean the database is reachable or migrated — it
 * only means this build was configured to attempt live mode.
 */
export function supabasePublicConfigured(): boolean {
  return (
    supabaseUrlUsable(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim())
  );
}

/**
 * Whether a value can actually be used as a Supabase URL.
 *
 * PRESENT IS NOT THE SAME AS USABLE, and the difference is not academic: the
 * Supabase client constructor THROWS on a malformed URL. Treating a
 * scheme-less value as "configured" therefore turns every protected request
 * into a 500 from deep inside a library, instead of the app saying which
 * variable is wrong. Found exactly that way — a deployment environment held a
 * URL with no `https://` prefix, and the failure surfaced as
 * "Invalid supabaseUrl" from the client rather than as a configuration report.
 *
 * So the shape is checked here, where "is this deployment configured?" is
 * answered, and a malformed URL is reported as NOT configured. Live mode then
 * refuses and names the variable, which is a fixable message.
 */
export function supabaseUrlUsable(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
