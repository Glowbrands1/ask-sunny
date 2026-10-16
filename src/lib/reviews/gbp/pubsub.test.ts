import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parsePushEnvelope, verifyPubSubRequest, type PubSubVerifyDeps } from "./pubsub";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256", kty: "RSA" } as never;
const NOW = 1_800_000_000_000;
const deps: PubSubVerifyDeps = { fetchJwks: async () => [jwk], now: () => NOW };
const expected: { audience: string | undefined; serviceAccount: string | undefined } = { audience: "https://app.example/api/reviews/gbp/pubsub", serviceAccount: "push@proj.iam.gserviceaccount.com" };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(over: Record<string, unknown> = {}, opts: { key?: typeof privateKey; header?: object } = {}) {
  const header = { alg: "RS256", kid: "k1", typ: "JWT", ...(opts.header ?? {}) };
  const claims = {
    iss: "https://accounts.google.com",
    aud: expected.audience,
    email: expected.serviceAccount,
    email_verified: true,
    iat: NOW / 1000 - 10,
    exp: NOW / 1000 + 3000,
    ...over,
  };
  const signing = `${b64(header)}.${b64(claims)}`;
  const signature = createSign("RSA-SHA256").update(signing).sign(opts.key ?? privateKey).toString("base64url");
  return `Bearer ${signing}.${signature}`;
}
const verify = (header: string | null, exp = expected) => verifyPubSubRequest(header, exp, deps);

describe("Pub/Sub OIDC verification", () => {
  it("accepts a valid Google-signed token for our audience and service account", async () => {
    expect(await verify(token())).toBe("ok");
  });
  it("is unconfigured without an audience or service account — never open", async () => {
    expect(await verify(token(), { audience: undefined, serviceAccount: expected.serviceAccount })).toBe("unconfigured");
    expect(await verify(token(), { audience: expected.audience, serviceAccount: undefined })).toBe("unconfigured");
  });
  it.each([
    ["no header", null],
    ["not a bearer", "Basic abc"],
    ["malformed jwt", "Bearer a.b"],
  ])("rejects %s", async (_n, header) => {
    expect(await verify(header)).toBe("unauthorized");
  });
  it("rejects a token signed by a different key", async () => {
    expect(await verify(token({}, { key: otherKey }))).toBe("unauthorized");
  });
  it("rejects a tampered payload", async () => {
    const t = token();
    const [h, , s] = t.slice(7).split(".");
    expect(await verify(`Bearer ${h}.${b64({ iss: "accounts.google.com", aud: expected.audience, email: expected.serviceAccount, email_verified: true, exp: NOW / 1000 + 999999 })}.${s}`)).toBe("unauthorized");
  });
  it("rejects the wrong audience, issuer, service account, unverified email and an expired token", async () => {
    expect(await verify(token({ aud: "https://evil" }))).toBe("unauthorized");
    expect(await verify(token({ iss: "https://evil.example" }))).toBe("unauthorized");
    expect(await verify(token({ email: "other@proj.iam.gserviceaccount.com" }))).toBe("unauthorized");
    expect(await verify(token({ email_verified: false }))).toBe("unauthorized");
    expect(await verify(token({ exp: NOW / 1000 - 600 }))).toBe("unauthorized");
  });
  it("rejects alg none and HS256 downgrades", async () => {
    expect(await verify(token({}, { header: { alg: "none" } }))).toBe("unauthorized");
    expect(await verify(token({}, { header: { alg: "HS256" } }))).toBe("unauthorized");
  });
  it("rejects an unknown key id", async () => {
    expect(await verify(token({}, { header: { kid: "nope" } }))).toBe("unauthorized");
  });
  it("fails closed when Google's keys cannot be fetched", async () => {
    const down: PubSubVerifyDeps = { ...deps, fetchJwks: async () => { throw new Error("down"); } };
    expect(await verifyPubSubRequest(token(), expected, down)).toBe("unauthorized");
  });
});

describe("parsePushEnvelope", () => {
  const envelope = (payload: unknown) => ({ message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") } });
  it("extracts account and location from a review notification", () => {
    const parsed = parsePushEnvelope(envelope({ notificationType: "NEW_REVIEW", review: "accounts/12/locations/34/reviews/abc" }));
    expect(parsed).toMatchObject({ ok: true, accountName: "accounts/12", locationName: "locations/34" });
  });
  it("accepts Google's reviewName / locationName field names", () => {
    expect(parsePushEnvelope(envelope({ notificationType: "UPDATED_REVIEW", reviewName: "accounts/7/locations/8/reviews/zz", locationName: "accounts/7/locations/8" }))).toMatchObject({ ok: true, accountName: "accounts/7", locationName: "locations/8" });
    expect(parsePushEnvelope(envelope({ reviewName: "accounts/7/locations/8/reviews/zz" }))).toMatchObject({ ok: true, locationName: "locations/8" });
  });
  it("rejects malformed envelopes and resource names", () => {
    expect(parsePushEnvelope({}).ok).toBe(false);
    expect(parsePushEnvelope({ message: { data: "!!!" } }).ok).toBe(false);
    expect(parsePushEnvelope(envelope({ location: "accounts/1/locations/../../x" })).ok).toBe(false);
  });
});
