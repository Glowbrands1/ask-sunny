import { describe, expect, it } from "vitest";

import { APPROVED_SOURCES, findApprovedSource } from "./approved-sources";

describe("approved source digests", () => {
  it("holds well-formed lowercase SHA-256 digests", () => {
    expect(APPROVED_SOURCES.length).toBeGreaterThan(0);
    for (const source of APPROVED_SOURCES) {
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.description.trim().length).toBeGreaterThan(0);
      expect(source.sourceCode).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
    }
  });

  it("matches case-insensitively and ignores surrounding space", () => {
    const known = APPROVED_SOURCES[0].sha256;
    expect(findApprovedSource(known)).not.toBeNull();
    expect(findApprovedSource(known.toUpperCase())).not.toBeNull();
    expect(findApprovedSource(`  ${known}  `)).not.toBeNull();
  });

  it("refuses anything not on the list", () => {
    // This is the whole gate: an unapproved artifact cannot be ingested.
    expect(findApprovedSource("0".repeat(64))).toBeNull();
    expect(findApprovedSource("")).toBeNull();
    expect(findApprovedSource("not-a-digest")).toBeNull();
  });

  it("keeps every digest unique", () => {
    const digests = APPROVED_SOURCES.map((source) => source.sha256);
    expect(new Set(digests).size).toBe(digests.length);
  });
});
