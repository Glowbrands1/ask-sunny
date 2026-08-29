import "server-only";

import {
  CLAUDE_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  MIGRATED_EMBEDDING_DIMENSIONS,
} from "./models";
import { isDemoMode } from "./runtime";

/**
 * SERVER-ONLY CONFIGURATION.
 *
 * `import "server-only"` makes any client component that imports this module a
 * build error, so a key cannot reach the browser bundle by accident.
 *
 * Nothing in this file logs, returns or interpolates a secret VALUE. The
 * readiness helpers report presence/absence by NAME only, which is what the
 * Integrations screen and /api/health need.
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

/* ------------------------------------------------------------- accessors -- */

/** Throws with the variable NAME (never a value) when the key is absent. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new MissingConfigurationError([name]);
  }
  return value.trim();
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

export const ANTHROPIC_ENV = ["ANTHROPIC_API_KEY"];
export const VOYAGE_ENV = ["VOYAGE_API_KEY"];
export const SUPABASE_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

export function anthropicReadiness(): ServiceReadiness {
  return check(ANTHROPIC_ENV);
}

export function voyageReadiness(): ServiceReadiness {
  return check(VOYAGE_ENV);
}

export function supabaseReadiness(): ServiceReadiness {
  return check(SUPABASE_ENV);
}

/**
 * Everything the grounded answer path needs. Reported as one object so the UI
 * can say exactly what is missing rather than "something went wrong".
 */
export function liveReadiness() {
  const anthropic = anthropicReadiness();
  const voyage = voyageReadiness();
  const supabase = supabaseReadiness();
  return {
    mode: isDemoMode() ? ("demo" as const) : ("live" as const),
    anthropic,
    voyage,
    supabase,
    ready: anthropic.ready && voyage.ready && supabase.ready,
    missing: [...anthropic.missing, ...voyage.missing, ...supabase.missing],
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
