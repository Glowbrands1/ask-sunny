import { afterEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, readCaPolicy, statedOffenseKeys } from "./ca-policy";

/* POLICY_LINE_COVERS_EVERY_SECTION_ENABLED (QA's two-offense Create check, 13 Nov 2026; Coding-2's probe wording). */
const DESCRIBED = "create ca form for nell orrin, she was late on 11/3/26 and yelled at a customer. verbal. no payroll deduct.";
const NAMED = "create ca form for nell orrin for violating the attendance policy and standards of conduct, she was late on 11/3/26 and yelled at a customer.";

describe("POLICY_LINE_COVERS_EVERY_SECTION_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the conduct beside the lateness is not read (as before)", () => {
    expect(readCaPolicy(DESCRIBED).alsoDescribed).toBeUndefined();
  });

  it("on: lateness and \"yelled at a customer\" read as Attendance and the Standards of Conduct", () => {
    vi.stubEnv("POLICY_LINE_COVERS_EVERY_SECTION_ENABLED", "true");
    const reading = readCaPolicy(DESCRIBED);
    expect(reading.alsoDescribed?.phrase).toMatch(/yelled at a customer/);
    const keys = statedOffenseKeys(reading, DESCRIBED) ?? [];
    expect(keys).toContain("standards_of_conduct");
    expect(keys.some((key) => /tardiness|attendance_policy/.test(key))).toBe(true);
  });

  it.each([
    "create ca form for nell orrin, she was late on 11/3/26 but was not rude about it",
    "create ca form for nell orrin, she yelled at a customer",
    "create ca form for nell orrin for violating standards of conduct, she was late and yelled at a customer",
  ])("on: no second offense is added: %s", (text) => {
    vi.stubEnv("POLICY_LINE_COVERS_EVERY_SECTION_ENABLED", "true");
    expect(readCaPolicy(text).alsoDescribed).toBeUndefined();
  });

  it("on, with NAMED_POLICIES_ALL_KEPT: the card line names both named policies", () => {
    vi.stubEnv("POLICY_LINE_COVERS_EVERY_SECTION_ENABLED", "true");
    vi.stubEnv("NAMED_POLICIES_ALL_KEPT_ENABLED", "true");
    expect(caPolicyProposalLine(readCaPolicy(NAMED))).toBe("**Policy:** Attendance and Standards of Conduct, as you said. I'll quote each section from the current policy manual on the draft.");
  });
});
