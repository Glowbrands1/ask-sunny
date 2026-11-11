import { afterEach, describe, expect, it } from "vitest";

import { containsPlaceholder, stripPlaceholdersFromDraft } from "./drafted-text";

/**
 * FORM_PLACEHOLDER_WORDS_ENABLED (master plan step 5, 3 Nov 2026): "TBD" and
 * its kin are placeholders like "[Follow-Up Date]". Pass, as the plan states
 * it: no placeholder values on the form, and no other sentence lost.
 */

const FLAG = "FORM_PLACEHOLDER_WORDS_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

const DRAFT = {
  coaching_details:
    "Observed:\nAvery left the opening checklist unfinished on 10/20. Follow-up date: TBD.\n\nExpectation:\nThe checklist is finished before the doors open.",
  next_follow_up: "TBD",
  additional_coaching: "Reviewed the checklist together. Next review to be determined.",
  payroll_deduct_amount: "N/A",
  prior_actions: "N/A",
  specific_evidence: "N/A",
  employee_job_title: "Tanning Consultant",
};

describe("placeholder words", () => {
  it("off: today's guard — the words stay", () => {
    const result = stripPlaceholdersFromDraft(DRAFT);
    expect(result.values).toEqual(DRAFT);
    expect(result.emptied).toEqual([]);
  });

  it("on: the sentence carrying one is left out; every other sentence is kept", () => {
    process.env[FLAG] = "true";
    const result = stripPlaceholdersFromDraft(DRAFT);
    expect(result.values.coaching_details).toBe(
      "Observed:\nAvery left the opening checklist unfinished on 10/20.\n\nExpectation:\nThe checklist is finished before the doors open.",
    );
    expect(result.values.additional_coaching).toBe("Reviewed the checklist together.");
    expect(result.cleaned.sort()).toEqual(["additional_coaching", "coaching_details", "next_follow_up", "specific_evidence"]);
  });

  it("on: a field that was only a placeholder is left empty, for the manager", () => {
    process.env[FLAG] = "true";
    const result = stripPlaceholdersFromDraft(DRAFT);
    expect(result.values).not.toHaveProperty("next_follow_up");
    expect(result.emptied.sort()).toEqual(["next_follow_up", "specific_evidence"]);
  });

  it("on: \"N/A\" as a whole field the model wrote is a placeholder — but never on a payroll or prior-actions field, and never inside a sentence", () => {
    process.env[FLAG] = "true";
    const result = stripPlaceholdersFromDraft(DRAFT);
    expect(result.values).not.toHaveProperty("specific_evidence");
    expect(result.values.payroll_deduct_amount).toBe("N/A");
    expect(result.values.prior_actions).toBe("N/A");
    expect(containsPlaceholder("Payroll deduct: N/A.")).toBe(false);
  });

  it("on: whole words only, any case", () => {
    process.env[FLAG] = "true";
    for (const text of ["Date: tbd.", "Start TBA.", "Location TBC", "Time to be confirmed."]) expect(containsPlaceholder(text), text).toBe(true);
    for (const text of ["She signed the TBDS form.", "Avery Tbdale was late.", "It will be determined by the manager."]) {
      expect(containsPlaceholder(text), text).toBe(false);
    }
  });
});
