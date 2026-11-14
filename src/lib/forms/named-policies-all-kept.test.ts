import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy, statedOffenseKeys } from "./ca-policy";

/*
 * NAMED_POLICIES_ALL_KEPT_ENABLED (QA's two-offense Create check, 13 Nov 2026; Coding-2's probe wording): policies named
 * together in one list are all kept; a later name that corrects an earlier one still wins alone.
 */
const BOTH = "create ca form for nell orrin for violating the attendance policy and standards of conduct, she was late on 11/3/26 and yelled at a customer. verbal. no payroll deduct.";

function keys(text: string) {
  const reading = readCaPolicy(text);
  return { stated: reading.stated, also: reading.alsoStated ?? [], keys: statedOffenseKeys(reading, text) ?? [] };
}

describe("NAMED_POLICIES_ALL_KEPT_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: only the last policy named is kept (as before)", () => {
    const read = keys(BOTH);
    expect(read.stated).toBe("standards_of_conduct");
    expect(read.also).toEqual([]);
    expect(read.keys).toEqual(["standards_of_conduct"]);
  });

  it("on: QA's two-offense request keeps both the Attendance and the Standards of Conduct", () => {
    vi.stubEnv("NAMED_POLICIES_ALL_KEPT_ENABLED", "true");
    const read = keys(BOTH);
    expect(read.stated).toBe("standards_of_conduct");
    expect(read.also).toEqual(["attendance"]);
    expect(read.keys).toContain("standards_of_conduct");
    expect(read.keys.some((key) => /tard|attend|absent/.test(key))).toBe(true);
  });

  it.each([
    "write up nell for the standards of conduct and attendance policies, she was late and rude",
    "ca for nell orrin, violating the dress code, attendance and standards of conduct policies",
    "ca for nell orrin for violating the attendance policy as well as the standards of conduct",
  ])("on: a list of names keeps every one: %s", (text) => {
    vi.stubEnv("NAMED_POLICIES_ALL_KEPT_ENABLED", "true");
    expect(keys(text).also.length).toBeGreaterThan(0);
  });

  it.each([
    "ca for nell orrin, not attendance, standards of conduct",
    "ca for nell orrin for the attendance policy. actually make it standards of conduct",
    "ca for nell orrin for violating standards of conduct, she was late",
  ])("on: a correction, or one name, keeps one policy: %s", (text) => {
    vi.stubEnv("NAMED_POLICIES_ALL_KEPT_ENABLED", "true");
    expect(keys(text).also).toEqual([]);
  });
});
