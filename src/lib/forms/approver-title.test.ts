import { afterEach, describe, expect, it, vi } from "vitest";

import { withoutApproverClauses } from "./approver-title";
import { extractJobTitle } from "./proposal";

/* APPROVER_TITLE_NOT_EMPLOYEE_ENABLED (QA's r37 live check, 12 Nov 2026; names invented). */
const titleOf = (text: string) => extractJobTitle(withoutApproverClauses(text));

describe("APPROVER_TITLE_NOT_EMPLOYEE", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "CA for Odalys Pemberley, probably termination once the DM approves",
    "CA for Odalys Pemberley, termination after my district manager signs off",
    "CA for Odalys Pemberley, pending the DM's approval",
    "CA for Odalys Pemberley, waiting on the DM",
    "CA for Odalys Pemberley, needs DM approval",
  ])("on: %j states no title for the employee", (text) => {
    vi.stubEnv("APPROVER_TITLE_NOT_EMPLOYEE_ENABLED", "true");
    expect(titleOf(text)).toBeNull();
  });

  it("on: a title stated for her stays", () => {
    vi.stubEnv("APPROVER_TITLE_NOT_EMPLOYEE_ENABLED", "true");
    expect(titleOf("CA for Odalys Pemberley, she is a district manager, she missed the meeting")).toBe("District Manager");
    expect(titleOf("CA for Odalys Pemberley, our TC, termination once the DM approves")).toBe("Tanning Consultant");
  });

  it("off: the text as given", () => {
    vi.stubEnv("APPROVER_TITLE_NOT_EMPLOYEE_ENABLED", "");
    expect(titleOf("CA for Odalys Pemberley, probably termination once the DM approves")).toBe("District Manager");
  });
});
