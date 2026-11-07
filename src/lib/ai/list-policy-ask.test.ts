import { afterEach, describe, expect, it, vi } from "vitest";

import { asksOnlyToListPolicy, listPolicyIsEdit } from "./list-policy-ask";

/** LIST_POLICY_IS_EDIT_ENABLED (QA, 8 Nov 2026). */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("asksOnlyToListPolicy", () => {
  it.each([
    "please list the policy",
    "please list the policy.",
    "list the policy",
    "add the policy",
    "can you list the policy",
    "can you list the policy?",
    "could you please add the policy to the form",
    "list the policy on the draft please",
    "include the policy too",
  ])("%s → an edit", (question) => {
    expect(asksOnlyToListPolicy(question)).toBe(true);
  });

  it.each([
    "what policy covers lateness?",
    "does attendance fall under standards of conduct?",
    "which policy should I list?",
    "I need you to make it about showing up late and please list the policy make the date for 10/14/26.",
    "list the attendance policy and the dress code",
    "policy",
  ])("%s → not only a list-the-policy ask", (question) => {
    expect(asksOnlyToListPolicy(question)).toBe(false);
  });
});

describe("listPolicyIsEdit", () => {
  it("off: false", () => {
    expect(listPolicyIsEdit("please list the policy", true)).toBe(false);
  });
  it("on, a form open: true; no form open: false", () => {
    vi.stubEnv("LIST_POLICY_IS_EDIT_ENABLED", "true");
    expect(listPolicyIsEdit("please list the policy", true)).toBe(true);
    expect(listPolicyIsEdit("please list the policy", false)).toBe(false);
  });
});
