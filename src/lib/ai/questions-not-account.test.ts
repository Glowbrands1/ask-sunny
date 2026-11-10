import { afterEach, describe, expect, it, vi } from "vitest";

import { withoutQuestionsToTheApp } from "./remap-incident";

/**
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's Sunny round-6 solo gate, 8 Nov 2026): a question to the app is never the
 * offense account. The production conversation's turns (nov8-kept-request-same-form, its invented person).
 */
describe("withoutQuestionsToTheApp", () => {
  afterEach(() => vi.unstubAllEnvs());

  const QUESTIONS = ["what does the manual say about reimbursing the company?", "how much is the late opening fee?", "and who pays for client restitution?"];

  it("off (as before): every turn is as typed", () => {
    vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "");
    for (const turn of [...QUESTIONS, "I have independently verified and the policy is correct", "ok thanks", "Late Opening from the policy manual."]) expect(withoutQuestionsToTheApp(turn)).toBe(turn);
  });

  it("on: questions to the app, a confirmation of the policy and a closing thanks are left out", () => {
    vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true");
    for (const turn of [
      ...QUESTIONS,
      "what does the manual say about reimbursing the company",
      "I have independently verified and the policy is correct",
      "ok thanks",
      "Thank you!",
      // QA (8 Nov 2026): only names a policy or its source.
      "Late Opening from the policy manual.",
      "per the manual",
      "the policy is Attendance",
      "create corrective action for Briar Castellane for Late Opening from the policy manual.",
    ]) {
      expect(withoutQuestionsToTheApp(turn), turn).toBe("");
    }
  });

  it("on: an account stays, word for word, also beside a question", () => {
    vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true");
    expect(withoutQuestionsToTheApp("she opened the salon 40 minutes late on 11/2")).toBe("she opened the salon 40 minutes late on 11/2");
    expect(withoutQuestionsToTheApp("she was rude to a guest at the front desk. is that a verbal?")).toBe("she was rude to a guest at the front desk.");
    expect(withoutQuestionsToTheApp("who pays was never discussed with her but she broke the bed")).toBe("who pays was never discussed with her but she broke the bed");
    // An account that also names a policy stays (QA, 8 Nov 2026).
    expect(withoutQuestionsToTheApp("she opened late again, Late Opening policy")).toBe("she opened late again, Late Opening policy");
    expect(withoutQuestionsToTheApp("create a corrective action for Briar Castellane, she opened late again on 11/2, Late Opening policy")).toBe(
      "create a corrective action for Briar Castellane, she opened late again on 11/2, Late Opening policy",
    );
    expect(withoutQuestionsToTheApp("the salon was opened 30 minutes late per the manual's opening time")).toBe("the salon was opened 30 minutes late per the manual's opening time");
  });

  /*
   * QA's round-7 gate (8 Nov 2026, gate runner 2): the filter split and rejoined every turn, so the app's own state lines
   * ("The employee is …. Job title: …. It happened at …. Policy reference: …") were no longer stripped by shape, and the
   * Observation read "It happened. Policy reference: Attend…" for "also create a ca for rowan kestrel, he was late on
   * 10/20". A turn is left as it is but for the sentences that ask the app something; its lines and state lines stay.
   */
  it("on: a turn carrying the app's state lines is left exactly as it is (round-7 gate)", () => {
    vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true");
    const turn =
      "The employee is Rowan Kestrel. Job title: Tanning Consultant. It happened at NE Kearney. Policy reference: Attendance, JBA Policy Manual p.14.\nalso create a ca for rowan kestrel, he was late on 10/20";
    expect(withoutQuestionsToTheApp(turn)).toBe(turn);
    expect(withoutQuestionsToTheApp("add that she was also on her phone")).toBe("add that she was also on her phone");
    expect(withoutQuestionsToTheApp("change observation of offense to: she left the salon unattended at 3pm")).toBe(
      "change observation of offense to: she left the salon unattended at 3pm",
    );
    expect(withoutQuestionsToTheApp("create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct.")).toBe(
      "create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct.",
    );
  });

  it("on: a question inside a turn is taken out, the other lines are kept as typed", () => {
    vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true");
    expect(withoutQuestionsToTheApp("she was late on 11/2\nhow much is the late opening fee?\nshe also left early")).toBe("she was late on 11/2\n\nshe also left early");
  });
});
