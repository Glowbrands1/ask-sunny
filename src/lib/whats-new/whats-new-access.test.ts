import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { whatsNewVisibleFor } from "./whats-new-access";

/* NEXT_PUBLIC_WHATS_NEW_ENABLED and WHATS_NEW_USERS (the owner, 27 Nov 2026: "live but on my own page only"). Invented addresses only. */

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_WHATS_NEW_ENABLED", "");
  vi.stubEnv("WHATS_NEW_USERS", "ada@example.test, Bea@Example.test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("whatsNewVisibleFor", () => {
  it("switch off: a listed, verified email sees it, whatever its letter case or spaces", () => {
    expect(whatsNewVisibleFor({ email: "ada@example.test", verified: true })).toBe(true);
    expect(whatsNewVisibleFor({ email: "  ADA@example.TEST ", verified: true })).toBe(true);
    expect(whatsNewVisibleFor({ email: "bea@example.test", verified: true })).toBe(true);
  });

  it("switch off: an unlisted email does not", () => {
    expect(whatsNewVisibleFor({ email: "cleo@example.test", verified: true })).toBe(false);
  });

  it("switch off: a listed email on an unverified session does not, nor no email", () => {
    expect(whatsNewVisibleFor({ email: "ada@example.test", verified: false })).toBe(false);
    expect(whatsNewVisibleFor({ email: "ada@example.test" })).toBe(false);
    expect(whatsNewVisibleFor({ email: null, verified: true })).toBe(false);
    expect(whatsNewVisibleFor({})).toBe(false);
  });

  it("switch off and no list: nobody", () => {
    vi.stubEnv("WHATS_NEW_USERS", "");
    expect(whatsNewVisibleFor({ email: "ada@example.test", verified: true })).toBe(false);
    vi.stubEnv("WHATS_NEW_USERS", " , ");
    expect(whatsNewVisibleFor({ email: "ada@example.test", verified: true })).toBe(false);
  });

  it("switch on: everyone, listed or not (the rollout)", () => {
    vi.stubEnv("NEXT_PUBLIC_WHATS_NEW_ENABLED", "true");
    expect(whatsNewVisibleFor({ email: "cleo@example.test", verified: true })).toBe(true);
    expect(whatsNewVisibleFor({})).toBe(true);
  });
});
