/**
 * ============================================================================
 * TEMPORARY STAKEHOLDER-REVIEW ACCESS GATE
 * ============================================================================
 *
 * A shared review password in front of the reporting dashboard, so a named
 * stakeholder can open a review deployment without a Vercel account and without
 * waiting for the real identity provider.
 *
 * THIS IS NOT AUTHENTICATION AND MUST NEVER BE MISTAKEN FOR IT.
 *
 *   It identifies NOBODY. Everyone who gets in is the same anonymous reviewer,
 *   so there is no audit trail, no per-person revocation and no role.
 *   It carries NO AUTHORIZATION. It is one door, open or shut; it cannot scope
 *   a district manager to their own district.
 *   It is a SHARED SECRET, so it is only as good as the least careful person
 *   who has it, and rotating it means telling everyone again.
 *
 * It exists because the alternative for a review deployment today is worse:
 * either no gate at all, or nobody can see the dashboard. It is scoped to the
 * reporting routes, labelled temporary everywhere it appears, and designed to
 * be deleted in one commit when Microsoft Entra ID lands — see
 * `PROTECTED_PREFIXES` and the middleware, which are the whole surface.
 *
 * WHAT IT DOES GUARANTEE, and these are worth having:
 *
 *   The password is server-only. It is read from `REPORTING_REVIEW_PASSWORD`,
 *   compared server-side, and never sent to a browser, written to a URL, or
 *   logged. There is deliberately no `NEXT_PUBLIC_` variable anywhere near it.
 *   The cookie does NOT contain the password. It carries an expiry and an HMAC
 *   over that expiry, so a cookie cannot be forged without the secret and
 *   cannot be extended by editing it.
 *   Rotating the password invalidates every existing session immediately,
 *   because the key is derived from the password itself.
 *   A wrong password is answered identically however wrong it was.
 *
 * WEB CRYPTO, NOT `node:crypto`, because this module is imported by the
 * middleware, which runs in the Edge runtime. One implementation shared by the
 * middleware and the server action is what keeps the two from drifting into
 * different ideas of what a valid session is.
 */

/** The env var holding the shared review password. Server-only, never public. */
export const REVIEW_PASSWORD_ENV = "REPORTING_REVIEW_PASSWORD";

/** The session cookie. Named so it reads as temporary in a browser inspector. */
export const REVIEW_COOKIE = "ask_sunny_review";

/** How long a successful review session lasts. */
export const REVIEW_SESSION_SECONDS = 10 * 60 * 60; // 10 hours

/**
 * Everything behind the gate.
 *
 * The reporting dashboard and anything nested under it, so a drill-down route
 * added later is protected the moment it exists rather than the moment somebody
 * remembers to add it here.
 *
 * DELIBERATELY NOT THE WHOLE APP. The rest of Ask Sunny is prototype surface
 * with seeded content; the reporting dashboard is the one place that renders
 * real salon financials, and it is the thing being reviewed.
 */
export const PROTECTED_PREFIXES = ["/reports/salon-performance"] as const;

/** Where an unauthenticated reviewer is sent. Must never itself be protected. */
export const REVIEW_GATE_PATH = "/reports/review";

/** True when a path is behind the gate. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Whether the gate is configured at all.
 *
 * An unset password means the gate cannot verify anything. The middleware
 * treats that as CLOSED, not open — see `reviewAccessState`.
 */
export function reviewGateConfigured(): boolean {
  return (process.env[REVIEW_PASSWORD_ENV] ?? "").trim().length > 0;
}

const encoder = new TextEncoder();

/** Domain separation, so the signing key is not the password itself. */
const KEY_LABEL = "ask-sunny/reporting-review/v1";

/** Derives the signing key from the shared password. */
async function signingKey(password: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${KEY_LABEL}:${password}`),
  );
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Compares two strings in time independent of where they first differ.
 *
 * Not because a token comparison here is a realistic timing target, but because
 * the alternative is writing `===` on a security check and leaving the next
 * reader to wonder whether it was considered.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // Length is not secret; comparing to a fixed length keeps the loop constant.
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

const TOKEN_VERSION = "v1";

/**
 * Mints a session token.
 *
 * `<version>.<expiresAt>.<hmac>` — the expiry is in the token so it can be
 * checked without any server-side session store, and it is inside the signature
 * so it cannot be extended by editing the cookie. The password never appears.
 */
export async function mintReviewToken(
  password: string,
  expiresAtMs: number,
): Promise<string> {
  const payload = `${TOKEN_VERSION}.${expiresAtMs}`;
  const key = await signingKey(password);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${base64url(signature)}`;
}

/** Verifies a session token against the configured password. */
export async function verifyReviewToken(
  token: string | undefined | null,
  password: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiresAtRaw, signature] = parts;
  if (version !== TOKEN_VERSION) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;

  const expected = await mintReviewToken(password, expiresAt);
  return timingSafeEqual(`${version}.${expiresAtRaw}.${signature}`, expected);
}

/**
 * Checks a submitted password against the configured one.
 *
 * Returns a plain boolean and nothing else. The caller must not vary its
 * response by HOW wrong the attempt was — no "close", no "the password has
 * changed", no distinction between an empty submission and a wrong one.
 */
export async function checkReviewPassword(submitted: string): Promise<boolean> {
  const configured = (process.env[REVIEW_PASSWORD_ENV] ?? "").trim();
  if (configured.length === 0) return false;
  return timingSafeEqual(submitted, configured);
}

export type ReviewAccessState = "granted" | "denied" | "unconfigured";

/**
 * Whether this request may see the reporting dashboard.
 *
 * `unconfigured` is reported separately from `denied` so the gate page can tell
 * an OPERATOR that the deployment is missing its password, while still showing
 * a REVIEWER nothing but the ordinary prompt. It is never treated as open: a
 * deployment without the variable set refuses everyone, which is the correct
 * failure direction for a door.
 */
export async function reviewAccessState(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<ReviewAccessState> {
  const configured = (process.env[REVIEW_PASSWORD_ENV] ?? "").trim();
  if (configured.length === 0) return "unconfigured";
  return (await verifyReviewToken(token, configured, nowMs)) ? "granted" : "denied";
}

/** Cookie attributes. `secure` everywhere except a local http dev server. */
export function reviewCookieOptions(nowMs: number = Date.now()) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(nowMs + REVIEW_SESSION_SECONDS * 1000),
  };
}

/**
 * Sanitises the post-login redirect.
 *
 * Only an internal, protected path is accepted. Without this the `next`
 * parameter is an open redirect: a link could send a reviewer through the gate
 * and straight out to somebody else's site, with the review deployment's name
 * in the referrer.
 */
export function safeNextPath(raw: string | null | undefined): string {
  const fallback = PROTECTED_PREFIXES[0];
  if (!raw) return fallback;
  // A protocol-relative or absolute URL is never acceptable.
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  const [pathname] = raw.split("?");
  return isProtectedPath(pathname) ? raw : fallback;
}
