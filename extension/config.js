/**
 * WHICH ASK SUNNY DEPLOYMENT THE EXTENSION MAY TALK TO.
 *
 * Shared by the background worker (which sends the token) and the Options page
 * (which refuses to save an address the worker would reject), so the rule is
 * stated once. Two copies of a URL allowlist is two chances to disagree about
 * which one is authoritative, and the disagreement always resolves in favour of
 * whichever one is missing the check.
 *
 * ============================================================================
 * WHY THE BASE URL IS CONFIGURABLE AT ALL, AND WHY IT IS STILL NARROW
 * ============================================================================
 *
 * Phase 1 QA runs against a Vercel PREVIEW deployment, whose hostname carries a
 * build hash and therefore cannot be compiled in. So the URL is a setting — and
 * because it decides where a credential is sent, it is an allowlisted setting
 * rather than a free text field:
 *
 *   https://<anything>.vercel.app   preview and production, and nothing else.
 *   http://localhost | 127.0.0.1    local development, over loopback only.
 *
 * Anything else is refused. A token typed into an Options page must not be
 * sendable to an address somebody pasted from an email.
 */

export function isAllowedBaseUrl(raw) {
  let url;
  try {
    url = new URL(typeof raw === "string" ? raw.trim() : "");
  } catch {
    return false;
  }

  if (url.protocol === "https:") {
    return url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app");
  }

  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }

  return false;
}

/** The one endpoint this extension calls. */
export function endpointFor(baseUrl) {
  return `${String(baseUrl).trim().replace(/\/+$/, "")}/api/reviews/ingest`;
}

/**
 * Why an address was refused, for somebody staring at the Options page.
 *
 * Returns null when the URL is fine. Names the rule rather than repeating
 * "invalid", because "it must be https" and "it must be a Vercel URL" are
 * different mistakes with different fixes.
 */
export function baseUrlProblem(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length === 0) return "Enter the ASK Sunny URL for the deployment you are testing.";

  let url;
  try {
    url = new URL(value);
  } catch {
    return "That is not a complete URL. Include https:// at the start.";
  }

  if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return null;
  }
  if (url.protocol !== "https:") {
    return "The URL must start with https:// (http is accepted only for localhost).";
  }
  if (!(url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app"))) {
    return "Only ASK Sunny's own vercel.app addresses are accepted, so the sync token cannot be sent elsewhere.";
  }
  return null;
}
