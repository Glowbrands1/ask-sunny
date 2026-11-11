import { describe, expect, it } from "vitest";

import { openFormRule } from "./prompts";
import type { OpenFormSummary } from "./types";

/**
 * POLICY_GATE_NONBLOCKING_ENABLED, Gate's review (QA, 10 Nov 2026): with the flag on, a draft Corrective Action whose
 * Direct policy is blank was described to the model as "Its policy lines, where it has any, were quoted from the
 * official manual.", which invites "yes, it's verified". A blank policy line is said to be blank and not checked.
 * The summary carries `blankPolicy` only with the flag on (`forms/open-form-summary.ts`, `blankPolicyFields`).
 */
const DRAFT: OpenFormSummary = {
  templateName: "Corrective Action Form",
  employeeName: "Marnie Holloway",
  status: "draft",
  lines: [{ label: "Observation of Offense", value: "She opened the salon 40 minutes late on 11/3/26." }],
  unverifiedPolicy: [],
};

describe("the open-form rule for a draft with a blank Direct policy", () => {
  it("off (no blankPolicy): unchanged, the policy lines 'were quoted from the official manual'", () => {
    expect(openFormRule(DRAFT)).toContain("Its policy lines, where it has any, were quoted from the official manual.");
  });

  it("on: the blank line is named as blank and not checked; never 'quoted from the official manual'", () => {
    const rule = openFormRule({ ...DRAFT, blankPolicy: ["Direct policy"] });
    expect(rule).not.toContain("were quoted from the official manual");
    expect(rule).toContain("Blank, so nothing on it was checked against the official manual (never say it is verified): Direct policy.");
  });

  it("on: a typed unverified line and a blank one are both said", () => {
    const rule = openFormRule({ ...DRAFT, unverifiedPolicy: ["Policy reference"], blankPolicy: ["Direct policy"] });
    expect(rule).toContain("Not yet checked against the official manual: Policy reference.");
    expect(rule).toContain("never say it is verified): Direct policy.");
  });
});
