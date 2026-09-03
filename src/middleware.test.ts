import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mintReviewToken,
  REVIEW_COOKIE,
  REVIEW_GATE_PATH,
  REVIEW_PASSWORD_ENV,
  REVIEW_SESSION_SECONDS,
} from "@/lib/reporting-review/gate";

import { config, middleware } from "./middleware";

/**
 * THE GATE AS ACTUALLY ENFORCED.
 *
 * `gate.test.ts` proves the DECISION is right — that an unconfigured
 * deployment reports `unconfigured` and a forged cookie is not `granted`. That
 * is not the same as proving the door is shut, because the decision is only
 * worth what the caller does with it, and the caller is this file.
 *
 * The property that matters is the one that cannot be checked from outside a
 * deployment: **a runtime with no `REPORTING_REVIEW_PASSWORD` must refuse
 * everybody, not admit everybody.** Production environment variables are not
 * always readable by whoever is doing the promotion, so "the dashboard is
 * public if that variable is missing" and "the dashboard is closed if that
 * variable is missing" are two deployments that look identical from here and
 * differ by whether real salon financials are on the open internet. It is
 * pinned here so it cannot be changed by accident.
 *
 * The password below is invented and local to this file.
 */

const PASSWORD = "invented-middleware-review-password-01";
const ORIGIN = "https://invented-review.test";

function requestFor(path: string, cookie?: string): NextRequest {
  const request = new NextRequest(new URL(path, ORIGIN));
  if (cookie !== undefined) request.cookies.set(REVIEW_COOKIE, cookie);
  return request;
}

/** Where the middleware sent this request, or null when it let it through. */
function redirectTarget(response: Response): URL | null {
  const location = response.headers.get("location");
  return location ? new URL(location) : null;
}

beforeEach(() => {
  process.env[REVIEW_PASSWORD_ENV] = PASSWORD;
});

afterEach(() => {
  delete process.env[REVIEW_PASSWORD_ENV];
});

describe("a deployment with no review password configured", () => {
  beforeEach(() => {
    delete process.env[REVIEW_PASSWORD_ENV];
  });

  it("refuses the dashboard rather than serving it to everybody", async () => {
    /*
     * THE TEST THIS FILE EXISTS FOR. The wrong direction here is not a
     * degraded experience, it is publishing salon-level financials. A missing
     * variable must read as "shut", never as "no gate requested".
     */
    const response = await middleware(requestFor("/reports/salon-performance"));

    expect(redirectTarget(response)?.pathname).toBe(REVIEW_GATE_PATH);
  });

  it("refuses the drill-down too", async () => {
    const response = await middleware(requestFor("/reports/salon-performance/0468"));
    expect(redirectTarget(response)?.pathname).toBe(REVIEW_GATE_PATH);
  });

  it("cannot be talked past with a cookie", async () => {
    // There is no key to sign with, so no cookie can be valid — including one
    // minted while the deployment still had a password.
    const stale = await mintReviewToken(PASSWORD, Date.now() + 60_000);
    const response = await middleware(
      requestFor("/reports/salon-performance", stale),
    );
    expect(redirectTarget(response)?.pathname).toBe(REVIEW_GATE_PATH);
  });
});

describe("a configured deployment", () => {
  it("lets a valid session through", async () => {
    const token = await mintReviewToken(
      PASSWORD,
      Date.now() + REVIEW_SESSION_SECONDS * 1000,
    );
    const response = await middleware(
      requestFor("/reports/salon-performance", token),
    );

    // Passed on to the route: no redirect.
    expect(redirectTarget(response)).toBeNull();
  });

  it("sends a reviewer with no cookie to the gate", async () => {
    const response = await middleware(requestFor("/reports/salon-performance"));
    expect(redirectTarget(response)?.pathname).toBe(REVIEW_GATE_PATH);
  });

  it("sends a reviewer with a forged cookie to the gate", async () => {
    const response = await middleware(
      requestFor("/reports/salon-performance", "v1.99999999999999.aW52ZW50ZWQ"),
    );
    expect(redirectTarget(response)?.pathname).toBe(REVIEW_GATE_PATH);
  });

  it("sends a reviewer whose session has expired to the gate", async () => {
    const expired = await mintReviewToken(PASSWORD, Date.now() - 1_000);
    const response = await middleware(
      requestFor("/reports/salon-performance", expired),
    );
    expect(redirectTarget(response)?.pathname).toBe(REVIEW_GATE_PATH);
  });
});

describe("what the redirect carries", () => {
  it("preserves the dashboard's query state so it survives the gate", async () => {
    /*
     * The dashboard's whole filter state is in the URL, and a stakeholder
     * opening a shared link lands on the gate. Dropping the query would send
     * them to a different view than the one they were sent.
     */
    const response = await middleware(
      requestFor("/reports/salon-performance?grain=monthly&period=mtd%3A2026-09-30"),
    );
    const target = redirectTarget(response);

    expect(target?.searchParams.get("next")).toBe(
      "/reports/salon-performance?grain=monthly&period=mtd%3A2026-09-30",
    );
    // And the dashboard's own parameters are not left loose on the gate URL,
    // where they would be read as the gate's own.
    expect(target?.searchParams.get("grain")).toBeNull();
    expect(target?.searchParams.get("period")).toBeNull();
  });

  it("carries the drill-down path, not just the dashboard", async () => {
    const response = await middleware(
      requestFor("/reports/salon-performance/0468?grain=monthly"),
    );
    expect(redirectTarget(response)?.searchParams.get("next")).toBe(
      "/reports/salon-performance/0468?grain=monthly",
    );
  });

  it("adds nothing to the redirect but the path the reviewer asked for", async () => {
    /*
     * `next` is the ONLY parameter the gate URL carries. Stated as an equality
     * rather than as "does not contain the password", because a redirect built
     * from the request cannot help echoing what the request already held — the
     * property worth pinning is that the middleware contributes no secret
     * material of its own: not the configured password, not the session
     * cookie, not a token minted from either.
     */
    const token = await mintReviewToken(PASSWORD, Date.now() - 1_000);
    const response = await middleware(
      requestFor("/reports/salon-performance?grain=monthly", token),
    );
    const target = redirectTarget(response);

    expect([...(target?.searchParams.keys() ?? [])]).toEqual(["next"]);
    expect(target?.searchParams.get("next")).toBe(
      "/reports/salon-performance?grain=monthly",
    );
    // Neither the password nor the rejected cookie is written into the URL.
    expect(target?.toString()).not.toContain(PASSWORD);
    expect(target?.toString()).not.toContain(token);
  });
});

describe("what the middleware does not touch", () => {
  it("passes the rest of the prototype straight through", async () => {
    for (const path of ["/", "/reports", "/chat", "/login", REVIEW_GATE_PATH]) {
      const response = await middleware(requestFor(path));
      expect(redirectTarget(response), path).toBeNull();
    }
  });

  it("matches the protected prefix and nothing wider", () => {
    /*
     * The matcher is the outer boundary: a path it does not match never reaches
     * the handler at all, so widening the protected prefixes without widening
     * this list would leave the new routes open in a real deployment while
     * every unit test above still passed.
     */
    expect(config.matcher).toEqual([
      "/reports/salon-performance",
      "/reports/salon-performance/:path*",
    ]);
  });
});
