import { afterEach, describe, expect, it, vi } from "vitest";

import { cleaningIncidentPhrase, cleaningUndonePhrase } from "./ca-policy";

/*
 * SPELLING_CLEANUP_ENABLED (Coding-2's review of the ca-policy.ts lines, 13 Nov 2026): "sanitation" is read as the
 * sanitizing it names, but the phrase the reader returns is quoted to the manager as their own words, so it must say
 * "sanitation" as written, never "sanitizing" or the reader's stand-in.
 */
describe("cleaningUndonePhrase quotes \"sanitation\" as written", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("with SPELLING_CLEANUP on, \"not doing the sanitation\" is read and quoted back as \"sanitation\"", () => {
    vi.stubEnv("SPELLING_CLEANUP_ENABLED", "true");
    vi.stubEnv("CLEANING_OTHER_EVERY_WORDING_ENABLED", "true");
    const phrase = cleaningUndonePhrase("She was not doing the sanitation in the morning.");
    expect(phrase).not.toBeNull();
    expect(phrase).toMatch(/\bsanitation\b/);
    expect(phrase).not.toMatch(/sanitizing|sanitzation/);
  });

  it("with SPELLING_CLEANUP on, \"did not do the sanitation\" is quoted back as \"sanitation\"", () => {
    vi.stubEnv("SPELLING_CLEANUP_ENABLED", "true");
    expect(cleaningUndonePhrase("She did not do the sanitation.")).toBe("did not do the sanitation");
  });

  it("the card's phrase (cleaningIncidentPhrase) says \"sanitation\" too", () => {
    vi.stubEnv("SPELLING_CLEANUP_ENABLED", "true");
    vi.stubEnv("POLICY_CLEANING_INCIDENT_ENABLED", "true");
    const phrase = cleaningIncidentPhrase("She did not do the sanitation.");
    expect(phrase).toMatch(/\bsanitation\b/);
    expect(phrase).not.toMatch(/sanitizing|sanitzation/);
  });

  it("a manager who wrote \"sanitizing\" is quoted as \"sanitizing\"", () => {
    vi.stubEnv("SPELLING_CLEANUP_ENABLED", "true");
    expect(cleaningUndonePhrase("She did not do the sanitizing.")).toMatch(/\bsanitizing\b/);
  });

  it("off, the phrase never holds the stand-in", () => {
    expect(cleaningUndonePhrase("She was not doing the sanitation.") ?? "").not.toMatch(/sanitzation/);
  });
});
