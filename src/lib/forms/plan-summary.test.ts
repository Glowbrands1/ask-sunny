import { describe, expect, it } from "vitest";

import { parseFormDocument, parseFormVariants } from "./document";
import { TEMPLATE_SEEDS } from "./library";
import { isReviewedWithEmployee, planSummary, type PlanSummaryInput } from "./plan-summary";

/**
 * ============================================================================
 * THE CLOSING SUMMARY CANNOT SAY ANYTHING THE FORM DOES NOT
 * ============================================================================
 *
 * The property under test is a NEGATIVE one, and it is the reason this module
 * exists as a pure function rather than as a second prompt: every phrase in
 * the sentence has to be present, verbatim, in the stored values or in an
 * option label the template declares. The last test in this file asserts that
 * directly — it takes the summary apart and looks for every content word on
 * the form.
 */

const seed = (key: string) => TEMPLATE_SEEDS.find((entry) => entry.key === key)!;
const SDIT = parseFormDocument(seed("sdit-epp").document);
const VARIANT = parseFormVariants(seed("sdit-epp").variants)[0]!;

function input(overrides: Partial<PlanSummaryInput> = {}): PlanSummaryInput {
  return {
    templateName: "SDIT EPP",
    employeeName: "Paulyne Co",
    document: SDIT,
    variantKey: VARIANT.key,
    values: {},
    checked: {},
    ...overrides,
  };
}

/** The values a drafted plan actually holds. */
const DRAFTED = {
  where_succeeding:
    "Paulyne consistently provides friendly, welcoming client interactions and maintains positive engagement that supports the client experience.",
  needs_improvement:
    "Paulyne needs to improve punctuality and consistently arrive ready to work at her scheduled shift start time.",
  top_strengths: "Client service and rapport with regulars\nPositive salon atmosphere",
  improvement_areas: "Punctuality\nProactive communication about scheduling conflicts",
  plan_of_action:
    "Paulyne and her manager will review scheduled start times and clock-in records each week during the review period. Management will monitor and coach as needed.",
};

/* ================================================================= shape == */

describe("the summary a manager reads after the plan is drafted", () => {
  it("names the focus, the strength and the plan, then what to do next", () => {
    expect(planSummary(input({ values: DRAFTED }))).toBe(
      "The SDIT EPP draft for Paulyne Co focuses on punctuality while continuing to build on client service and rapport with regulars. " +
        "The plan of action: Paulyne and her manager will review scheduled start times and clock-in records each week during the review period. " +
        "Review the SDIT EPP with Paulyne Co and download the PDF when you're ready. Leave the signature fields blank until you've had the review conversation.",
    );
  });

  it("prefers the short list over the paragraph, because a sentence inside a sentence is unreadable", () => {
    const summary = planSummary(input({ values: DRAFTED }))!;
    expect(summary).toContain("focuses on punctuality");
    expect(summary).not.toContain("consistently arrive ready to work");
  });

  it("falls back to the paragraph when the lists are empty", () => {
    const summary = planSummary(
      input({
        values: {
          where_succeeding: DRAFTED.where_succeeding,
          needs_improvement: DRAFTED.needs_improvement,
        },
      }),
    )!;
    expect(summary).toContain(
      "focuses on Paulyne needs to improve punctuality and consistently arrive ready to work at her scheduled shift start time",
    );
    // The employee's own name keeps its capital wherever it opens a clause.
    expect(summary).not.toContain("paulyne needs");
  });

  it("falls back to the expectations the manager marked", () => {
    const summary = planSummary(
      input({
        checked: {
          expectations_success: ["client_service"],
          expectations_improvement: ["company_policies"],
        },
      }),
    )!;
    // Read back as a clause, so the label's opening capital goes.
    expect(summary).toContain("build on personally, provide excellent client service");
    expect(summary).toContain("focuses on uphold Sun Tan City and JB & Associates");
  });

  it("never reads the employee's own marks, which are theirs to make", () => {
    const summary = planSummary(
      input({
        checked: {
          employee_expectations_success: ["client_service"],
          employee_expectations_improvement: ["bonus_viewer"],
        },
      }),
    )!;
    expect(summary).not.toContain("client service");
    expect(summary).not.toContain("Bonus Viewer");
  });
});

/* =============================================================== silence == */

describe("a blank field is omitted, not filled in", () => {
  it("says only what it has when the strength is missing", () => {
    const summary = planSummary(input({ values: { improvement_areas: "Punctuality" } }))!;
    expect(summary).toContain("focuses on punctuality.");
    expect(summary).not.toContain("build on");
  });

  it("says only what it has when the improvement is missing", () => {
    const summary = planSummary(input({ values: { top_strengths: "Client service" } }))!;
    expect(summary).toContain("builds on client service.");
    expect(summary).not.toContain("focuses on");
  });

  it("drops the plan clause when no plan of action was drafted", () => {
    const summary = planSummary(input({ values: { improvement_areas: "Punctuality" } }))!;
    expect(summary).not.toContain("The plan of action");
  });

  it("gives the instruction alone when nothing at all was drafted", () => {
    expect(planSummary(input())).toBe(
      "Review the SDIT EPP with Paulyne Co and download the PDF when you're ready. " +
        "Leave the signature fields blank until you've had the review conversation.",
    );
  });

  it("does not mention policy, which the appendix already names", () => {
    const summary = planSummary(
      input({
        values: {
          ...DRAFTED,
          policy_references: "JBA Policy Manual — Attendance — Page 14",
        },
      }),
    )!;
    expect(summary).not.toContain("Page 14");
    expect(summary).not.toContain("policy_references");
  });
});

/* ============================================================== the gate == */

describe("only a plan reviewed with the employee gets one", () => {
  it("says nothing for a form that records a conversation already had", () => {
    /*
     * THE TSD PLAN IS NO LONGER IN THIS LIST, and that is the point of reading
     * the DOCUMENT rather than a key: it acquired a section its subject fills
     * themselves — the manager's own self-assessment — so it acquired the
     * closing instruction too, without a line of this file naming it. The
     * ASD-SDIT and FTTC plans, which still share the older builder, did not.
     */
    for (const key of ["coaching", "dpoa", "policy-review", "asd-sdit-epp", "fttc-epp"]) {
      const document = parseFormDocument(seed(key).document);
      expect(isReviewedWithEmployee(document, null), key).toBe(false);
      expect(planSummary(input({ document, templateName: seed(key).name })), key).toBeNull();
    }
  });

  it("recognises the SDIT EPP by its structure, not by its key", () => {
    expect(isReviewedWithEmployee(SDIT, VARIANT.key)).toBe(true);
  });

  it("recognises the TSD plan the same way, off its self-assessment", () => {
    const tsd = parseFormDocument(seed("tsd-epp").document);
    expect(isReviewedWithEmployee(tsd, "default")).toBe(true);
  });
});

/* ========================================================== cannot drift == */

describe("every word of it is already on the form", () => {
  it("introduces no content word that is not in a stored value or a template label", () => {
    /*
     * ======================================================================
     * THE PROPERTY, ASSERTED RATHER THAN ARGUED
     * ======================================================================
     *
     * The summary is allowed its own connective prose — "focuses on", "while
     * continuing to build on", the closing instruction — and nothing else. So
     * every remaining word is checked against the union of the stored values,
     * the template's own labels, and that fixed frame. A word that is in none
     * of them could only have come from somewhere this module must not be
     * reading.
     */
    const values = { ...DRAFTED };
    const summary = planSummary(input({ values }))!;

    const FRAME =
      "the draft for focuses on while continuing to build the plan of action review with and download " +
      "pdf when you re ready leave signature fields blank until ve had conversation";

    const onTheForm = [
      FRAME,
      "SDIT EPP",
      "Paulyne Co",
      ...Object.values(values),
      ...SDIT.blocks.flatMap((block) =>
        block.kind === "expectation_checklist" ? block.options.map((o) => o.label) : [],
      ),
    ]
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ");

    const known = new Set(onTheForm.split(" ").filter(Boolean));
    const used = summary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(Boolean);

    expect(used.filter((word) => !known.has(word))).toEqual([]);
  });

  it("changes when the form changes, because it is read rather than stored", () => {
    const before = planSummary(input({ values: DRAFTED }))!;
    const after = planSummary(
      input({ values: { ...DRAFTED, improvement_areas: "Closing duties" } }),
    )!;

    expect(before).toContain("focuses on punctuality");
    expect(after).toContain("focuses on closing duties");
    expect(after).not.toContain("punctuality");
  });
});
