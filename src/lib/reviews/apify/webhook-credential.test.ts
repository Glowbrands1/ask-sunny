import { afterEach, describe, expect, it } from "vitest";

import { REVIEW_SYNC_SECRET_ENV } from "../sync-credential";
import {
  APIFY_WEBHOOK_SECRET_ENV,
  apifyWebhookConfigurationProblem,
  apifyWebhookConfigured,
  authorizeApifyWebhook,
  resolveCallbackBaseUrl,
  webhookSecretForOutboundUse,
} from "./webhook-credential";

/**
 * ============================================================================
 * THE CREDENTIAL APIFY PRESENTS WHEN A RUN FINISHES
 * ============================================================================
 *
 * A shared secret held by a third party is ONE factor, not a security model:
 * the route also requires the body to name a run this system started and is
 * still waiting on, and then reads the results from Apify's own API rather than
 * from the request. What these cover is that the first factor behaves like
 * every other machine credential here — configuration first, then the rate
 * limit, then a constant-time comparison, and one answer for every failure.
 *
 * Every secret below is invented and none is or resembles a real one.
 */

const SECRET = "fixture-apify-webhook-secret-not-real-0001";
const OTHER = "fixture-apify-webhook-secret-not-real-0002";

function headers(token?: string): Headers {
  const value = new Headers();
  if (token !== undefined) value.set("authorization", `Bearer ${token}`);
  /* A distinct caller per test, so a rate limit does not leak between them. */
  value.set("x-forwarded-for", `10.0.0.${Math.floor(Math.random() * 250) + 1}`);
  return value;
}

afterEach(() => {
  delete process.env[APIFY_WEBHOOK_SECRET_ENV];
  delete process.env[REVIEW_SYNC_SECRET_ENV];
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_URL;
});

describe("configuration", () => {
  it("REFUSES EVERYTHING WHEN UNSET, rather than accepting anonymous callers", () => {
    expect(apifyWebhookConfigured()).toBe(false);
    expect(apifyWebhookConfigurationProblem()).toContain(APIFY_WEBHOOK_SECRET_ENV);
  });

  it("ignores a secret too short to be one, and says so", () => {
    process.env[APIFY_WEBHOOK_SECRET_ENV] = "short";
    expect(apifyWebhookConfigured()).toBe(false);
    expect(apifyWebhookConfigurationProblem()).toContain("shorter than");
  });

  it("accepts a labelled entry and offers the first for outbound use", () => {
    process.env[APIFY_WEBHOOK_SECRET_ENV] = `current:${SECRET},previous:${OTHER}`;
    expect(apifyWebhookConfigured()).toBe(true);
    expect(apifyWebhookConfigurationProblem()).toBeNull();
    /*
     * ROTATION: both verify inbound while new runs are attached with the first,
     * so the old value can be removed once the last run carrying it lands.
     */
    expect(webhookSecretForOutboundUse()).toBe(SECRET);
  });

  it("IS A SEPARATE VARIABLE FROM THE EXTENSION'S, and shares no value with it", () => {
    /*
     * The two must be revocable independently. One sits in an Options page on a
     * laptop; this one sits in a webhook configuration on a third party's
     * platform. Revoking either must not take the other down.
     */
    process.env[REVIEW_SYNC_SECRET_ENV] = "fixture-brave-extension-secret-not-real";
    expect(apifyWebhookConfigured()).toBe(false);
    expect(APIFY_WEBHOOK_SECRET_ENV).not.toBe(REVIEW_SYNC_SECRET_ENV);
  });
});

describe("the gate", () => {
  it("reports unconfigured before it reads anything the caller sent", async () => {
    const outcome = await authorizeApifyWebhook(headers(SECRET));
    expect(outcome.status).toBe("unconfigured");
  });

  it("authorizes the configured secret and names the credential, never the value", async () => {
    process.env[APIFY_WEBHOOK_SECRET_ENV] = `apify-preview:${SECRET}`;
    const outcome = await authorizeApifyWebhook(headers(SECRET));

    expect(outcome.status).toBe("authorized");
    if (outcome.status === "authorized") {
      expect(outcome.credentialId).toBe("apify-preview");
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    }
  });

  it("refuses a wrong secret, a missing header and a bare value alike", async () => {
    process.env[APIFY_WEBHOOK_SECRET_ENV] = SECRET;

    expect((await authorizeApifyWebhook(headers(OTHER))).status).toBe("unauthorized");
    expect((await authorizeApifyWebhook(headers())).status).toBe("unauthorized");
    expect((await authorizeApifyWebhook(new Headers())).status).toBe("unauthorized");
  });

  it("cuts a guessing caller off before the budget is spent on comparisons", async () => {
    process.env[APIFY_WEBHOOK_SECRET_ENV] = SECRET;
    const callerKey = "fixture-guesser";

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const outcome = await authorizeApifyWebhook(headers(OTHER), { callerKey });
      expect(outcome.status).toBe("unauthorized");
    }

    expect((await authorizeApifyWebhook(headers(OTHER), { callerKey })).status).toBe(
      "rate_limited",
    );
  });

  it("a success clears the failure record, so one fumble is not carried forward", async () => {
    process.env[APIFY_WEBHOOK_SECRET_ENV] = SECRET;
    const callerKey = "fixture-fumbler";

    await authorizeApifyWebhook(headers(OTHER), { callerKey });
    expect((await authorizeApifyWebhook(headers(SECRET), { callerKey })).status).toBe(
      "authorized",
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await authorizeApifyWebhook(headers(OTHER), { callerKey });
    }
    expect((await authorizeApifyWebhook(headers(OTHER), { callerKey })).status).toBe(
      "rate_limited",
    );
  });
});

describe("where Apify is told to call back", () => {
  it("uses the deployment's configured site URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://ask-sunny.example/";
    expect(resolveCallbackBaseUrl()).toBe("https://ask-sunny.example");
  });

  it("falls back to Vercel's per-deployment host, which is what a Preview has", () => {
    process.env.VERCEL_URL = "ask-sunny-preview.vercel.app";
    expect(resolveCallbackBaseUrl()).toBe("https://ask-sunny-preview.vercel.app");
  });

  it("RETURNS NULL RATHER THAN GUESSING, so no callback is built from a header", () => {
    /*
     * Building a callback URL out of a request's Host header would let somebody
     * who can reach the trigger point Apify's callback — and the secret
     * attached to it — at a host of their choosing.
     */
    expect(resolveCallbackBaseUrl()).toBeNull();
  });
});
