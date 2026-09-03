import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SIGNATURE_HEADERS,
  signWebhook,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifyWebhookSignature,
  WEBHOOK_SECRET_ENV,
  webhookSecretConfigured,
} from "./webhook-signature";

/**
 * RESEND WEBHOOK SIGNATURE VERIFICATION.
 *
 * The secret below is invented. What is being pinned is the Standard Webhooks
 * scheme Resend signs with, and this is the one module in the inbound path
 * where a subtle mistake would be invisible: a verifier that accepts everything
 * passes every functional test and turns the endpoint into a public write API.
 *
 * So the expected signature is computed here INDEPENDENTLY with `node:crypto`,
 * rather than by calling the module's own signer. A test that signs with the
 * same code it verifies with proves only that the code agrees with itself.
 */

// 32 invented bytes, base64, in the `whsec_` shape Resend issues.
const SECRET = "whsec_aW52ZW50ZWQtcmVzZW5kLXdlYmhvb2stc2lnbmluZy1rZXk=";
const RAW_BODY = JSON.stringify({
  type: "email.received",
  data: { email_id: "invented-email-id", subject: "Comp Report TEST" },
});
const MESSAGE_ID = "msg_invented_2vLp";

/** The scheme, implemented from the specification rather than from the module. */
function independentSignature(input: {
  secret: string;
  id: string;
  timestamp: string;
  body: string;
}): string {
  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.body}`)
    .digest("base64");
}

function headers(overrides: Partial<Record<"id" | "timestamp" | "signature", string>> = {}) {
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000));
  const id = overrides.id ?? MESSAGE_ID;
  const signature =
    overrides.signature ??
    `v1,${independentSignature({ secret: SECRET, id, timestamp, body: RAW_BODY })}`;
  return new Headers({
    [SIGNATURE_HEADERS.id]: id,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.signature]: signature,
  });
}

beforeEach(() => {
  process.env[WEBHOOK_SECRET_ENV] = SECRET;
});

afterEach(() => {
  delete process.env[WEBHOOK_SECRET_ENV];
});

describe("the signing scheme", () => {
  it("matches an independently computed signature", async () => {
    // If this fails, the module implements a different scheme from Resend's,
    // and nothing else in this file means anything.
    const timestamp = "1788000000";
    const mine = await signWebhook({
      secret: SECRET,
      id: MESSAGE_ID,
      timestamp,
      rawBody: RAW_BODY,
    });
    expect(mine).toBe(
      independentSignature({ secret: SECRET, id: MESSAGE_ID, timestamp, body: RAW_BODY }),
    );
  });

  it("signs the id, the timestamp and the body together", async () => {
    // Changing any one of the three must change the signature, or a delivery
    // could be replayed under a different id or timestamp.
    const base = { secret: SECRET, id: MESSAGE_ID, timestamp: "1788000000", rawBody: RAW_BODY };
    const original = await signWebhook(base);
    expect(await signWebhook({ ...base, id: "msg_other" })).not.toBe(original);
    expect(await signWebhook({ ...base, timestamp: "1788000001" })).not.toBe(original);
    expect(await signWebhook({ ...base, rawBody: `${RAW_BODY} ` })).not.toBe(original);
  });

  it("accepts a secret with or without the whsec_ prefix", async () => {
    const bare = SECRET.replace(/^whsec_/, "");
    const withPrefix = await signWebhook({
      secret: SECRET,
      id: MESSAGE_ID,
      timestamp: "1788000000",
      rawBody: RAW_BODY,
    });
    const without = await signWebhook({
      secret: bare,
      id: MESSAGE_ID,
      timestamp: "1788000000",
      rawBody: RAW_BODY,
    });
    expect(without).toBe(withPrefix);
  });
});

describe("verifying a delivery", () => {
  it("accepts a correctly signed delivery", async () => {
    await expect(
      verifyWebhookSignature({ headers: headers(), rawBody: RAW_BODY }),
    ).resolves.toEqual({ valid: true });
  });

  it("refuses a body that changed by one byte", async () => {
    /*
     * THE REASON THE ROUTE MUST NOT PARSE FIRST. `JSON.parse` then
     * `JSON.stringify` reorders keys and drops whitespace; the signature is
     * over the bytes as received, so any re-serialisation breaks it.
     */
    const verdict = await verifyWebhookSignature({
      headers: headers(),
      rawBody: `${RAW_BODY} `,
    });
    expect(verdict.valid).toBe(false);
  });

  it("refuses a forged signature", async () => {
    const verdict = await verifyWebhookSignature({
      headers: headers({ signature: "v1,aW52ZW50ZWQtZm9yZ2VkLXNpZ25hdHVyZS12YWx1ZQ==" }),
      rawBody: RAW_BODY,
    });
    expect(verdict.valid).toBe(false);
  });

  it("refuses a signature made with a different secret", async () => {
    const other = "whsec_YW5vdGhlci1pbnZlbnRlZC1zaWduaW5nLWtleS12YWx1ZQ==";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const verdict = await verifyWebhookSignature({
      headers: headers({
        timestamp,
        signature: `v1,${independentSignature({ secret: other, id: MESSAGE_ID, timestamp, body: RAW_BODY })}`,
      }),
      rawBody: RAW_BODY,
    });
    expect(verdict.valid).toBe(false);
  });

  it("refuses a stale timestamp, so a captured delivery cannot be replayed", async () => {
    const stale = String(Math.floor(Date.now() / 1000) - TIMESTAMP_TOLERANCE_SECONDS - 60);
    const verdict = await verifyWebhookSignature({
      headers: headers({ timestamp: stale }),
      rawBody: RAW_BODY,
    });
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.reason).toMatch(/tolerance/i);
  });

  it("refuses a timestamp too far in the future", async () => {
    const ahead = String(Math.floor(Date.now() / 1000) + TIMESTAMP_TOLERANCE_SECONDS + 60);
    await expect(
      verifyWebhookSignature({ headers: headers({ timestamp: ahead }), rawBody: RAW_BODY }),
    ).resolves.toMatchObject({ valid: false });
  });

  it("accepts a delivery inside the tolerance window", async () => {
    const recent = String(Math.floor(Date.now() / 1000) - (TIMESTAMP_TOLERANCE_SECONDS - 30));
    await expect(
      verifyWebhookSignature({ headers: headers({ timestamp: recent }), rawBody: RAW_BODY }),
    ).resolves.toEqual({ valid: true });
  });

  it("refuses a missing header rather than skipping the check", async () => {
    for (const missing of Object.values(SIGNATURE_HEADERS)) {
      const incomplete = headers();
      incomplete.delete(missing);
      await expect(
        verifyWebhookSignature({ headers: incomplete, rawBody: RAW_BODY }),
      ).resolves.toMatchObject({ valid: false });
    }
  });

  it("refuses everything when no secret is configured", async () => {
    // Fail CLOSED. A deployment missing its variable must verify nothing, not
    // everything.
    delete process.env[WEBHOOK_SECRET_ENV];
    await expect(
      verifyWebhookSignature({ headers: headers(), rawBody: RAW_BODY }),
    ).resolves.toMatchObject({ valid: false });
    expect(webhookSecretConfigured()).toBe(false);
  });

  it("refuses a malformed secret rather than throwing", async () => {
    process.env[WEBHOOK_SECRET_ENV] = "whsec_";
    await expect(
      verifyWebhookSignature({ headers: headers(), rawBody: RAW_BODY }),
    ).resolves.toMatchObject({ valid: false });
  });

  it("accepts either signature during a secret rotation", async () => {
    /*
     * Svix sends several space-delimited signatures while an endpoint secret is
     * being rotated. Accepting any valid one is what lets the secret be
     * changed without dropping a delivery.
     */
    const timestamp = String(Math.floor(Date.now() / 1000));
    const old = "whsec_b2xkLWludmVudGVkLXNpZ25pbmcta2V5LXZhbHVlLi4=";
    const both = [
      `v1,${independentSignature({ secret: old, id: MESSAGE_ID, timestamp, body: RAW_BODY })}`,
      `v1,${independentSignature({ secret: SECRET, id: MESSAGE_ID, timestamp, body: RAW_BODY })}`,
    ].join(" ");

    await expect(
      verifyWebhookSignature({ headers: headers({ timestamp, signature: both }), rawBody: RAW_BODY }),
    ).resolves.toEqual({ valid: true });
  });

  it("ignores an unknown signature version", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v2,${independentSignature({ secret: SECRET, id: MESSAGE_ID, timestamp, body: RAW_BODY })}`;
    await expect(
      verifyWebhookSignature({ headers: headers({ timestamp, signature }), rawBody: RAW_BODY }),
    ).resolves.toMatchObject({ valid: false });
  });

  it("never puts the secret in a verdict", async () => {
    delete process.env[WEBHOOK_SECRET_ENV];
    const verdict = await verifyWebhookSignature({
      headers: headers(),
      rawBody: RAW_BODY,
      secret: SECRET,
    });
    expect(JSON.stringify(verdict)).not.toContain(SECRET);
    expect(JSON.stringify(verdict)).not.toContain(SECRET.replace(/^whsec_/, ""));
  });
});
