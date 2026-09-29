import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * ============================================================================
 * THE ACCESS CODE FOR THE WOVEN CONNECTION TEST ON A DEMO-MODE PREVIEW
 * ============================================================================
 *
 * WHY IT EXISTS. On a demo-mode deployment identity comes from the role
 * switcher, which anybody can set with a request header, and the Preview is
 * public. So there, and only there, the read-only Woven validation route also
 * asks for a code the operator set in Vercel as a Sensitive, Preview-only
 * variable. Without it, nothing reaches Woven.
 *
 * WHAT IT IS NOT. It is not Ask Sunny authentication and changes none of it,
 * and it opens nothing but that one route: not the sync, not the cron, not
 * any other live behaviour. A live deployment never reads it.
 *
 * NEVER ECHOED. The code travels in the POST body — never a URL — is compared
 * here, in constant time over SHA-256 digests (so neither its value nor its
 * length leaks through timing), and appears in no log, response, error
 * message or client bundle. Problems are reported by variable NAME only.
 */

export const WOVEN_VALIDATION_ACCESS_CODE_ENV = "WOVEN_VALIDATION_ACCESS_CODE";

/** Shorter codes are refused as unconfigured: a guessable code is no gate. */
export const MIN_ACCESS_CODE_LENGTH = 16;

export type AccessCodeCheck = "ok" | "not_configured" | "missing" | "wrong";

type Env = Readonly<Record<string, string | undefined>>;

function configuredCode(env: Env): string | null {
  const raw = env[WOVEN_VALIDATION_ACCESS_CODE_ENV] ?? "";
  return raw.trim().length >= MIN_ACCESS_CODE_LENGTH ? raw.trim() : null;
}

/** Whether a usable code is set. Safe to show: it says nothing about the value. */
export function validationAccessCodeConfigured(env: Env = process.env): boolean {
  return configuredCode(env) !== null;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function checkValidationAccessCode(presented: unknown, env: Env = process.env): AccessCodeCheck {
  const expected = configuredCode(env);
  if (expected === null) return "not_configured";
  if (typeof presented !== "string" || presented.trim().length === 0) return "missing";
  return timingSafeEqual(digest(presented.trim()), digest(expected)) ? "ok" : "wrong";
}
