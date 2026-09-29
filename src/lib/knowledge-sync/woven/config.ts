import "server-only";

import { DEFAULT_WOVEN_COMPANY, DEFAULT_WOVEN_TEAM_BASE_URL } from "./contract";

/**
 * ============================================================================
 * THE WOVEN KNOWLEDGE SYNC'S CONFIGURATION
 * ============================================================================
 *
 * ONE-TIME SETUP, SERVER-SIDE ONLY. The Woven Team sign-in for the integration
 * account is entered once as Sensitive environment variables in Vercel. None
 * is `NEXT_PUBLIC_`, and none is ever logged, returned by a route, or written
 * to the database. Problems are reported by variable NAME, never by value.
 *
 * These are NOT the employee sync's `WOVEN_USERNAME` / `WOVEN_PASSWORD`: those
 * sign in to the Operations API gateway; these sign in to the Woven Team web
 * app, which is where knowledge content lives.
 *
 * OFF UNTIL SWITCHED ON. With `WOVEN_KNOWLEDGE_SYNC_ENABLED` off nothing
 * reaches Woven — not a test, not a preview, not a scheduled tick. The monthly
 * schedule has its own switch, which an administrator turns on from the admin
 * screen after the initial sync (stored in `knowledge_sync_settings`), so no
 * cron syntax or variable is needed for it.
 */

export const WOVEN_KNOWLEDGE_SYNC_ENABLED_ENV = "WOVEN_KNOWLEDGE_SYNC_ENABLED";
export const WOVEN_TEAM_USERNAME_ENV = "WOVEN_TEAM_USERNAME";
export const WOVEN_TEAM_PASSWORD_ENV = "WOVEN_TEAM_PASSWORD";
export const WOVEN_TEAM_COMPANY_ENV = "WOVEN_TEAM_COMPANY";
/** The company's Woven id (a UUID), sent as `pCompanyID` when it must be selected. */
export const WOVEN_TEAM_COMPANY_ID_ENV = "WOVEN_TEAM_COMPANY_ID";
/** Optional. The anti-forgery header name, only if live QA shows Woven requires one. */
export const WOVEN_TEAM_ANTIFORGERY_HEADER_ENV = "WOVEN_TEAM_ANTIFORGERY_HEADER";
export const WOVEN_TEAM_BASE_URL_ENV = "WOVEN_TEAM_BASE_URL";

export interface WovenTeamCredentials {
  username: string;
  password: string;
}

export interface WovenKnowledgeConfig {
  enabled: boolean;
  baseUrl: string;
  /** The Woven company this build syncs. */
  company: string;
  /**
   * Its Woven id, used only when sign-in lands somewhere else and the company
   * has to be selected. Null when unset; a sign-in that then needs selecting
   * fails closed with `company_id_not_configured`.
   */
  companyId: string | null;
  /** Null (the default) sends no anti-forgery header. */
  antiForgeryHeader: string | null;
  credentials: WovenTeamCredentials | null;
  missingCredentials: string[];
  problems: string[];
}

/** Pacing and retries. Gentle: this is a person-sized web app, not a bulk API. */
export const WOVEN_TEAM_TRANSPORT = {
  minIntervalMs: 750,
  requestTimeoutMs: 30_000,
  downloadTimeoutMs: 90_000,
  maxRetries: 3,
  baseBackoffMs: 1_000,
  maxRetryAfterMs: 60_000,
  maxRedirects: 6,
} as const;

type Env = Readonly<Record<string, string | undefined>>;

function readFlag(env: Env, name: string): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/** HTTPS only: the session cookie and the password travel to this origin. */
function readBaseUrl(env: Env, problems: string[]): string {
  const raw = (env[WOVEN_TEAM_BASE_URL_ENV] ?? "").trim();
  if (raw.length === 0) return DEFAULT_WOVEN_TEAM_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("shape");
    }
    return url.origin;
  } catch {
    problems.push(`${WOVEN_TEAM_BASE_URL_ENV} must be a plain https:// origin. Using ${DEFAULT_WOVEN_TEAM_BASE_URL}.`);
    return DEFAULT_WOVEN_TEAM_BASE_URL;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID or nothing: a malformed id is never sent to Woven. */
function readCompanyId(env: Env, problems: string[]): string | null {
  const raw = (env[WOVEN_TEAM_COMPANY_ID_ENV] ?? "").trim();
  if (raw.length === 0) return null;
  if (!UUID.test(raw)) {
    problems.push(`${WOVEN_TEAM_COMPANY_ID_ENV} must be the company's Woven id (a UUID). It is being ignored.`);
    return null;
  }
  return raw.toLowerCase();
}

/** An HTTP header name or nothing. Its VALUE is always the page's own token, never configured. */
function readAntiForgeryHeader(env: Env, problems: string[]): string | null {
  const raw = (env[WOVEN_TEAM_ANTIFORGERY_HEADER_ENV] ?? "").trim();
  if (raw.length === 0) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(raw)) {
    problems.push(`${WOVEN_TEAM_ANTIFORGERY_HEADER_ENV} must be a plain header name. It is being ignored.`);
    return null;
  }
  return raw;
}

export function readWovenKnowledgeConfig(env: Env = process.env): WovenKnowledgeConfig {
  const problems: string[] = [];
  const username = (env[WOVEN_TEAM_USERNAME_ENV] ?? "").trim();
  /* A password is not trimmed: surrounding whitespace can be part of it. */
  const password = env[WOVEN_TEAM_PASSWORD_ENV] ?? "";

  const missingCredentials: string[] = [];
  if (!username) missingCredentials.push(WOVEN_TEAM_USERNAME_ENV);
  if (password.length === 0) missingCredentials.push(WOVEN_TEAM_PASSWORD_ENV);

  const enabled = readFlag(env, WOVEN_KNOWLEDGE_SYNC_ENABLED_ENV);
  if (enabled && missingCredentials.length > 0) {
    problems.push(
      `${WOVEN_KNOWLEDGE_SYNC_ENABLED_ENV} is on but ${missingCredentials.join(", ")} ${
        missingCredentials.length === 1 ? "is" : "are"
      } not set.`,
    );
  }

  const company = (env[WOVEN_TEAM_COMPANY_ENV] ?? "").trim() || DEFAULT_WOVEN_COMPANY;

  return {
    enabled,
    baseUrl: readBaseUrl(env, problems),
    company,
    companyId: readCompanyId(env, problems),
    antiForgeryHeader: readAntiForgeryHeader(env, problems),
    credentials: missingCredentials.length === 0 ? { username, password } : null,
    missingCredentials,
    problems,
  };
}
