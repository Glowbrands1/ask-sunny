import "server-only";

import { getRateLimiter } from "@/lib/api/rate-limit";

/**
 * THE REPORT-INGESTION MACHINE CREDENTIAL.
 *
 * A shared secret held by whatever automation delivers the monthly workbook —
 * a scheduled job, a Power Automate flow, a script somebody runs. It is a
 * MACHINE credential and never a person's: it identifies a pipeline, carries no
 * profile, and grants exactly one capability, which is to POST one reviewed
 * workbook at the ingestion route.
 *
 * IT IS PRODUCTION-CAPABLE ON ITS OWN, and that is the point of this module
 * rather than a design note. Reporting must not wait on an identity provider
 * that may never be available, so this mechanism carries the properties an
 * external identity provider would otherwise have supplied:
 *
 *   ROTATION WITHOUT DOWNTIME. The variable holds a LIST of credentials, so a
 *   new one is added, the caller is moved over, and the old one is removed —
 *   three deploys, no window in which ingestion is broken. A single-valued
 *   secret forces the swap to be simultaneous on both sides, which is why
 *   single-valued secrets never get rotated.
 *
 *   REVOCATION. Removing an entry and redeploying ends that credential
 *   immediately. Because each entry carries an id, one pipeline can be revoked
 *   without disturbing the others.
 *
 *   CONSTANT-TIME VERIFICATION. Candidates are compared as fixed-length
 *   SHA-256 digests with a branchless XOR accumulator, so neither the length of
 *   a secret nor the position of the first wrong byte is observable in the
 *   response time. Comparing the raw strings with `===` leaks a prefix oracle,
 *   which is enough to recover a secret one character at a time.
 *
 *   RATE LIMITING, counting only FAILURES, so a working pipeline calling on
 *   schedule never throttles itself while a guessing caller is stopped quickly.
 *
 *   NO CLIENT EXPOSURE. `server-only` above makes a client component importing
 *   this file a build failure, and the variable carries no `NEXT_PUBLIC_`
 *   prefix, so nothing here can be inlined into a browser bundle.
 *
 *   AUDITABILITY WITHOUT DISCLOSURE. A successful verification returns the
 *   credential's ID. That is what belongs in a log line; the secret itself is
 *   never returned, never logged and never echoed in a response.
 *
 * WHAT IT DELIBERATELY IS NOT. It is not user authentication and must never be
 * reused as such — no employee ever holds this value. Employee login is a
 * separate, provider-agnostic concern; see `src/lib/auth/`.
 */

/** The server-side variable holding the credential list. Never NEXT_PUBLIC_. */
export const INGEST_SECRET_ENV = "REPORTING_INGEST_SECRET";

/**
 * A SECOND variable, for a credential a PERSON runs an upload with.
 *
 * Same capability, same verification, same rate limit — a different variable,
 * and that is the whole of the difference. It exists so the two kinds of caller
 * can be rotated and revoked independently:
 *
 *   `REPORTING_INGEST_SECRET` belongs to the automation. Changing it means
 *   changing whatever is scheduled to call, so it is the value nobody wants to
 *   touch when a human needs to file one workbook by hand.
 *
 *   `REPORTING_MANUAL_INGEST_SECRET` belongs to that human. It can be added
 *   today and removed tomorrow without the pipeline noticing, which is what
 *   makes a one-off manual ingestion a configuration change rather than a risk
 *   to the recurring path.
 *
 * BOTH ARE ACCEPTED WHEREVER EITHER IS, and neither is required. A runtime with
 * only the original variable behaves exactly as it did before this one existed;
 * a runtime with only this one accepts manual uploads and no pipeline. That is
 * what makes adding it backward compatible rather than a migration.
 *
 * A CALLER NEVER LEARNS WHICH ONE IT PRESENTED. The same header carries either,
 * the refusal is identical, and only the server-side audit id distinguishes
 * them — see `CREDENTIAL_SOURCES`.
 */
export const MANUAL_INGEST_SECRET_ENV = "REPORTING_MANUAL_INGEST_SECRET";

/**
 * Every variable a credential may be configured in, and the id an UNLABELLED
 * entry in it gets.
 *
 * The default id is per-variable on purpose. An operator setting one variable
 * writes a bare secret and never learns the `id:secret` syntax, so without this
 * both variables would produce a credential called `default` and an audit line
 * could not say whether the automation or a person filed a workbook. With it,
 * `default` still means the automation — unchanged from before this variable
 * existed — and `manual` means the human path.
 */
const CREDENTIAL_SOURCES: readonly { readonly env: string; readonly defaultId: string }[] = [
  { env: INGEST_SECRET_ENV, defaultId: "default" },
  { env: MANUAL_INGEST_SECRET_ENV, defaultId: "manual" },
];

/**
 * The header the credential arrives in.
 *
 * A header and NOT a query parameter, deliberately. A secret in a URL is
 * written to every access log, proxy log and browser history entry between the
 * caller and here, and survives in each of them long after rotation. A caller
 * that puts it in the query string is refused rather than accommodated — see
 * `readPresentedSecret`.
 */
export const INGEST_AUTH_HEADER = "authorization";

/**
 * The shortest secret this will accept as configured.
 *
 * Enforced against the CONFIGURATION rather than the candidate: a deployment
 * with a guessable secret fails closed and tells the operator, instead of
 * running and looking fine. 32 characters of random base64url is ~192 bits,
 * far beyond what the rate limit alone would have to defend.
 */
export const MIN_SECRET_LENGTH = 24;

/** Failed presentations per window, per caller. Successes cost nothing. */
const ATTEMPT_BUDGET = { limit: 10, windowSeconds: 10 * 60 } as const;

const encoder = new TextEncoder();

/**
 * One configured credential.
 *
 * The id is an operator's label — `power-automate`, `monthly-job`, `rotate-2`.
 * It is not a secret and appears in logs on purpose, so that "which pipeline
 * called" and "which credential do I revoke" have answers.
 */
export interface IngestCredential {
  id: string;
  secret: string;
}

/**
 * Parses the configured list.
 *
 * Accepted forms, both so an operator setting one credential does not have to
 * learn a syntax:
 *
 *   `<secret>`                     one credential, id defaults to `defaultId`
 *   `<id>:<secret>`                one labelled credential
 *   `<id>:<secret>,<id>:<secret>`  several, which is what rotation needs
 *
 * Entries are separated by commas or whitespace, so a value pasted across two
 * lines still parses. An entry shorter than `MIN_SECRET_LENGTH` is DROPPED
 * rather than accepted: a deployment is better off refusing every caller than
 * accepting a weak credential, and `credentialConfigurationProblem` tells the
 * operator which entry was rejected without printing it.
 *
 * `defaultId` names an unlabelled entry. It defaults to `default`, which is
 * what `REPORTING_INGEST_SECRET` has always produced, so this parameter cannot
 * change the behaviour of a caller that does not pass it.
 */
export function parseIngestCredentials(
  raw: string | undefined,
  defaultId = "default",
): IngestCredential[] {
  const value = (raw ?? "").trim();
  if (value.length === 0) return [];

  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      // The FIRST colon separates id from secret; a secret may contain colons.
      const separator = entry.indexOf(":");
      const id = separator === -1 ? defaultId : entry.slice(0, separator).trim();
      const secret = separator === -1 ? entry : entry.slice(separator + 1);
      if (id.length === 0 || secret.length < MIN_SECRET_LENGTH) return [];
      return [{ id, secret }];
    });
}

/**
 * The credentials this runtime accepts, from every configured variable.
 *
 * The AUTOMATION VARIABLE IS READ FIRST, so its entries keep the positions and
 * ids they had before a second variable existed. Order is otherwise
 * immaterial — `verifyIngestSecret` checks every entry regardless — but keeping
 * it stable means an audit line for the pipeline reads the same as it did last
 * month.
 */
export function configuredCredentials(): IngestCredential[] {
  return CREDENTIAL_SOURCES.flatMap((source) =>
    parseIngestCredentials(process.env[source.env], source.defaultId),
  );
}

export function ingestCredentialConfigured(): boolean {
  return configuredCredentials().length > 0;
}

/** What one credential variable is doing, for a readiness response. */
export interface CredentialSourceStatus {
  /** The variable's NAME. Never its value, never a digest of it. */
  readonly env: string;
  readonly configured: boolean;
  /** How many usable credentials it holds. A count discloses nothing. */
  readonly credentialCount: number;
  /** Why it holds none, or fewer than it looks like. Null when it is fine. */
  readonly problem: string | null;
}

/**
 * Per-variable readiness.
 *
 * Reported separately rather than as one boolean because with two variables the
 * interesting question changed: "is ingestion open?" was enough when there was
 * one, and now an operator who has just configured the manual credential needs
 * to see THAT variable land without being told anything about the other.
 */
export function credentialSourceStatuses(): CredentialSourceStatus[] {
  return CREDENTIAL_SOURCES.map((source) => {
    const raw = (process.env[source.env] ?? "").trim();
    const parsed = parseIngestCredentials(raw, source.defaultId);
    return {
      env: source.env,
      configured: parsed.length > 0,
      credentialCount: parsed.length,
      problem: sourceProblem(source.env, source.defaultId),
    };
  });
}

/**
 * A problem with ONE variable, or null.
 *
 * Says nothing when the variable is simply unset: with two variables, absent is
 * the ordinary state of at least one of them and is not a fault.
 */
function sourceProblem(env: string, defaultId: string): string | null {
  const raw = (process.env[env] ?? "").trim();
  if (raw.length === 0) return null;

  const parsed = parseIngestCredentials(raw, defaultId);
  if (parsed.length === 0) {
    return `${env} is set but holds no usable credential — every entry was shorter than ${MIN_SECRET_LENGTH} characters. It is ignored rather than used, so a caller presenting it is refused.`;
  }

  const entryCount = raw.split(/[\s,]+/).filter((entry) => entry.trim().length > 0).length;
  if (parsed.length < entryCount) {
    const dropped = entryCount - parsed.length;
    return `${env} holds ${dropped} entr${dropped === 1 ? "y" : "ies"} that ${
      dropped === 1 ? "was" : "were"
    } rejected for being shorter than ${MIN_SECRET_LENGTH} characters. The remaining ${
      parsed.length
    } ${parsed.length === 1 ? "is" : "are"} in use.`;
  }

  return null;
}

/**
 * An operator-facing description of a misconfiguration, or null when fine.
 *
 * Names the problem and the variable, never a value. Shown only where an
 * operator is looking; a CALLER is told nothing beyond "not authorized",
 * because whether the gate is switched on is not their business.
 */
export function credentialConfigurationProblem(): string | null {
  const statuses = credentialSourceStatuses();
  const configured = configuredCredentials();

  /*
   * NOTHING CONFIGURED ANYWHERE. Both variables are named, because either one
   * opens ingestion and an operator should not have to guess which to reach
   * for. This is the only case that is fatal — one variable being unset while
   * the other works is the ordinary state, not a problem.
   */
  if (configured.length === 0) {
    const unusable = statuses.filter((status) => status.problem !== null);
    if (unusable.length > 0) {
      return `${unusable
        .map((status) => status.problem)
        .join(" ")} Ingestion is closed rather than running on a guessable secret.`;
    }
    return `Neither ${INGEST_SECRET_ENV} nor ${MANUAL_INGEST_SECRET_ENV} is set, so report ingestion is closed. Set one to a secret of at least ${MIN_SECRET_LENGTH} characters — or to \`id:secret\` entries, comma separated, to hold several — and redeploy.`;
  }

  // A variable that IS set and partly unusable, while another one works.
  const partial = statuses.find((status) => status.problem !== null);
  if (partial) return partial.problem;

  /*
   * DUPLICATE IDS, checked ACROSS BOTH VARIABLES. This is the case a second
   * variable introduced: two labelled entries can now collide without either
   * variable containing a duplicate on its own, and the collision is invisible
   * in each half.
   */
  const ids = configured.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    return `${INGEST_SECRET_ENV} and ${MANUAL_INGEST_SECRET_ENV} hold entries sharing an id, so an audit line could not identify which credential was used. Give each entry a distinct id.`;
  }

  /*
   * THE SAME SECRET IN BOTH VARIABLES. Easy to do — copying the automation's
   * value into the manual variable is the obvious shortcut — and it silently
   * destroys the reason the second variable exists: every call would be
   * attributed to whichever entry matched last, so revoking "the manual
   * credential" would also revoke the pipeline's. Reported without printing or
   * digesting either value.
   */
  const secrets = configured.map((entry) => entry.secret);
  if (new Set(secrets).size !== secrets.length) {
    return `${INGEST_SECRET_ENV} and ${MANUAL_INGEST_SECRET_ENV} hold the same secret value, so the two cannot be told apart in an audit line or revoked independently — which is the only reason to have both. Give the manual credential a value of its own.`;
  }

  return null;
}

/** SHA-256, so every comparison operand is exactly 32 bytes. */
async function digest(value: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return new Uint8Array(hash);
}

/**
 * Branchless equality over two equal-length byte arrays.
 *
 * No early return, so the loop cost does not depend on where the arrays first
 * differ. Both operands are SHA-256 digests, so the length is a constant 32 and
 * the caller's secret length is not observable either.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index] ^ b[index];
  }
  return difference === 0;
}

/**
 * Reads the presented secret from the request headers.
 *
 * `Authorization: Bearer <secret>` is the accepted form. `X-Reporting-Ingest-Secret`
 * is also read, because some automation platforms make a custom header far
 * easier to set than an Authorization header, and refusing on that basis
 * pushes people towards putting it in the URL.
 *
 * Returns null when nothing was presented, which is a refusal and not an error.
 */
export function readPresentedSecret(headers: Headers): string | null {
  const authorization = headers.get(INGEST_AUTH_HEADER) ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (bearer) return bearer[1].trim();

  const custom = headers.get("x-reporting-ingest-secret");
  if (custom && custom.trim().length > 0) return custom.trim();

  return null;
}

export type IngestAuthOutcome =
  /** Verified. `credentialId` is safe to log; the secret is not returned. */
  | { status: "authorized"; credentialId: string }
  /** Nothing presented, or presented and wrong. Indistinguishable to a caller. */
  | { status: "unauthorized" }
  /** No usable credential configured. Nobody is let in. */
  | { status: "unconfigured"; problem: string }
  /** Too many failures from this caller. */
  | { status: "rate_limited"; retryAfterSeconds: number };

/**
 * Verifies a presented secret against every configured credential.
 *
 * EVERY CREDENTIAL IS CHECKED, even after a match. Returning early would make
 * the response time reveal the position of the matching entry in the list,
 * which is a small leak and a free one to close.
 */
export async function verifyIngestSecret(
  presented: string | null,
  credentials: IngestCredential[] = configuredCredentials(),
): Promise<{ authorized: boolean; credentialId: string | null }> {
  if (credentials.length === 0) return { authorized: false, credentialId: null };
  // Still hash a placeholder so a missing header costs the same as a wrong one.
  const candidate = await digest(presented ?? "");

  let credentialId: string | null = null;
  let authorized = false;
  for (const credential of credentials) {
    const known = await digest(credential.secret);
    if (timingSafeEqual(candidate, known) && presented !== null) {
      authorized = true;
      credentialId = credential.id;
    }
  }

  return { authorized, credentialId };
}

/**
 * The whole gate for one request: configuration, rate limit, verification.
 *
 * ORDER MATTERS. Configuration first, so a deployment missing its variable
 * refuses without spending a rate-limit slot on an honest caller. Then the
 * limit, so a guessing caller is cut off before any comparison. Then the
 * comparison, whose cost is constant either way.
 *
 * A SUCCESS CLEARS THE FAILURE RECORD. Automation retries; a pipeline that
 * fails twice on a network blip and then succeeds must not carry those
 * failures into the next window, and several pipelines behind one NAT must not
 * spend each other's budget.
 */
export async function authorizeIngestRequest(
  headers: Headers,
  options: { callerKey?: string } = {},
): Promise<IngestAuthOutcome> {
  const problem = credentialConfigurationProblem();
  const credentials = configuredCredentials();
  if (credentials.length === 0) {
    return {
      status: "unconfigured",
      problem:
        problem ??
        `Neither ${INGEST_SECRET_ENV} nor ${MANUAL_INGEST_SECRET_ENV} is set, so report ingestion is closed.`,
    };
  }

  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  const key = `reporting_ingest:${options.callerKey ?? forwarded ?? realIp ?? "unknown"}`;

  const limiter = getRateLimiter();
  const decision = limiter.check(key, ATTEMPT_BUDGET);
  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const presented = readPresentedSecret(headers);
  const { authorized, credentialId } = await verifyIngestSecret(presented, credentials);

  if (!authorized || credentialId === null) return { status: "unauthorized" };

  limiter.clear(key);
  return { status: "authorized", credentialId };
}
