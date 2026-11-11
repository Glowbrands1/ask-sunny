import { afterEach, describe, expect, it, vi } from "vitest";

import type { FormDocument } from "./document";
import { blankPolicyFields } from "./policy-verification";

/** POLICY_GATE_NONBLOCKING_ENABLED (Gate's review, QA, 10 Nov 2026): which policy lines are blank. Empty with the flag off. */
const DOC = {
  paper: "letter",
  blocks: [
    { kind: "field", field: { key: "observation", label: "Observation of Offense", type: "textarea" } },
    { kind: "field", field: { key: "policy_language", label: "Direct policy", type: "textarea", policyGrounded: true } },
    { kind: "field", field: { key: "policy_ref", label: "Policy reference", type: "text", policyGrounded: true } },
  ],
} as unknown as FormDocument;

afterEach(() => vi.unstubAllEnvs());

describe("blankPolicyFields", () => {
  const values = [
    { fieldKey: "policy_language", value: "  ", provenance: null },
    { fieldKey: "policy_ref", value: "Attendance, p.14", provenance: null },
  ];

  it("off: none", () => {
    expect(blankPolicyFields(DOC, null, values as never)).toEqual([]);
  });

  it("on: the blank, unverified policy line only", () => {
    vi.stubEnv("POLICY_GATE_NONBLOCKING_ENABLED", "1");
    expect(blankPolicyFields(DOC, null, values as never).map((field) => field.key)).toEqual(["policy_language"]);
  });
});
