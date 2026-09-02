import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __setRateLimiter, InMemoryRateLimiter } from "@/lib/api/rate-limit";
import {
  authorizeIngestRequest,
  configuredCredentials,
  credentialConfigurationProblem,
  INGEST_SECRET_ENV,
  ingestCredentialConfigured,
  MIN_SECRET_LENGTH,
  parseIngestCredentials,
  readPresentedSecret,
  verifyIngestSecret,
} from "./ingest-credential";

/**
 * THE REPORT-INGESTION MACHINE CREDENTIAL.
 *
 * Every secret below is invented and local to this file. What is being pinned
 * is the set of properties that let this mechanism stand on its own in
 * production, with no external identity provider behind it: it fails closed, it
 * rotates without a gap, it revokes, it says the same thing to every wrong
 * answer, and it never hands the secret back.
 */

const SECRET_A = "invented-ingest-secret-aaaaaaaaaa";
const SECRET_B = "invented-ingest-secret-bbbbbbbbbb";

/** A fresh limiter per test, so one test's failures are not another's budget. */
let limiter: InMemoryRateLimiter;

beforeEach(() => {
  limiter = new InMemoryRateLimiter();
  __setRateLimiter(limiter);
  process.env[INGEST_SECRET_ENV] = `power-automate:${SECRET_A}`;
});

afterEach(() => {
  delete process.env[INGEST_SECRET_ENV];
  __setRateLimiter(new InMemoryRateLimiter());
});

function bearer(secret: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ authorization: `Bearer ${secret}`, ...extra });
}

describe("parsing the configured credentials", () => {
  it("accepts a bare secret and labels it", () => {
    // An operator setting one credential should not have to learn a syntax.
    expect(parseIngestCredentials(SECRET_A)).toEqual([{ id: "default", secret: SECRET_A }]);
  });

  it("accepts an id:secret pair", () => {
    expect(parseIngestCredentials(`monthly-job:${SECRET_A}`)).toEqual([
      { id: "monthly-job", secret: SECRET_A },
    ]);
  });

  it("accepts several, which is what rotation needs", () => {
    expect(parseIngestCredentials(`old:${SECRET_A},new:${SECRET_B}`)).toEqual([
      { id: "old", secret: SECRET_A },
      { id: "new", secret: SECRET_B },
    ]);
  });

  it("separates on whitespace too, so a pasted multi-line value still parses", () => {
    expect(parseIngestCredentials(`old:${SECRET_A}\n  new:${SECRET_B}`)).toHaveLength(2);
  });

  it("keeps colons inside a secret", () => {
    // Only the FIRST colon separates, so a base64-ish secret is not truncated.
    const withColons = "aaaaaaaaaaaaaaaaaaaaaaaa:bb:cc";
    expect(parseIngestCredentials(`job:${withColons}`)).toEqual([
      { id: "job", secret: withColons },
    ]);
  });

  it("drops an entry too short to be a credential", () => {
    // Fail CLOSED on a weak secret rather than run and look fine.
    expect(parseIngestCredentials("job:short")).toEqual([]);
    expect(parseIngestCredentials("x".repeat(MIN_SECRET_LENGTH - 1))).toEqual([]);
    expect(parseIngestCredentials("x".repeat(MIN_SECRET_LENGTH))).toHaveLength(1);
  });

  it("treats an unset or blank variable as no credentials at all", () => {
    expect(parseIngestCredentials(undefined)).toEqual([]);
    expect(parseIngestCredentials("   ")).toEqual([]);
  });
});

describe("telling an operator what is wrong", () => {
  it("says nothing when the configuration is sound", () => {
    expect(credentialConfigurationProblem()).toBeNull();
    expect(ingestCredentialConfigured()).toBe(true);
  });

  it("names the variable when it is unset", () => {
    delete process.env[INGEST_SECRET_ENV];
    expect(credentialConfigurationProblem()).toContain(INGEST_SECRET_ENV);
    expect(ingestCredentialConfigured()).toBe(false);
  });

  it("reports a rejected weak entry without printing it", () => {
    process.env[INGEST_SECRET_ENV] = "job:tooshort";
    const problem = credentialConfigurationProblem();
    expect(problem).toContain(String(MIN_SECRET_LENGTH));
    // The value must not appear in a message an operator might paste anywhere.
    expect(problem).not.toContain("tooshort");
  });

  it("reports a partially rejected list, and keeps the good entries", () => {
    process.env[INGEST_SECRET_ENV] = `good:${SECRET_A},weak:short`;
    expect(credentialConfigurationProblem()).toMatch(/rejected/i);
    expect(configuredCredentials()).toEqual([{ id: "good", secret: SECRET_A }]);
  });

  it("flags duplicate ids, because a revocation would then be ambiguous", () => {
    process.env[INGEST_SECRET_ENV] = `job:${SECRET_A},job:${SECRET_B}`;
    expect(credentialConfigurationProblem()).toMatch(/distinct id/i);
  });

  it("never includes any secret in a problem message", () => {
    for (const value of ["", "   ", "job:short", `good:${SECRET_A},weak:x`]) {
      process.env[INGEST_SECRET_ENV] = value;
      const problem = credentialConfigurationProblem() ?? "";
      expect(problem).not.toContain(SECRET_A);
      expect(problem).not.toContain(SECRET_B);
    }
  });
});

describe("reading the presented secret", () => {
  it("reads an Authorization bearer token", () => {
    expect(readPresentedSecret(bearer(SECRET_A))).toBe(SECRET_A);
    expect(readPresentedSecret(new Headers({ authorization: `bearer ${SECRET_A}` }))).toBe(
      SECRET_A,
    );
  });

  it("reads the custom header, so automation with no Authorization support fits", () => {
    expect(
      readPresentedSecret(new Headers({ "x-reporting-ingest-secret": SECRET_A })),
    ).toBe(SECRET_A);
  });

  it("returns null when nothing is presented", () => {
    expect(readPresentedSecret(new Headers())).toBeNull();
    expect(readPresentedSecret(new Headers({ authorization: "Bearer   " }))).toBeNull();
    expect(readPresentedSecret(new Headers({ authorization: "Basic abc" }))).toBeNull();
  });
});

describe("verifying a presented secret", () => {
  it("accepts the configured secret and names the credential", async () => {
    await expect(verifyIngestSecret(SECRET_A)).resolves.toEqual({
      authorized: true,
      credentialId: "power-automate",
    });
  });

  it("refuses a wrong secret, however close", async () => {
    for (const wrong of [
      SECRET_B,
      SECRET_A.slice(0, -1),
      `${SECRET_A} `,
      SECRET_A.toUpperCase(),
      SECRET_A.slice(1),
    ]) {
      await expect(verifyIngestSecret(wrong)).resolves.toEqual({
        authorized: false,
        credentialId: null,
      });
    }
  });

  it("refuses when nothing was presented", async () => {
    await expect(verifyIngestSecret(null)).resolves.toEqual({
      authorized: false,
      credentialId: null,
    });
    await expect(verifyIngestSecret("")).resolves.toEqual({
      authorized: false,
      credentialId: null,
    });
  });

  it("refuses everything when nothing is configured", async () => {
    // Fail CLOSED. A deployment missing its variable lets nobody in.
    delete process.env[INGEST_SECRET_ENV];
    await expect(verifyIngestSecret(SECRET_A)).resolves.toEqual({
      authorized: false,
      credentialId: null,
    });
  });

  it("accepts either credential during a rotation, and names which", async () => {
    /*
     * THE PROPERTY THAT MAKES ROTATION POSSIBLE. Both are live at once, so the
     * new one is added, the caller moves over, and the old one is removed —
     * with no window in which ingestion is broken. A single-valued secret
     * forces both sides to change simultaneously, which is why single-valued
     * secrets do not get rotated.
     */
    process.env[INGEST_SECRET_ENV] = `old:${SECRET_A},new:${SECRET_B}`;
    await expect(verifyIngestSecret(SECRET_A)).resolves.toEqual({
      authorized: true,
      credentialId: "old",
    });
    await expect(verifyIngestSecret(SECRET_B)).resolves.toEqual({
      authorized: true,
      credentialId: "new",
    });
  });

  it("revokes one credential without disturbing the other", async () => {
    process.env[INGEST_SECRET_ENV] = `new:${SECRET_B}`;
    await expect(verifyIngestSecret(SECRET_B)).resolves.toMatchObject({ authorized: true });
    // The removed one stops working immediately.
    await expect(verifyIngestSecret(SECRET_A)).resolves.toMatchObject({ authorized: false });
  });
});

describe("the whole gate, per request", () => {
  it("authorizes a correct credential", async () => {
    await expect(authorizeIngestRequest(bearer(SECRET_A))).resolves.toEqual({
      status: "authorized",
      credentialId: "power-automate",
    });
  });

  it("reports an unconfigured deployment separately, and lets nobody in", async () => {
    delete process.env[INGEST_SECRET_ENV];
    const outcome = await authorizeIngestRequest(bearer(SECRET_A));
    expect(outcome.status).toBe("unconfigured");
    // Separate so an OPERATOR can be told. Never "authorized".
    if (outcome.status === "unconfigured") {
      expect(outcome.problem).toContain(INGEST_SECRET_ENV);
      expect(outcome.problem).not.toContain(SECRET_A);
    }
  });

  it("returns the same unauthorized outcome for missing and wrong", async () => {
    await expect(authorizeIngestRequest(new Headers())).resolves.toEqual({
      status: "unauthorized",
    });
    await expect(authorizeIngestRequest(bearer(SECRET_B))).resolves.toEqual({
      status: "unauthorized",
    });
  });

  it("throttles a guessing caller", async () => {
    const headers = bearer(SECRET_B, { "x-forwarded-for": "203.0.113.7" });
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      outcomes.push((await authorizeIngestRequest(headers)).status);
    }
    expect(outcomes.filter((status) => status === "rate_limited").length).toBeGreaterThan(0);
    // And it is refused before any comparison, so it cannot be outlasted.
    expect(outcomes.at(-1)).toBe("rate_limited");
  });

  it("keeps budgets separate per caller", async () => {
    const guesser = bearer(SECRET_B, { "x-forwarded-for": "203.0.113.8" });
    for (let attempt = 0; attempt < 12; attempt += 1) await authorizeIngestRequest(guesser);

    const honest = bearer(SECRET_A, { "x-forwarded-for": "203.0.113.9" });
    await expect(authorizeIngestRequest(honest)).resolves.toMatchObject({
      status: "authorized",
    });
  });

  it("counts only failures, so a retrying pipeline never throttles itself", async () => {
    /*
     * Automation retries. A pipeline that fails a few times on a blip and then
     * succeeds must not carry those failures forward, and several pipelines
     * behind one office NAT must not spend each other's budget.
     */
    const ip = { "x-forwarded-for": "203.0.113.10" };
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await authorizeIngestRequest(bearer(SECRET_B, ip));
    }
    await expect(authorizeIngestRequest(bearer(SECRET_A, ip))).resolves.toMatchObject({
      status: "authorized",
    });

    // The successful call cleared the record, so the budget is whole again.
    const after: string[] = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      after.push((await authorizeIngestRequest(bearer(SECRET_B, ip))).status);
    }
    expect(after.every((status) => status === "unauthorized")).toBe(true);
  });

  it("never hands the secret back in any outcome", async () => {
    const outcomes = [
      await authorizeIngestRequest(bearer(SECRET_A)),
      await authorizeIngestRequest(bearer(SECRET_B)),
      await authorizeIngestRequest(new Headers()),
    ];
    for (const outcome of outcomes) {
      expect(JSON.stringify(outcome)).not.toContain(SECRET_A);
      expect(JSON.stringify(outcome)).not.toContain(SECRET_B);
    }
  });
});

describe("what the credential is not", () => {
  it("is not a user identity: it carries no profile, role or scope", async () => {
    /*
     * Stated as a test because the temptation is real. The moment this value
     * grows a role it becomes a login that every pipeline shares, and employee
     * authentication has to stay a separate, provider-agnostic concern —
     * see `src/lib/auth/`.
     */
    const outcome = await authorizeIngestRequest(bearer(SECRET_A));
    expect(outcome).toEqual({ status: "authorized", credentialId: "power-automate" });
    expect(Object.keys(outcome)).toEqual(["status", "credentialId"]);
  });
});
