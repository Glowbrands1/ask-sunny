import "server-only";

import {
  CLAUDE_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  MIGRATED_EMBEDDING_DIMENSIONS,
} from "./models";
import { isDemoMode, supabaseUrlUsable } from "./runtime";

/**
 * SERVER-ONLY CONFIGURATION.
 *
 * `import "server-only"` makes any client component that imports this module a
 * build error, so a key cannot reach the browser bundle by accident.
 *
 * Nothing in this file logs, returns or interpolates a secret VALUE. The
 * readiness helpers report presence/absence by NAME only, which is what the
 * Integrations screen and /api/health need. The key-shape guards below inspect
 * values but never emit them.
 */

export interface ServiceReadiness {
  ready: boolean;
  /** Names of the environment variables that are missing. Never values. */
  missing: string[];
}

function present(name: string): boolean {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function check(names: string[]): ServiceReadiness {
  const missing = names.filter((name) => !present(name));
  return { ready: missing.length === 0, missing };
}

export class MissingConfigurationError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Live mode is not configured. Missing environment variable${
        missing.length === 1 ? "" : "s"
      }: ${missing.join(", ")}.`,
    );
    this.name = "MissingConfigurationError";
    this.missing = missing;
  }
}

/** Throws with the variable NAME (never a value) when the key is absent. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new MissingConfigurationError([name]);
  }
  return value.trim();
}

/* ------------------------------------------------------------- Anthropic -- */

export const ANTHROPIC_ENV = ["ANTHROPIC_API_KEY"];

export function anthropicReadiness(): ServiceReadiness {
  return check(ANTHROPIC_ENV);
}

/* ------------------------------------------------------------ Embeddings -- */

/**
 * Embeddings have no credential of their own.
 *
 * The model runs inside a Supabase Edge Function (supabase/functions/embed),
 * so the only variables involved are the Supabase ones below. This is reported
 * as its own service anyway: "embeddings are unavailable" and "the database is
 * unavailable" are different failures to the person reading the Integrations
 * screen, even when they share a cause.
 */
export const EMBEDDING_ENV: string[] = [];

export function embeddingReadiness(): ServiceReadiness {
  return supabaseReadiness();
}

/* -------------------------------------------------------------- Supabase -- */

/**
 * SUPABASE KEYS — the public half and the privileged half are deliberately
 * kept apart, because conflating them is the one Supabase misconfiguration
 * that is both easy to make and catastrophic.
 *
 * BROWSER-SAFE (inlined into the client bundle by Next, so effectively
 * public whatever we do):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY   (`sb_publishable_...`)
 *
 * SERVER-ONLY AND PRIVILEGED (bypasses row level security entirely):
 *   SUPABASE_SECRET_KEY                    (`sb_secret_...`)
 *
 * Supabase's current API keys are the publishable/secret pair; `anon` and
 * `service_role` are the legacy JWT keys they replace, and are being retired.
 * A newly created project is issued both sets, so `SUPABASE_SECRET_KEY` is the
 * name to configure. `SUPABASE_SERVICE_ROLE_KEY` is still accepted as a
 * fallback so an existing deployment holding only the legacy key keeps working
 * — the two are drop-in equivalents for `createClient`.
 */
export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
export const SUPABASE_SECRET_KEY_ENV = "SUPABASE_SECRET_KEY";
/** Legacy name, still honoured. Prefer SUPABASE_SECRET_KEY for new projects. */
export const SUPABASE_SECRET_KEY_ENV_LEGACY = "SUPABASE_SERVICE_ROLE_KEY";

/** What live mode genuinely cannot run without. */
export const SUPABASE_ENV = [SUPABASE_URL_ENV, SUPABASE_SECRET_KEY_ENV];

/**
 * The privileged key, preferring the current name over the legacy one.
 *
 * Throws naming SUPABASE_SECRET_KEY — the variable a new project should set —
 * rather than the legacy name, so the error points at the right thing.
 */
export function supabaseSecretKey(): string {
  const current = process.env[SUPABASE_SECRET_KEY_ENV]?.trim();
  if (current) return current;

  const legacy = process.env[SUPABASE_SECRET_KEY_ENV_LEGACY]?.trim();
  if (legacy) return legacy;

  throw new MissingConfigurationError([SUPABASE_SECRET_KEY_ENV]);
}

export function supabaseSecretKeyConfigured(): boolean {
  return Boolean(
    process.env[SUPABASE_SECRET_KEY_ENV]?.trim() ||
      process.env[SUPABASE_SECRET_KEY_ENV_LEGACY]?.trim(),
  );
}

/** Which name supplied the key, for honest reporting. Never the value. */
export function supabaseSecretKeySource(): "current" | "legacy" | null {
  if (process.env[SUPABASE_SECRET_KEY_ENV]?.trim()) return "current";
  if (process.env[SUPABASE_SECRET_KEY_ENV_LEGACY]?.trim()) return "legacy";
  return null;
}

export function supabaseReadiness(): ServiceReadiness {
  const missing: string[] = [];
  if (!present(SUPABASE_URL_ENV)) missing.push(SUPABASE_URL_ENV);
  if (!supabaseSecretKeyConfigured()) missing.push(SUPABASE_SECRET_KEY_ENV);
  return { ready: missing.length === 0, missing };
}

/**
 * The browser key is reported but NOT required.
 *
 * No code path reads it yet: every Supabase call currently runs server-side
 * under the secret key. It becomes required when authentication ships and a
 * browser client starts making RLS-bound requests. Listing it as required
 * today would make /api/health assert something untrue and would block live
 * mode on a variable nothing consumes.
 */
export function supabaseBrowserKeyReadiness(): ServiceReadiness & {
  requiredNow: boolean;
} {
  return {
    ...check([SUPABASE_PUBLISHABLE_KEY_ENV]),
    requiredNow: false,
  };
}

/* ------------------------------------------------- key-shape safety net --- */

/**
 * Reads the `role` claim of a legacy Supabase JWT key.
 *
 * Parsed, never logged and never returned to a caller — only the derived
 * classification below escapes this module.
 */
function jwtRole(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    );
    if (payload && typeof payload === "object" && "role" in payload) {
      const role = (payload as { role: unknown }).role;
      return typeof role === "string" ? role : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when a value is a privileged key: `sb_secret_...` or a service_role JWT. */
export function looksPrivileged(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("sb_secret_") || jwtRole(trimmed) === "service_role";
}

/** True when a value is a browser-safe key: `sb_publishable_...` or an anon JWT. */
export function looksPublishable(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("sb_publishable_") || jwtRole(trimmed) === "anon";
}

/**
 * Misconfigurations that are worse than a missing variable, because the app
 * would otherwise start and behave strangely — or, in the first case, ship a
 * key that bypasses row level security to every visitor's browser.
 *
 * Returned as user-safe sentences naming variables, never values.
 */
export function configurationProblems(): string[] {
  const problems: string[] = [];

  /*
   * A malformed URL is worse than a missing one, because "present" reads as
   * "configured" everywhere it is checked while the Supabase client constructor
   * rejects it. Reported by NAME, with the required shape spelled out, and
   * never echoing the value back — a wrong URL is not a secret, but a
   * configuration report that quotes environment values is a habit that
   * eventually quotes a key.
   */
  const url = process.env[SUPABASE_URL_ENV]?.trim();
  if (url && !supabaseUrlUsable(url)) {
    problems.push(
      `${SUPABASE_URL_ENV} is not a usable URL. It must include the scheme, as in https://<project-ref>.supabase.co. Supabase's client constructor rejects anything else, so sign-in and every server query would fail.`,
    );
  }

  const publishable = process.env[SUPABASE_PUBLISHABLE_KEY_ENV]?.trim();
  if (publishable && looksPrivileged(publishable)) {
    problems.push(
      `${SUPABASE_PUBLISHABLE_KEY_ENV} holds a privileged secret key. Anything with a NEXT_PUBLIC_ prefix is compiled into the browser bundle, so this would hand every visitor a key that bypasses row level security. Move it to ${SUPABASE_SECRET_KEY_ENV} and put the publishable key here instead.`,
    );
  }

  const secretSource = supabaseSecretKeySource();
  if (secretSource) {
    const secret = supabaseSecretKey();
    if (looksPublishable(secret)) {
      const name =
        secretSource === "current" ? SUPABASE_SECRET_KEY_ENV : SUPABASE_SECRET_KEY_ENV_LEGACY;
      problems.push(
        `${name} holds a publishable key rather than a secret key. Server-side writes would be rejected by row level security. Use the secret key from the Supabase dashboard.`,
      );
    }
  }

  if (EMBEDDING_DIMENSIONS !== MIGRATED_EMBEDDING_DIMENSIONS) {
    problems.push(
      `The configured embedding model produces ${EMBEDDING_DIMENSIONS}-dimension vectors, but the shipped migrations declare vector(${MIGRATED_EMBEDDING_DIMENSIONS}). Add a migration reconciling them and re-embed before enabling retrieval.`,
    );
  }

  return problems;
}

/* ------------------------------------------------------------ readiness -- */

/**
 * Everything the grounded answer path needs. Reported as one object so the UI
 * can say exactly what is missing rather than "something went wrong".
 */
export function liveReadiness() {
  const anthropic = anthropicReadiness();
  const supabase = supabaseReadiness();
  const embeddings = embeddingReadiness();
  const browserKey = supabaseBrowserKeyReadiness();
  const problems = configurationProblems();

  return {
    mode: isDemoMode() ? ("demo" as const) : ("live" as const),
    anthropic,
    supabase,
    embeddings,
    supabaseBrowserKey: browserKey,
    /** Which variable name supplied the privileged key. Never the value. */
    supabaseSecretKeySource: supabaseSecretKeySource(),
    ready: anthropic.ready && supabase.ready && embeddings.ready && problems.length === 0,
    // De-duplicated: embeddings share Supabase's variables, so a missing
    // SUPABASE_SECRET_KEY must be reported once, not twice.
    missing: [...new Set([...anthropic.missing, ...supabase.missing, ...embeddings.missing])],
    problems,
    /* Configuration facts, safe to surface. Not secrets. */
    claudeModel: CLAUDE_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    /**
     * True when the configured embedding model emits vectors of a different
     * width than the shipped migrations declare. Retrieval would silently
     * return nothing, so the routes refuse to run instead.
     */
    embeddingDimensionMismatch:
      EMBEDDING_DIMENSIONS !== MIGRATED_EMBEDDING_DIMENSIONS,
  };
}
