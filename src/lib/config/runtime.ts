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
 * THE WORD IS MATCHED CASE-INSENSITIVELY, AND SURROUNDING WHITESPACE IS
 * IGNORED. "false", "False" and "FALSE" all select live mode, as does " false ".
 *
 * This used to demand the exact lowercase string, on the reasoning that a
 * misspelling must not silently point a prototype at live services. The
 * reasoning was sound and the rule was still wrong, because the failure it
 * produced was the more dangerous of the two: a Production environment holding
 * "False" ran the SEEDED DEMO while every other signal said it was live, and
 * the only symptom was demo content on a real deployment. Nobody typing "False"
 * into a variable named DEMO_MODE means "give me the mock".
 *
 * Case and padding are typography, not intent. Anything that is not the word
 * false — "0", "no", "off", a typo — is still demo, so a genuinely misspelled
 * variable still fails safe.
 *
 * AND ON A REAL VERCEL PRODUCTION DEPLOYMENT, NONE OF THAT DECIDES ANYTHING —
 * production is live. See `modeSource()` below for why that rule had to exist.
 */

/** Trimmed and lowercased, with an absent variable and an empty one the same. */
function normalised(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Which Vercel environment this bundle was BUILT for: "production", "preview",
 * "development", or "" when it was not built on Vercel at all.
 *
 * Vercel sets this itself, per deployment, from the environment it is building
 * — it is not a value anybody types into the dashboard. That is the entire
 * reason it can be trusted here when NEXT_PUBLIC_DEMO_MODE cannot: it is
 * incapable of being stale with respect to the deployment carrying it.
 *
 * Public on purpose. The mode decision has to come out the same in the browser
 * as on the server or the two renders disagree, so the signal it rests on must
 * be one the browser can also see. `VERCEL_ENV` — the server-only twin — would
 * read "production" on the server and `undefined` in the client bundle, which
 * is a hydration mismatch dressed up as a fix.
 */
export function deploymentEnvironment(): string {
  return normalised(process.env.NEXT_PUBLIC_VERCEL_ENV);
}

/** True only on a deployment Vercel itself built for the Production environment. */
export function isProductionDeployment(): boolean {
  return deploymentEnvironment() === "production";
}

/**
 * The deliberate, default-off way to run a Production deployment in demo mode.
 *
 * It exists so the rule below is reversible without a code change. Nothing sets
 * it, and until something does, Production is live.
 */
function demoExplicitlyAllowedInProduction(): boolean {
  return normalised(process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION) === "true";
}

export type ModeSource =
  /** A real Vercel Production deployment. Overrides the flag entirely. */
  | "production-deployment"
  /** The flag said the word false. */
  | "explicit-live"
  /** The flag said the word true. */
  | "explicit-demo"
  /** No usable flag, and not Production. The safe default. */
  | "default-demo";

/**
 * THE ONE MODE DECISION. `isDemoMode()` is derived from it and nothing else
 * reads the environment to answer this question.
 *
 * ==========================================================================
 * WHY PRODUCTION IGNORES THE FLAG
 * ==========================================================================
 *
 * NEXT_PUBLIC_ VARIABLES ARE FROZEN INTO THE BUNDLE AT BUILD TIME. Next
 * substitutes them during compilation, so the value a deployment behaves by is
 * whatever the dashboard held when that build ran. Measured on this codebase,
 * building with NEXT_PUBLIC_DEMO_MODE="True" and then serving with it set to
 * "False" reports demo mode — and BOTH read styles report the stale value:
 * `process.env.NEXT_PUBLIC_DEMO_MODE` and `process.env[name]` alike. There is
 * no read that recovers the runtime value. Editing the variable changes
 * nothing until a rebuild, and the rebuild bakes in whatever it then finds.
 *
 * That is not a hypothetical. Production served https://ask-sunny.vercel.app
 * with `{"mode":"demo","configured":true,"missingEnvironmentVariables":[]}` —
 * every credential present and working, and seeded demo content on the page
 * anyway, because one build-time string had gone stale. Case-insensitive
 * parsing did not help, because parsing was never what was broken.
 *
 * So the flag is the wrong thing for Production to depend on, and the fix is
 * not a better parser. On a deployment Vercel built for Production, the answer
 * comes from the deployment itself.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not make every deployment live.
 * Preview and local are untouched and still read the flag exactly as before,
 * which is where demo mode is actually used — that is the whole point of
 * keying on the environment rather than loosening the parser again.
 *
 * IT ALSO OVERRIDES AN EXPLICIT "true" IN PRODUCTION, and that is the one
 * genuinely opinionated line here. It is deliberate. Demo mode in Production
 * is not a harmless display choice: `getAuthProvider()` answers demo mode with
 * `DemoAuthProvider`, the role switcher that lets ANY visitor pick a manager
 * role and walk in, and `getAIProvider()` answers it with `MockAIProvider`,
 * which invents policy. A manager reading fabricated coaching guidance off a
 * production URL is the failure this codebase is arranged to prevent. Between
 * honouring a string and refusing to serve seeded HR content from the
 * production domain, the string loses. NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION
 * exists for whoever genuinely wants the other answer.
 *
 * NOT GATED ON CREDENTIALS, on purpose. "Live services are configured" is
 * knowable on the server and not in the browser — ANTHROPIC_API_KEY is
 * server-only and always will be — so gating on it would make the server and
 * the client disagree about the mode, which is the hydration bug this file
 * already exists to prevent. A Production deployment missing credentials
 * therefore reports the missing variable by name and refuses, which is this
 * codebase's existing contract. It never quietly serves the mock instead.
 */
export function modeSource(): ModeSource {
  if (isProductionDeployment() && !demoExplicitlyAllowedInProduction()) {
    return "production-deployment";
  }

  const flag = normalised(process.env.NEXT_PUBLIC_DEMO_MODE);
  if (flag === "false") return "explicit-live";
  if (flag === "true") return "explicit-demo";
  return "default-demo";
}

export function isDemoMode(): boolean {
  const source = modeSource();
  return source !== "production-deployment" && source !== "explicit-live";
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
