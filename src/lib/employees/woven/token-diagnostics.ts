/**
 * ============================================================================
 * WHY WOVEN DID NOT ISSUE A TOKEN — sanitized, for the read-only validation
 * ============================================================================
 *
 * WHAT THE SPEC ALLOWS. `POST /tokens/v2` answers 200 with
 * `AuthenticationJwtResponse`, whose fields include `FailedLoginAttempt`,
 * `AccountStatus`, `TwoFactorAuthentication`, `HasMultipleCompanyAccess`,
 * `CompanyLoginOptions`, `ForcePasswordChange`, `RequireTermsSigned` and
 * `RequireOnboarding` — so a 200 without an `AccessToken` can be a refused or
 * unfinished login, not a malformed answer. Errors are documented as 400 and
 * 500; a gateway in front of the API can also answer 401 or 403 for a bad
 * `Subscription-Key` before Woven itself sees the request.
 *
 * WHAT IS REPORTED. The HTTP status, the media type, what kind of body came
 * back, top-level JSON KEY NAMES, the documented login-state booleans and
 * integers, a few well-known error fields with every value redacted, and what
 * those suggest about the subscription key, the credentials, CompanyID,
 * Platform and two-factor sign-in.
 *
 * COMPANY OPTIONS. When Woven offers the user a choice of companies, each
 * option's CompanyName, BrandFriendlyName, CompanyID, AccountStatus and
 * IsBrandCompany are reported, so an administrator can pick the right
 * WOVEN_COMPANY_ID. They describe companies, not people. Nothing is chosen
 * automatically; the logo URL and any other field are not read.
 *
 * WHAT NEVER IS. The subscription key, the password, the username, any
 * AccessToken or RefreshToken, and anything about the application user: its
 * name, `UserName`, `EmployeeID`, position, location, profile image, or the
 * two-factor e-mail and cell phone. Only the fields named below are ever read
 * from the body, and every string that leaves this module passes through
 * `redact`. An HTML or XML body is described by its kind alone.
 */

export type TokenBodyKind = "json" | "text" | "html" | "xml" | "empty";

export interface TokenLoginState {
  failedLoginAttempt: boolean | null;
  accountStatus: number | null;
  hasMultipleCompanyAccess: boolean | null;
  /** How many companies the user could choose. A count, never their names. */
  companyLoginOptionCount: number | null;
  twoFactorEnabled: boolean | null;
  twoFactorInUse: boolean | null;
  twoFactorSetupRequired: boolean | null;
  forcePasswordChange: boolean | null;
  requireTermsSigned: boolean | null;
  requireOnboarding: boolean | null;
}

/** One `CompanyLoginOption`: company-level identifiers only. */
export interface CompanyLoginOption {
  /** A GUID, lower-cased, or null when absent or not a GUID. */
  companyId: string | null;
  companyName: string | null;
  brandFriendlyName: string | null;
  accountStatus: number | null;
  isBrandCompany: boolean | null;
}

/** The most company options reported. */
export const MAX_COMPANY_OPTIONS = 25;

/** true: the evidence says so. false: the evidence says not. null: the response does not say. */
export type Inference = boolean | null;

export interface TokenDiagnostics {
  httpStatus: number;
  /** The media type only (`application/json`), without parameters. */
  contentType: string | null;
  bodyKind: TokenBodyKind;
  /** Top-level JSON key names. Names only, never values. */
  responseKeys: string[];
  /** Whether a non-empty AccessToken was present, under any letter case. The token itself is never kept. */
  accessTokenPresent: boolean;
  /** An AccessToken is present, but not under the spec's exact key `AccessToken` (e.g. `accessToken`). */
  accessTokenKeyMismatch: boolean;
  loginState: TokenLoginState;
  /** The companies Woven offered to sign in to. Empty when none were offered. Never chosen automatically. */
  companyOptions: CompanyLoginOption[];
  /** Well-known error fields (message, code, title…), values redacted and capped. */
  errorFields: Record<string, string | number>;
  /** Field names a validation error names (ASP.NET `errors` object keys), e.g. `CompanyID`. */
  errorFieldNames: string[];
  /** For a plain-text body only: its first line, redacted and capped. Never for HTML or XML. */
  textSnippet: string | null;
  companyIdSent: boolean;
  platformSent: boolean;
  gatewayRejectedSubscriptionKey: Inference;
  credentialsRejected: Inference;
  companyIdAppearsRequired: Inference;
  platformAppearsRequired: Inference;
  twoFactorAppearsRequired: Inference;
  accountSetupIncomplete: Inference;
}

export interface DiagnoseInput {
  status: number;
  contentType: string | null;
  text: string;
  companyIdSent: boolean;
  platformSent: boolean;
  /** Exact values to scrub wherever they appear: the subscription key, username, password. */
  secrets: readonly string[];
}

const MAX_FIELD_LENGTH = 200;
const MAX_SNIPPET_LENGTH = 160;

/* Error-field keys worth reporting, compared case-insensitively. */
const ERROR_KEYS = [
  "message",
  "error",
  "error_description",
  "errormessage",
  "title",
  "detail",
  "code",
  "errorcode",
  "statuscode",
  "status",
  "reason",
];

/**
 * Every string that leaves this module goes through here: exact secrets,
 * then anything shaped like an e-mail, a JWT, a GUID, a long opaque run or a
 * phone number.
 */
export function redact(value: string, secrets: readonly string[]): string {
  let out = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const secret of secrets) {
    if (secret && secret.length >= 3) out = out.split(secret).join("[redacted]");
  }
  out = out
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[token]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > MAX_FIELD_LENGTH ? `${out.slice(0, MAX_FIELD_LENGTH)}…` : out;
}

function mediaType(contentType: string | null): string | null {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(record: Record<string, unknown>, name: string): unknown {
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : record[key];
}

const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABEL_LENGTH = 120;

/**
 * A company label: kept readable (so GUID-like or long words are NOT masked, as
 * `redact` would), but with control characters removed, whitespace collapsed,
 * the credentials and any e-mail address scrubbed, and a length cap.
 */
function companyLabel(value: unknown, secrets: readonly string[]): string | null {
  if (typeof value !== "string") return null;
  let out = value.replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const secret of secrets) {
    if (secret && secret.length >= 3) out = out.split(secret).join("[redacted]");
  }
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]").replace(/\s+/g, " ").trim();
  if (out.length === 0) return null;
  return out.length > MAX_LABEL_LENGTH ? `${out.slice(0, MAX_LABEL_LENGTH)}…` : out;
}

function readCompanyOptions(body: Record<string, unknown>, secrets: readonly string[]): CompanyLoginOption[] {
  const options = field(body, "CompanyLoginOptions");
  if (!Array.isArray(options)) return [];
  return options
    .filter(isRecord)
    .slice(0, MAX_COMPANY_OPTIONS)
    .map((option) => {
      const id = field(option, "CompanyID");
      return {
        companyId: typeof id === "string" && GUID.test(id.trim()) ? id.trim().toLowerCase() : null,
        companyName: companyLabel(field(option, "CompanyName"), secrets),
        brandFriendlyName: companyLabel(field(option, "BrandFriendlyName"), secrets),
        accountStatus: int(field(option, "AccountStatus")),
        isBrandCompany: bool(field(option, "IsBrandCompany")),
      };
    });
}
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

function readLoginState(body: Record<string, unknown>): TokenLoginState {
  const twoFactor = field(body, "TwoFactorAuthentication");
  /* Only the three booleans. Its EmailAddress and TwoFactorAuthenticationCellPhone are never read. */
  const tf = isRecord(twoFactor) ? twoFactor : {};
  const options = field(body, "CompanyLoginOptions");
  return {
    failedLoginAttempt: bool(field(body, "FailedLoginAttempt")),
    accountStatus: int(field(body, "AccountStatus")),
    hasMultipleCompanyAccess: bool(field(body, "HasMultipleCompanyAccess")),
    companyLoginOptionCount: Array.isArray(options) ? options.length : null,
    twoFactorEnabled: bool(field(tf, "TwoFactorAuthenticationEnabled")),
    twoFactorInUse: bool(field(tf, "Use2FA")),
    twoFactorSetupRequired: bool(field(tf, "Setup2FA")),
    forcePasswordChange: bool(field(body, "ForcePasswordChange")),
    requireTermsSigned: bool(field(body, "RequireTermsSigned")),
    requireOnboarding: bool(field(body, "RequireOnboarding")),
  };
}

const EMPTY_STATE: TokenLoginState = {
  failedLoginAttempt: null,
  accountStatus: null,
  hasMultipleCompanyAccess: null,
  companyLoginOptionCount: null,
  twoFactorEnabled: null,
  twoFactorInUse: null,
  twoFactorSetupRequired: null,
  forcePasswordChange: null,
  requireTermsSigned: null,
  requireOnboarding: null,
};

function classify(text: string, contentType: string | null): { kind: TokenBodyKind; json: unknown } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "empty", json: undefined };
  const looksJson = contentType?.includes("json") || /^[[{"]/.test(trimmed);
  if (looksJson) {
    try {
      return { kind: "json", json: JSON.parse(trimmed) as unknown };
    } catch {
      /* Falls through to the other kinds. */
    }
  }
  if (contentType?.includes("html") || /^<!doctype html|^<html/i.test(trimmed)) return { kind: "html", json: undefined };
  if (contentType?.includes("xml") || trimmed.startsWith("<")) return { kind: "xml", json: undefined };
  return { kind: "text", json: undefined };
}

export function diagnoseTokenResponse(input: DiagnoseInput): TokenDiagnostics {
  const contentType = mediaType(input.contentType);
  const { kind, json } = classify(input.text, contentType);
  const body = isRecord(json) ? json : null;

  const errorFields: Record<string, string | number> = {};
  const errorFieldNames: string[] = [];
  let loginState = EMPTY_STATE;
  let companyOptions: CompanyLoginOption[] = [];
  let accessTokenPresent = false;
  let accessTokenKeyMismatch = false;

  if (body) {
    loginState = readLoginState(body);
    companyOptions = readCompanyOptions(body, input.secrets);
    const token = field(body, "AccessToken");
    accessTokenPresent = typeof token === "string" && token.trim().length > 0;
    accessTokenKeyMismatch = accessTokenPresent && !Object.hasOwn(body, "AccessToken");
    for (const [key, value] of Object.entries(body)) {
      if (!ERROR_KEYS.includes(key.toLowerCase())) continue;
      if (typeof value === "number" && Number.isFinite(value)) errorFields[key] = value;
      else if (typeof value === "string" && value.trim()) errorFields[key] = redact(value, input.secrets);
    }
    const errors = field(body, "errors") ?? field(body, "ModelState");
    if (isRecord(errors)) {
      for (const key of Object.keys(errors).slice(0, 20)) errorFieldNames.push(redact(key, input.secrets));
    }
  } else if (typeof json === "string" && json.trim()) {
    /* A bare JSON string: a message or a token. Only a redacted version leaves. */
    errorFields.message = redact(json, input.secrets);
  }

  const textSnippet =
    kind === "text" ? redact(input.text.trim().split(/\r?\n/)[0] ?? "", input.secrets).slice(0, MAX_SNIPPET_LENGTH) : null;

  const words = [...Object.values(errorFields).map(String), ...errorFieldNames, textSnippet ?? ""].join(" ").toLowerCase();
  const mentionsSubscription = /subscription[\s-]?key|subscription is not active|invalid subscription|missing subscription|out of call volume quota/.test(words);
  const mentionsCredentials = /password|username|user name|credential|invalid login|login failed|not authori[sz]ed/.test(words);
  const ok = accessTokenPresent;
  const noToken = !accessTokenPresent;
  const s = loginState;

  const gatewayRejectedSubscriptionKey: Inference =
    (input.status === 401 || input.status === 403) && mentionsSubscription
      ? true
      : input.status >= 200 && input.status < 300 && body !== null
        ? false
        : null;

  const credentialsRejected: Inference = ok
    ? false
    : s.failedLoginAttempt === true || (mentionsCredentials && !mentionsSubscription)
      ? true
      : s.failedLoginAttempt === false
        ? false
        : null;

  const companyIdAppearsRequired: Inference = ok
    ? false
    : noToken && !input.companyIdSent && (s.hasMultipleCompanyAccess === true || (s.companyLoginOptionCount ?? 0) > 0)
      ? true
      : /company/.test(words)
        ? true
        : null;

  const platformAppearsRequired: Inference = ok ? false : /platform/.test(words) ? true : null;

  const twoFactorAppearsRequired: Inference = ok
    ? false
    : s.twoFactorInUse === true || s.twoFactorSetupRequired === true || s.twoFactorEnabled === true
      ? true
      : body && s.twoFactorEnabled === false
        ? false
        : null;

  const accountSetupIncomplete: Inference = ok
    ? false
    : s.forcePasswordChange === true || s.requireTermsSigned === true || s.requireOnboarding === true
      ? true
      : null;

  return {
    httpStatus: input.status,
    contentType,
    bodyKind: kind,
    responseKeys: body ? Object.keys(body).map((k) => redact(k, input.secrets)).sort() : [],
    accessTokenPresent,
    accessTokenKeyMismatch,
    loginState,
    companyOptions,
    errorFields,
    errorFieldNames,
    textSnippet,
    companyIdSent: input.companyIdSent,
    platformSent: input.platformSent,
    gatewayRejectedSubscriptionKey,
    credentialsRejected,
    companyIdAppearsRequired,
    platformAppearsRequired,
    twoFactorAppearsRequired,
    accountSetupIncomplete,
  };
}

/** One sentence for the validation's Sign-in finding. Built only from the sanitized diagnostics. */
export function describeTokenDiagnostics(d: TokenDiagnostics): string {
  const parts = [`POST /tokens/v2 answered HTTP ${d.httpStatus}`, `${d.contentType ?? "no content type"}, ${d.bodyKind} body`];
  if (d.responseKeys.length > 0) parts.push(`keys: ${d.responseKeys.join(", ")}`);
  const causes: string[] = [];
  if (d.accessTokenKeyMismatch) causes.push("an AccessToken came back, but under a key whose letter case differs from the spec's `AccessToken`");
  if (d.gatewayRejectedSubscriptionKey) causes.push("the API gateway rejected the subscription key");
  if (d.credentialsRejected) causes.push("Woven rejected the username or password");
  if (d.companyIdAppearsRequired) {
    causes.push(
      d.companyOptions.length > 0
        ? `a CompanyID appears to be required — Woven offered ${d.companyOptions.length} compan${d.companyOptions.length === 1 ? "y" : "ies"} (listed under Company options); set WOVEN_COMPANY_ID to the right one`
        : "a CompanyID appears to be required",
    );
  }
  if (d.platformAppearsRequired) causes.push("a Platform value appears to be required");
  if (d.twoFactorAppearsRequired) causes.push("the user appears to need two-factor sign-in");
  if (d.accountSetupIncomplete) causes.push("the user's account setup is incomplete (password change, terms or onboarding)");
  const messages = Object.entries(d.errorFields).map(([k, v]) => `${k}: ${v}`);
  return `${parts.join(" · ")}. ${causes.length > 0 ? `Likely cause: ${causes.join("; ")}.` : "The response does not say why no token was issued."}${messages.length > 0 ? ` Woven said: ${messages.join("; ")}.` : ""}`;
}
