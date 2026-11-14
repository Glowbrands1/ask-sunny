import { afterEach, describe, expect, it, vi } from "vitest";

import { policyFieldsWithCitation } from "./required-policy-citation";

/* OTHER_BESIDE_DESCRIBED_ENABLED (Gate-Sunny-3's #971 probe and QA's chain check, 14 Nov 2026). */
const SECTIONS = [{ heading: "Attendance", page: 14, chunkIndex: 1, foundBy: "heading" }] as never;
const write = (violated: string) =>
  policyFieldsWithCitation({ attendance: true, pageRequired: false, values: { policy_violated: violated }, sections: SECTIONS }).policy_violated;

describe("the Attendance citation in Policy Violated beside Other", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the citation is the whole field (as before)", () => {
    // Pinned off (Gate-Sunny-3 on #971): the off arm holds even when the flag is on in the env (production-flags.json).
    vi.stubEnv("OTHER_BESIDE_DESCRIBED_ENABLED", "");
    expect(write("Attendance Policy, Other")).toBe("Attendance Policy, JBA Policy Manual p.14");
  });

  it("on: only the Attendance label becomes the citation; Other and any other policy stay", () => {
    vi.stubEnv("OTHER_BESIDE_DESCRIBED_ENABLED", "true");
    expect(write("Attendance Policy, Other")).toBe("Attendance Policy, JBA Policy Manual p.14, Other");
    // With the two-offense chain on (NAMED_POLICIES_ALL_KEPT / POLICY_LINE_COVERS_EVERY_SECTION), a third policy is kept too.
    expect(write("Attendance Policy, Standards of Conduct, Other")).toBe("Attendance Policy, JBA Policy Manual p.14, Standards of Conduct, Other");
  });

  it("on, without Other: as before", () => {
    vi.stubEnv("OTHER_BESIDE_DESCRIBED_ENABLED", "true");
    expect(write("Attendance Policy")).toBe("Attendance Policy, JBA Policy Manual p.14");
  });
});
