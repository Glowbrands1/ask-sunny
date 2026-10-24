import { describe, expect, it } from "vitest";

import {
  ACTION_PLAN_SOURCE,
  actionPlanProvenance,
  citedPolicyNames,
  correctiveActionPlan,
  fixedActionPlanKey,
  hasFixedActionPlan,
  planPayrollAmount,
  policyNamesFromViolated,
  policyPhrase,
  refreshedActionPlan,
} from "./ca-action-plan";
import { parseFormDocument } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import { CA_ACTION_PLAN_CLOSING, CA_ACTION_PLAN_CLOSING_REVISION_5 } from "./required-closing";

/**
 * District Manager feedback, 21 Oct 2026: "action plan adds unnecessary
 * language - should only have 2 sentences: management will review (policy
 * name) with employee; and Future policy violations may result in additional
 * corrective action up to and including termination of employment."
 * Synthetic names.
 */

const CLOSING = CA_ACTION_PLAN_CLOSING;
const NO_PAYROLL = { answer: null, amount: null } as const;

const plan = (overrides: Partial<Parameters<typeof correctiveActionPlan>[0]> = {}) =>
  correctiveActionPlan({ citedPolicies: [], employeeName: "Pat Rivera", payroll: NO_PAYROLL, ...overrides });

describe("the Action Plan, in the District Manager's two sentences", () => {
  it("names the one section Direct policy cites", () => {
    expect(plan({ citedPolicies: ["Visitors in the Workplace"] })).toBe(
      `Management will review the Visitors in the Workplace policy with Pat. ${CLOSING}`,
    );
  });

  it("joins two sections naturally, in the order cited", () => {
    expect(plan({ citedPolicies: ["Late Opening", "Attendance"] })).toBe(
      `Management will review the Late Opening and Attendance policies with Pat. ${CLOSING}`,
    );
  });

  it("joins three the same way", () => {
    expect(plan({ citedPolicies: ["Late Opening", "Attendance", "Standards of Conduct"] })).toBe(
      `Management will review the Late Opening, Attendance and Standards of Conduct policies with Pat. ${CLOSING}`,
    );
  });

  it("states the manager's amount between the two when payroll deduct is Yes", () => {
    expect(plan({ citedPolicies: ["Standards of Conduct"], payroll: { answer: "yes", amount: "$3.25" } })).toBe(
      `Management will review the Standards of Conduct policy with Pat. $3.25 will be deducted from Pat's pay. ${CLOSING}`,
    );
  });

  it("says a deduction applies, with no figure, when Yes came without an amount", () => {
    expect(plan({ citedPolicies: ["Standards of Conduct"], payroll: { answer: "yes", amount: null } })).toBe(
      `Management will review the Standards of Conduct policy with Pat. A payroll deduction applies. ${CLOSING}`,
    );
  });

  it("says nothing about pay on No", () => {
    expect(plan({ citedPolicies: ["Attendance"], payroll: { answer: "no", amount: "$3.25" } })).toBe(
      `Management will review the Attendance policy with Pat. ${CLOSING}`,
    );
  });

  it("falls back to what Policy Violated names when no section was cited", () => {
    expect(plan({ policyViolated: "Tardiness/Leaving Early" })).toBe(
      `Management will review the Tardiness/Leaving Early policy with Pat. ${CLOSING}`,
    );
    expect(plan({ policyViolated: "Violation of Company Policies — Visitors in the Workplace" })).toBe(
      `Management will review the Visitors in the Workplace policy with Pat. ${CLOSING}`,
    );
    expect(plan({ policyViolated: "Dress Code Violation" })).toBe(
      `Management will review the Dress Code policy with Pat. ${CLOSING}`,
    );
  });

  it("names the applicable company policy when nothing names one", () => {
    expect(plan()).toBe(`Management will review the applicable company policy with Pat. ${CLOSING}`);
    expect(plan({ policyViolated: "Violation of Company Policies" })).toBe(
      `Management will review the applicable company policy with Pat. ${CLOSING}`,
    );
  });

  it("prefers the cited section to Policy Violated", () => {
    expect(plan({ citedPolicies: ["Late Opening"], policyViolated: "Tardiness/Leaving Early" })).toMatch(
      /^Management will review the Late Opening policy with Pat\./,
    );
  });

  it("never says 'policy' twice, and uses the first name as the form prints it", () => {
    expect(plan({ citedPolicies: ["Cell Phone Policy"], employeeName: "harper samples" })).toBe(
      `Management will review the Cell Phone policy with Harper. ${CLOSING}`,
    );
    expect(plan({ citedPolicies: ["Attendance"], employeeName: "" })).toBe(
      `Management will review the Attendance policy with the employee. ${CLOSING}`,
    );
  });

  it("ends with the version's own closing — revision 5's on a form filed on it", () => {
    expect(plan({ citedPolicies: ["Attendance"], closing: CA_ACTION_PLAN_CLOSING_REVISION_5 })).toBe(
      `Management will review the Attendance policy with Pat. ${CA_ACTION_PLAN_CLOSING_REVISION_5}`,
    );
  });
});

describe("the pieces", () => {
  it("reads the sections off a verified manual citation only", () => {
    const verified = {
      verified: true,
      source: "official_policy_manual",
      sections: [{ locator: "Late Opening" }, { locator: "Attendance" }, { locator: "late opening" }],
    };
    expect(citedPolicyNames(verified)).toEqual(["Late Opening", "Attendance"]);
    expect(citedPolicyNames({ ...verified, verified: false })).toEqual([]);
    expect(citedPolicyNames({ grounded: true, sources: [{ locator: "Appearance Standards, Section 3.2" }] })).toEqual([]);
    expect(citedPolicyNames(null)).toEqual([]);
  });

  it("reads several offense labels from one Policy Violated line", () => {
    expect(policyNamesFromViolated("Tardiness/Leaving Early, Absenteeism")).toEqual(["Tardiness/Leaving Early", "Absenteeism"]);
    expect(policyNamesFromViolated("")).toEqual([]);
    /* A section named beside its box is the policy (District Manager feedback, 21 Oct 2026). */
    expect(policyNamesFromViolated("Tardiness/Leaving Early — Late Opening")).toEqual(["Late Opening"]);
    expect(policyNamesFromViolated("Violation of Company Policies — Cell Phone/Smart Watch Policy")).toEqual([
      "Cell Phone/Smart Watch Policy",
    ]);
    expect(policyPhrase(policyNamesFromViolated("Violation of Company Policies — Cell Phone/Smart Watch Policy"))).toBe(
      "the Cell Phone/Smart Watch policy",
    );
  });

  it("phrases the names", () => {
    expect(policyPhrase([])).toBe("the applicable company policy");
    expect(policyPhrase(["the Attendance policy"])).toBe("the Attendance policy");
  });

  it("is the Corrective Action Form's alone", () => {
    expect(hasFixedActionPlan("dpoa")).toBe(true);
    expect(hasFixedActionPlan("policy-review")).toBe(false);
    const review = TEMPLATE_SEEDS.find((seed) => seed.key === "policy-review")!;
    expect(fixedActionPlanKey("policy-review", parseFormDocument(review.document), null)).toBeNull();
  });

  it("records what the plan was built from", () => {
    expect(
      actionPlanProvenance({ citedPolicies: ["Attendance"], employeeName: "Pat", payroll: { answer: "yes", amount: "$3.25" } }),
    ).toEqual({ source: ACTION_PLAN_SOURCE, policySource: "direct_policy", policies: ["Attendance"], payroll: "$3.25" });
    expect(
      actionPlanProvenance({ citedPolicies: [], policyViolated: "Absenteeism", employeeName: "Pat", payroll: NO_PAYROLL }),
    ).toMatchObject({ policySource: "policy_violated", policies: ["Absenteeism"], payroll: null });
  });
});

describe("rebuilding the plan after a change in chat", () => {
  const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "dpoa")!;
  const document = parseFormDocument(seed.document);
  const built = `Management will review the Attendance policy with Pat. ${CLOSING}`;
  const cited = (...headings: string[]) => ({
    fieldKey: "policy_language",
    value: "Quoted from the manual.",
    checked: [],
    filledBy: "ai",
    provenance: { verified: true, source: "official_policy_manual", sections: headings.map((locator) => ({ locator })) },
  });
  const planRow = (value: string, filledBy = "ai", provenance: Record<string, unknown> = { source: ACTION_PLAN_SOURCE }) => ({
    fieldKey: "action_plan",
    value,
    checked: [],
    filledBy,
    provenance,
  });
  const refresh = (values: Parameters<typeof refreshedActionPlan>[0]["values"], notes?: string, templateKey = "dpoa") =>
    refreshedActionPlan({ templateKey, document, variantKey: null, employeeName: "Pat Rivera", values, notes });

  it("follows Direct policy when a section is added", () => {
    expect(refresh([planRow(built), cited("Attendance", "Late Opening")])).toMatchObject({
      key: "action_plan",
      value: `Management will review the Attendance and Late Opening policies with Pat. ${CLOSING}`,
      provenance: { source: ACTION_PLAN_SOURCE, policies: ["Attendance", "Late Opening"] },
    });
  });

  it("adds the deduction on Yes, keeping the amount it already stated", () => {
    const withAmount = `Management will review the Attendance policy with Pat. $3.25 will be deducted from Pat's pay. ${CLOSING}`;
    const yes = { fieldKey: "payroll_deduct", value: null, checked: ["yes"], filledBy: "manager" };
    expect(refresh([planRow(withAmount), cited("Attendance"), yes])).toBeNull();
    expect(refresh([planRow(built), cited("Attendance"), yes], "payroll deduct of $4.10 is applicable")?.value).toBe(
      `Management will review the Attendance policy with Pat. $4.10 will be deducted from Pat's pay. ${CLOSING}`,
    );
  });

  it("on a Yes with no amount stated, states the one amount the quoted section gives, and follows the section", () => {
    const yes = { fieldKey: "payroll_deduct", value: null, checked: ["yes"], filledBy: "manager" };
    const lateOpening = {
      ...cited("Late Opening", "Attendance"),
      value: "The employee will reimburse The Company $25.00 via payroll deduction.\n\nSource: JBA Policy Manual — Late Opening, p. 15",
    };
    const next = refresh([planRow(built), lateOpening, yes]);
    expect(next?.value).toBe(
      `Management will review the Late Opening and Attendance policies with Pat. $25.00 will be deducted from Pat's pay. ${CLOSING}`,
    );
    expect(next?.provenance).toMatchObject({ payroll: "$25.00", payrollAmountFrom: "manual" });

    /* Late Opening no longer quoted: the manual's figure goes with it. */
    const fromManual = planRow(next!.value, "ai", next!.provenance);
    expect(refresh([fromManual, cited("Attendance"), yes])?.value).toBe(
      `Management will review the Attendance policy with Pat. A payroll deduction applies. ${CLOSING}`,
    );
    /* The manager's amount always wins, and is kept when the section goes. */
    const stated = refresh([fromManual, lateOpening, yes], "$10 will be payroll deducted");
    expect(stated?.value).toBe(
      `Management will review the Late Opening and Attendance policies with Pat. $10 will be deducted from Pat's pay. ${CLOSING}`,
    );
    expect(stated?.provenance).not.toHaveProperty("payrollAmountFrom");
    expect(refresh([planRow(stated!.value, "ai", stated!.provenance), cited("Attendance"), yes])?.value).toBe(
      `Management will review the Attendance policy with Pat. $10 will be deducted from Pat's pay. ${CLOSING}`,
    );
    /* A Direct policy line not quoted from the manual gives no amount. */
    expect(refresh([planRow(built), { ...lateOpening, provenance: { verified: false } }, yes])?.value).toBe(
      `Management will review the applicable company policy with Pat. A payroll deduction applies. ${CLOSING}`,
    );
    /* On No, nothing about pay. */
    const no = { ...yes, checked: ["no"] };
    expect(refresh([planRow(built), lateOpening, no])?.value).toBe(
      `Management will review the Late Opening and Attendance policies with Pat. ${CLOSING}`,
    );
  });

  it("leaves a plan a person wrote, or one it did not build, alone", () => {
    expect(refresh([planRow("Pat will set two alarms.", "manager"), cited("Late Opening")])).toBeNull();
    expect(refresh([planRow("Pat will set two alarms.", "ai", {}), cited("Late Opening")])).toBeNull();
    expect(refresh([cited("Late Opening")])).toBeNull();
  });

  it("does nothing on another form, or when the plan already reads right", () => {
    expect(refresh([planRow(built), cited("Attendance")])).toBeNull();
    expect(refresh([planRow(built), cited("Late Opening")], undefined, "policy-review")).toBeNull();
  });
});

describe("a form filed on revision 5 keeps revision 5's closing", () => {
  const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "dpoa")!;
  /** Revision 5 as a form filed on it holds the version: the same Action Plan, the older closing. */
  const revision5 = parseFormDocument({
    ...seed.document,
    blocks: (seed.document as { blocks: Record<string, unknown>[] }).blocks.map((block) => {
      const field = block.field as Record<string, unknown> | undefined;
      return field?.key === "action_plan"
        ? { ...block, field: { ...field, requiredClosing: CA_ACTION_PLAN_CLOSING_REVISION_5 } }
        : block;
    }),
  });
  const cited = (...headings: string[]) => ({
    fieldKey: "policy_language",
    value: "Quoted from the manual.",
    checked: [],
    filledBy: "ai",
    provenance: { verified: true, source: "official_policy_manual", sections: headings.map((locator) => ({ locator })) },
  });

  it("reads the version's own closing", () => {
    expect(fixedActionPlanKey("dpoa", revision5, null)).toEqual({ key: "action_plan", closing: CA_ACTION_PLAN_CLOSING_REVISION_5 });
    expect(fixedActionPlanKey("dpoa", parseFormDocument(seed.document), null)).toEqual({
      key: "action_plan",
      closing: CA_ACTION_PLAN_CLOSING,
    });
  });

  it("rebuilds a plan on that version with that version's words, once", () => {
    const built = `Management will review the Attendance policy with Pat. ${CA_ACTION_PLAN_CLOSING_REVISION_5}`;
    const next = refreshedActionPlan({
      templateKey: "dpoa",
      document: revision5,
      variantKey: null,
      employeeName: "Pat Rivera",
      values: [
        { fieldKey: "action_plan", value: built, checked: [], filledBy: "ai", provenance: { source: ACTION_PLAN_SOURCE } },
        cited("Attendance", "Late Opening"),
      ],
    });
    expect(next?.value).toBe(
      `Management will review the Attendance and Late Opening policies with Pat. ${CA_ACTION_PLAN_CLOSING_REVISION_5}`,
    );
    expect(next?.value).not.toContain("may result in");
  });

  it("carried onto the current version, is rebuilt with the new closing in place of the old, never both", () => {
    const filed = `Management will review the Attendance policy with Pat. ${CA_ACTION_PLAN_CLOSING_REVISION_5}`;
    const next = refreshedActionPlan({
      templateKey: "dpoa",
      document: parseFormDocument(seed.document),
      variantKey: null,
      employeeName: "Pat Rivera",
      values: [
        { fieldKey: "action_plan", value: filed, checked: [], filledBy: "ai", provenance: { source: ACTION_PLAN_SOURCE } },
        cited("Attendance"),
      ],
    });
    expect(next?.value).toBe(`Management will review the Attendance policy with Pat. ${CA_ACTION_PLAN_CLOSING}`);
    expect(next!.value.match(/Future policy violations/g)).toHaveLength(1);
  });
});

describe("planPayrollAmount — whose amount the plan states", () => {
  const QUOTED = "The employee will reimburse The Company $25.00 via payroll deduction.";

  it("the manager's, always; otherwise, on a Yes, the quoted section's; otherwise none", () => {
    expect(planPayrollAmount({ answer: "yes", stated: "$10", quotedPolicy: QUOTED })).toEqual({ amount: "$10", amountFrom: "manager" });
    expect(planPayrollAmount({ answer: "yes", stated: null, quotedPolicy: QUOTED })).toEqual({ amount: "$25.00", amountFrom: "manual" });
    expect(planPayrollAmount({ answer: "no", stated: null, quotedPolicy: QUOTED })).toEqual({ amount: null });
    expect(planPayrollAmount({ answer: "yes", stated: null, quotedPolicy: null })).toEqual({ amount: null });
  });

  it("does not take $25 from the policy text when only the manager's amount is allowed", () => {
    process.env.MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED = "1";
    try {
      expect(planPayrollAmount({ answer: "yes", stated: "$10", quotedPolicy: QUOTED })).toEqual({
        amount: "$10",
        amountFrom: "manager",
      });
      expect(planPayrollAmount({ answer: "yes", stated: null, quotedPolicy: QUOTED })).toEqual({ amount: null });
    } finally {
      delete process.env.MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED;
    }
  });
});

describe("the payroll sentence stays off the action_plan field when the two-sentence flag is on", () => {
  const yes = { answer: "yes" as const, amount: "$25" };

  it("is the review sentence and the closing, and self-check accepts nothing else", async () => {
    const { reviewOutgoing } = await import("@/lib/ai/self-check");
    const three = correctiveActionPlan({ citedPolicies: ["Late Opening"], employeeName: "S.", payroll: yes });
    expect(three).toMatch(/\$25 will be deducted/);
    expect(reviewOutgoing({ content: three, employeeName: "S.", actionPlan: three, chunks: [], roster: [] }).map((failure) => failure.kind)).toEqual([
      "action_plan",
    ]);

    process.env.ACTION_PLAN_SENTENCES_ENABLED = "1";
    try {
      const two = correctiveActionPlan({ citedPolicies: ["Late Opening"], employeeName: "S.", payroll: yes });
      expect(two).toBe(
        `Management will review the Late Opening policy with S. ${CLOSING}`,
      );
      expect(two).not.toMatch(/payroll deduction|deducted|\$25/i);
      expect(reviewOutgoing({ content: two, employeeName: "S.", actionPlan: two, chunks: [], roster: [] })).toEqual([]);
    } finally {
      delete process.env.ACTION_PLAN_SENTENCES_ENABLED;
    }
  });
});
