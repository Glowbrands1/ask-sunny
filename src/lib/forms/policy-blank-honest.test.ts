import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskResponse, OpenFormSummary } from "@/lib/ai/types";
import { openFormRule } from "@/lib/ai/prompts";

import { asksPolicyChecked, withBlankPolicyHonesty } from "./policy-blank-honest";

/**
 * POLICY_BLANK_HONEST_REPLY_ENABLED. QA's live round-24 test (11 Nov 2026, conv_mwbbelez2wy6r5j; the person invented):
 * a CA draft named "Attendance Policy, JBA Policy Manual p.14" with its Direct policy field blank; "did you check the
 * policy on this form?" got "… That's the section quoted on <A>'s draft."; "is the policy verified?" got "Nothing on the
 * form has changed yet".
 */
const FLAG = "POLICY_BLANK_HONEST_REPLY_ENABLED";
const OPEN: OpenFormSummary = {
  templateName: "Corrective Action Form",
  employeeName: "Remy Calder",
  status: "draft",
  lines: [{ label: "Policy Violated", value: "Attendance Policy, JBA Policy Manual p.14" }],
  unverifiedPolicy: [],
  emptyPolicy: { labels: ["Direct policy from official manual"], policyNamed: "Attendance Policy, JBA Policy Manual p.14" },
};
const answer = (content: string): AskResponse => ({ content, citations: [], recommendedVideoIds: [] }) as unknown as AskResponse;
const Q1_SAID =
  "Yes — the policy on the form is the Attendance Policy, which I pulled from the current manual: it says it's the employee's responsibility to know their schedule and always be on time.\n\nThat's the section quoted on Remy's draft. If you want a different policy applied, tell me which one and I'll update the card.";

afterEach(() => vi.unstubAllEnvs());

describe("asksPolicyChecked", () => {
  it.each([
    "did you check the policy on this form?",
    "is the policy verified?",
    "Is the policy verified",
    "was the policy checked",
    "has the policy been verified?",
    "did you verify the direct policy?",
    "is it verified?",
    "IS THE POLICY CORRECT?",
  ])("a question: %s", (question) => expect(asksPolicyChecked(question)).toBe(true));

  it.each([
    "add the attendance policy",
    "check the policy for lateness and add it",
    "what does the attendance policy say?",
    "she was late again on 11/4",
  ])("not one: %s", (question) => expect(asksPolicyChecked(question)).toBe(false));
});

describe("withBlankPolicyHonesty", () => {
  it("off: the answer as given", () => {
    const given = answer(Q1_SAID);
    expect(withBlankPolicyHonesty(given, OPEN, "did you check the policy on this form?")).toEqual({ answer: given, handled: false });
  });

  it("on, 'did you check the policy on this form?': answered from the form, no quoted claim", () => {
    vi.stubEnv(FLAG, "true");
    const { answer: said, handled } = withBlankPolicyHonesty(answer(Q1_SAID), OPEN, "did you check the policy on this form?");
    expect(handled).toBe(true);
    expect(said.content).toBe(
      "No. The **Direct policy from official manual** field on Remy Calder's Corrective Action Form is empty, so nothing from the manual is quoted on it and nothing on it was checked. The form names **Attendance Policy, JBA Policy Manual p.14**, but its wording is not on the draft.\n\n" +
        'To have it quoted word for word, say "add the Attendance policy", or type it on the card and press **Save changes**.',
    );
  });

  it("on, any other answer: the quoted claim line goes, the truth is said", () => {
    vi.stubEnv(FLAG, "true");
    const { answer: said } = withBlankPolicyHonesty(answer("Here is the plan.\nThat's the section quoted on Remy's draft."), OPEN, "what should the action plan say");
    expect(said.content).not.toMatch(/section quoted/);
    expect(said.content).toMatch(/^Here is the plan\.\n\nThe \*\*Direct policy from official manual\*\* field on the draft is empty/);
  });

  it("on, a filled policy (no emptyPolicy) or a finalized form: unchanged", () => {
    vi.stubEnv(FLAG, "true");
    const given = answer(Q1_SAID);
    const { emptyPolicy: _e, ...filled } = OPEN;
    void _e;
    expect(withBlankPolicyHonesty(given, filled, "is the policy verified?").handled).toBe(false);
    expect(withBlankPolicyHonesty(given, { ...OPEN, status: "finalized" }, "is the policy verified?").handled).toBe(false);
  });
});

describe("the open-form rule", () => {
  it("with emptyPolicy: says the field is EMPTY and names the policy; never 'quoted from the official manual'", () => {
    const rule = openFormRule(OPEN);
    expect(rule).toContain("The Direct policy from official manual field on this draft is EMPTY: nothing from the manual is quoted on it; the policy the form only names is Attendance Policy, JBA Policy Manual p.14.");
    expect(rule).not.toContain("were quoted from the official manual");
  });

  it("without it (flag off): unchanged", () => {
    const { emptyPolicy: _e, ...off } = OPEN;
    void _e;
    expect(openFormRule(off)).toContain("Its policy lines, where it has any, were quoted from the official manual.");
  });
});
