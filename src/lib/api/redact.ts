import "server-only";

/**
 * LOG REDACTION.
 *
 * The logging policy is absolute: no document text, no question, no answer, no
 * grounding context and no credential ever reaches a log line or an error
 * message. That is not achievable by remembering to be careful at each call
 * site, so every message that could carry content passes through here first.
 *
 * The realistic leak paths this closes:
 *   - a Postgres constraint violation whose message quotes the offending row,
 *     which for `knowledge_chunks` means a fragment of a company document,
 *   - an upstream API error that echoes the request body back,
 *   - a stack trace or cause chain carrying either of the above.
 */

/** Patterns that look like credentials, whatever else is in the string. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsb_secret_[A-Za-z0-9._-]+/g,
  /\bsb_publishable_[A-Za-z0-9._-]+/g,
  /\bsk-ant-[A-Za-z0-9._-]+/g,
  /\bpa-[A-Za-z0-9._-]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  // JWTs — the legacy Supabase key shape.
  /\beyJ[A-Za-z0-9._-]{20,}/g,
];

/** Longest message ever logged. Content leaks are usually long. */
const MAX_LENGTH = 300;

/**
 * Makes an arbitrary string safe to log: strips anything credential-shaped,
 * then truncates. Truncation is the blunt half of the defence — a message
 * short enough to be a diagnostic is too short to be a document.
 */
export function redact(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > MAX_LENGTH ? `${out.slice(0, MAX_LENGTH)}… [truncated]` : out;
}

/**
 * A one-line, log-safe description of any thrown value.
 *
 * Deliberately does NOT include the stack or the cause chain: both routinely
 * carry request payloads, and the error class plus a redacted message is what
 * is actually useful for diagnosis.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${redact(error.message)}`;
  }
  if (typeof error === "string") return redact(error);
  return "non-Error value thrown";
}

/**
 * Server-side log for a route failure. The single place a route is permitted
 * to write to the console, so the policy is enforced by there being one door.
 */
export function logRouteError(route: string, error: unknown): void {
  console.error(`[ask-sunny] ${route}: ${describeError(error)}`);
}
