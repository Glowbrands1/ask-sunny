import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkReviewPassword,
  isProtectedPath,
  mintReviewToken,
  PROTECTED_PREFIXES,
  REVIEW_GATE_PATH,
  REVIEW_PASSWORD_ENV,
  REVIEW_SESSION_SECONDS,
  reviewAccessState,
  reviewCookieOptions,
  reviewGateConfigured,
  safeNextPath,
  verifyReviewToken,
} from "./gate";

/**
 * THE TEMPORARY STAKEHOLDER-REVIEW GATE.
 *
 * These tests hold the properties that make a shared-password door acceptable
 * as a review mechanism: it fails closed, it cannot be forged or extended from
 * the browser, it never carries the password, and it says the same thing to
 * every wrong answer.
 *
 * The password used here is invented and local to this file.
 */

const PASSWORD = "invented-review-password-1234";
const WRONG = "invented-review-password-1235";

beforeEach(() => {
  process.env[REVIEW_PASSWORD_ENV] = PASSWORD;
});

afterEach(() => {
  delete process.env[REVIEW_PASSWORD_ENV];
});

describe("which paths the gate covers", () => {
  it("protects the reporting dashboard and everything under it", () => {
    expect(isProtectedPath("/reports/salon-performance")).toBe(true);
    // A drill-down added later is covered the moment it exists, rather than the
    // moment somebody remembers to add it to a list.
    expect(isProtectedPath("/reports/salon-performance/0468")).toBe(true);
    expect(isProtectedPath("/reports/salon-performance/0468/quality")).toBe(true);
  });

  it("leaves the rest of the prototype alone", () => {
    for (const path of ["/reports", "/chat", "/knowledge", "/admin/users", "/"]) {
      expect(isProtectedPath(path)).toBe(false);
    }
  });

  it("does not protect the gate itself, which would be a redirect loop", () => {
    expect(isProtectedPath(REVIEW_GATE_PATH)).toBe(false);
  });

  it("does not match a path that merely starts with the same characters", () => {
    expect(isProtectedPath("/reports/salon-performance-export")).toBe(false);
  });
});

describe("the password check", () => {
  it("accepts the configured password", async () => {
    await expect(checkReviewPassword(PASSWORD)).resolves.toBe(true);
  });

  it("refuses a wrong password, however close", async () => {
    await expect(checkReviewPassword(WRONG)).resolves.toBe(false);
    await expect(checkReviewPassword(PASSWORD.slice(0, -1))).resolves.toBe(false);
    await expect(checkReviewPassword(`${PASSWORD} `)).resolves.toBe(false);
    await expect(checkReviewPassword(PASSWORD.toUpperCase())).resolves.toBe(false);
  });

  it("refuses an empty submission", async () => {
    await expect(checkReviewPassword("")).resolves.toBe(false);
  });

  it("refuses everything when no password is configured", async () => {
    // Fail CLOSED. A deployment missing its variable must let nobody in, not
    // everybody.
    delete process.env[REVIEW_PASSWORD_ENV];
    await expect(checkReviewPassword("")).resolves.toBe(false);
    await expect(checkReviewPassword(PASSWORD)).resolves.toBe(false);
  });
});

describe("the session token", () => {
  it("verifies a token it just minted", async () => {
    const expiry = Date.now() + 60_000;
    const token = await mintReviewToken(PASSWORD, expiry);
    await expect(verifyReviewToken(token, PASSWORD)).resolves.toBe(true);
  });

  it("never contains the password", async () => {
    const token = await mintReviewToken(PASSWORD, Date.now() + 60_000);
    expect(token).not.toContain(PASSWORD);
    // Nor any recognisable slice of it.
    expect(token.toLowerCase()).not.toContain("invented");
  });

  it("refuses a token signed with a different password", async () => {
    // Rotating the review password ends every existing session, because the
    // signing key is derived from the password.
    const token = await mintReviewToken(WRONG, Date.now() + 60_000);
    await expect(verifyReviewToken(token, PASSWORD)).resolves.toBe(false);
  });

  it("refuses an expired token", async () => {
    const token = await mintReviewToken(PASSWORD, Date.now() - 1);
    await expect(verifyReviewToken(token, PASSWORD)).resolves.toBe(false);
  });

  it("refuses a token whose expiry has been extended", async () => {
    // The expiry is inside the signature, so editing the cookie breaks it.
    const expiry = Date.now() + 60_000;
    const token = await mintReviewToken(PASSWORD, expiry);
    const [version, , signature] = token.split(".");
    const extended = `${version}.${expiry + 86_400_000}.${signature}`;
    await expect(verifyReviewToken(extended, PASSWORD)).resolves.toBe(false);
  });

  it("refuses a tampered signature", async () => {
    const token = await mintReviewToken(PASSWORD, Date.now() + 60_000);
    const [version, expiry, signature] = token.split(".");
    const flipped = signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
    await expect(verifyReviewToken(`${version}.${expiry}.${flipped}`, PASSWORD)).resolves.toBe(
      false,
    );
  });

  it("refuses malformed input rather than throwing", async () => {
    for (const bad of ["", "nonsense", "v1.abc", "v1.123", "v2.123.sig", "a.b.c.d"]) {
      await expect(verifyReviewToken(bad, PASSWORD)).resolves.toBe(false);
    }
    await expect(verifyReviewToken(undefined, PASSWORD)).resolves.toBe(false);
    await expect(verifyReviewToken(null, PASSWORD)).resolves.toBe(false);
  });
});

describe("the access decision", () => {
  it("grants a valid session", async () => {
    const token = await mintReviewToken(PASSWORD, Date.now() + 60_000);
    await expect(reviewAccessState(token)).resolves.toBe("granted");
  });

  it("denies no cookie, a stale cookie and a forged one alike", async () => {
    await expect(reviewAccessState(undefined)).resolves.toBe("denied");
    await expect(reviewAccessState(await mintReviewToken(PASSWORD, Date.now() - 1)))
      .resolves.toBe("denied");
    await expect(reviewAccessState(await mintReviewToken(WRONG, Date.now() + 60_000)))
      .resolves.toBe("denied");
  });

  it("reports an unconfigured deployment separately, and still lets nobody in", async () => {
    delete process.env[REVIEW_PASSWORD_ENV];
    const token = await mintReviewToken(PASSWORD, Date.now() + 60_000);
    // Separate so an OPERATOR can be told the deployment is missing a variable.
    // Not "granted" — the distinction is for the message, never for access.
    await expect(reviewAccessState(token)).resolves.toBe("unconfigured");
    expect(reviewGateConfigured()).toBe(false);
  });

  it("knows when it is configured", () => {
    expect(reviewGateConfigured()).toBe(true);
  });
});

describe("the cookie", () => {
  it("is HttpOnly, SameSite=Lax and expires within the session window", () => {
    const now = Date.now();
    const options = reviewCookieOptions(now);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    const lifetimeSeconds = (options.expires.getTime() - now) / 1000;
    expect(lifetimeSeconds).toBe(REVIEW_SESSION_SECONDS);
    // Between eight and twelve hours, as agreed.
    expect(lifetimeSeconds).toBeGreaterThanOrEqual(8 * 3600);
    expect(lifetimeSeconds).toBeLessThanOrEqual(12 * 3600);
  });

  it("is Secure in a production build", () => {
    // `next build` and `next start` both set NODE_ENV=production, so a deployed
    // review environment gets the Secure attribute; a local http dev server
    // would silently drop the cookie if it were set there.
    const original = process.env.NODE_ENV;
    const setNodeEnv = (value: string) => {
      Object.defineProperty(process.env, "NODE_ENV", {
        value,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    };
    try {
      setNodeEnv("production");
      expect(reviewCookieOptions().secure).toBe(true);
      setNodeEnv("development");
      expect(reviewCookieOptions().secure).toBe(false);
    } finally {
      setNodeEnv(original ?? "test");
    }
  });
});

describe("the post-login redirect", () => {
  it("keeps an internal protected path", () => {
    expect(safeNextPath("/reports/salon-performance")).toBe("/reports/salon-performance");
    expect(safeNextPath("/reports/salon-performance?vs=last_3m")).toBe(
      "/reports/salon-performance?vs=last_3m",
    );
  });

  it("refuses an absolute or protocol-relative URL", () => {
    // Without this the `next` parameter is an open redirect: a crafted link
    // would take a reviewer through the gate and straight off-site, carrying
    // the review deployment's name in the referrer.
    for (const hostile of [
      "https://example.invalid/",
      "//example.invalid/",
      "http://example.invalid/reports/salon-performance",
    ]) {
      expect(safeNextPath(hostile)).toBe(PROTECTED_PREFIXES[0]);
    }
  });

  it("refuses an internal path that is not behind the gate", () => {
    // Passing through the gate must not become a way to land anywhere at all.
    expect(safeNextPath("/admin/users")).toBe(PROTECTED_PREFIXES[0]);
    expect(safeNextPath("/chat")).toBe(PROTECTED_PREFIXES[0]);
  });

  it("falls back when given nothing", () => {
    expect(safeNextPath(null)).toBe(PROTECTED_PREFIXES[0]);
    expect(safeNextPath(undefined)).toBe(PROTECTED_PREFIXES[0]);
    expect(safeNextPath("")).toBe(PROTECTED_PREFIXES[0]);
  });
});
