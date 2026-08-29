/**
 * RUNTIME MODE — the one place the app decides whether it is running the
 * seeded demo or talking to live services.
 *
 * Client-safe: reads only NEXT_PUBLIC_ variables, which are compile-time
 * inlined by Next. No secret is ever read here.
 *
 * Two rules this module exists to enforce:
 *   1. Demo mode works with no Supabase, no Anthropic and no Voyage.
 *   2. Live mode NEVER silently falls back to seeded answers. If live mode is
 *      requested and a service is missing, the app reports the missing
 *      configuration — it does not quietly hand the question to the mock.
 */

export type RuntimeMode = "demo" | "live";

/**
 * Demo mode is the default. It is switched off explicitly by setting
 * NEXT_PUBLIC_DEMO_MODE=false, which is what a production deployment does.
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false";
}

export function runtimeMode(): RuntimeMode {
  return isDemoMode() ? "demo" : "live";
}

/**
 * True when the browser bundle has been given the public Supabase values.
 * Presence of the URL does not mean the database is reachable or migrated —
 * it only means this build was configured to attempt live mode.
 */
export function supabasePublicConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
