import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { whatsNewVisibleFor, wovenHrNotifyFor } from "./whats-new-access";

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

describe("wovenHrNotifyFor (Pau, 28 Nov 2026: the hire and termination entries are \"ADMIN and HR Only\")", () => {
  it("a verified email on HR's notice list is HR, whatever its letter case; anyone else, or an unverified session, is not", () => {
    vi.stubEnv("WOVEN_HR_NOTIFY_EMAILS", "hr.one@example.test; HR.Two@example.test");
    expect(wovenHrNotifyFor({ email: "hr.two@example.test", verified: true })).toBe(true);
    expect(wovenHrNotifyFor({ email: " HR.ONE@example.test ", verified: true })).toBe(true);
    expect(wovenHrNotifyFor({ email: "cleo@example.test", verified: true })).toBe(false);
    expect(wovenHrNotifyFor({ email: "hr.one@example.test", verified: false })).toBe(false);
    expect(wovenHrNotifyFor({})).toBe(false);
  });

  it("no list: nobody", () => {
    vi.stubEnv("WOVEN_HR_NOTIFY_EMAILS", "");
    expect(wovenHrNotifyFor({ email: "hr.one@example.test", verified: true })).toBe(false);
  });
});
