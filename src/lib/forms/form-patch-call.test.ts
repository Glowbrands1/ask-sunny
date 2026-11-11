import { afterEach, describe, expect, it } from "vitest";

import { callFormPatchModel, FORM_PATCH_DEFAULT_TIMEOUT_MS, formPatchTimeoutMs } from "./form-patch-call";

/** Step B: the call's limit, and that it never throws. No network: without a key the call fails before any request. */

const saved = { timeout: process.env.FORM_PATCH_TIMEOUT_MS, key: process.env.ANTHROPIC_API_KEY };

afterEach(() => {
  for (const [name, value] of [
    ["FORM_PATCH_TIMEOUT_MS", saved.timeout],
    ["ANTHROPIC_API_KEY", saved.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("formPatchTimeoutMs", () => {
  it("is 5 s unless FORM_PATCH_TIMEOUT_MS says otherwise, clamped to 1-10 s", () => {
    delete process.env.FORM_PATCH_TIMEOUT_MS;
    expect(formPatchTimeoutMs()).toBe(FORM_PATCH_DEFAULT_TIMEOUT_MS);
    expect(FORM_PATCH_DEFAULT_TIMEOUT_MS).toBe(5_000);
    process.env.FORM_PATCH_TIMEOUT_MS = "2500";
    expect(formPatchTimeoutMs()).toBe(2_500);
    process.env.FORM_PATCH_TIMEOUT_MS = "200";
    expect(formPatchTimeoutMs()).toBe(1_000);
    process.env.FORM_PATCH_TIMEOUT_MS = "60000";
    expect(formPatchTimeoutMs()).toBe(10_000);
    process.env.FORM_PATCH_TIMEOUT_MS = "soon";
    expect(formPatchTimeoutMs()).toBe(FORM_PATCH_DEFAULT_TIMEOUT_MS);
  });
});

describe("callFormPatchModel", () => {
  it("returns an error fallback instead of throwing when the key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(callFormPatchModel({ system: "s", prompt: "p", schema: { type: "object" } })).resolves.toEqual({ fallback: "error" });
  }, 30_000);
});
