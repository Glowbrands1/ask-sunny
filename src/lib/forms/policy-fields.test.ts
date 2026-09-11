import { describe, expect, it } from "vitest";

import { fieldsForVariant, parseFormDocument } from "./document";
import { correctiveActionDocument } from "./library";
import {
  FORM_DERIVED_POLICY_KEYS,
  applyDerivedPolicyFields,
  formDerivedProvenance,
  manualReferenceValue,
  offenseCategoryValue,
} from "./policy-fields";
import { refuseUnverifiedPolicyValues, type PolicyGrounding } from "./policy-grounding";

/**
 * ============================================================================
 * BOTH POLICY FIELDS ARE FACTS THE SERVER ALREADY HOLDS
 * ============================================================================
 *
 * Policy Violated is the offense CATEGORY ticked on the form. Direct policy
 * names the approved manual that answered, with its section and page. Neither
 * is prose a model composes, which is what makes them safe to fill: there is
 * no wording to get wrong and no retrieval to paraphrase.
 */

const DOCUMENT = parseFormDocument(correctiveActionDocument());
const FIELD_KEYS = new Set(["policy_violated", "policy_language", "other_offense"]);

function grounding(overrides: Partial<PolicyGrounding> = {}): PolicyGrounding {
  return { passages: [], sources: [], unverified: true, reason: null, ...overrides };
}

function source(locator: string, score: number, title = "Driven to Shine Policy Manual 2.2025") {
  return { documentId: "doc-manual", documentTitle: title, locator, score };
}

describe("1. Policy Violated is the ticked offense category", () => {
  it("copies the label off the box the manager ticked", () => {
    expect(
      offenseCategoryValue({
        document: DOCUMENT,
        variantKey: null,
        checked: { offense_type: ["dress_code"] },
        values: {},
      }),
    ).toBe("Dress Code Violation");
  });

  it("reads the labels off the stored document, so a re-publish is followed", () => {
    // Every option on the seeded form, by its own label.
    for (const [key, label] of [
      ["tardiness", "Tardiness/Leaving Early"],
      ["absenteeism", "Absenteeism"],
      ["standards_of_conduct", "Standards of Conduct"],
      ["under_performance", "Under Performance"],
      ["company_policies", "Violation of Company Policies"],
    ] as const) {
      expect(
        offenseCategoryValue({
          document: DOCUMENT,
          variantKey: null,
          checked: { offense_type: [key] },
          values: {},
        }),
        key,
      ).toBe(label);
    }
  });

  it("joins several ticks rather than picking one", () => {
    expect(
      offenseCategoryValue({
        document: DOCUMENT,
        variantKey: null,
        checked: { offense_type: ["tardiness", "absenteeism"] },
        values: {},
      }),
    ).toBe("Tardiness/Leaving Early, Absenteeism");
  });

  it("is null when nothing is ticked, so the manager gets a blank line", () => {
    expect(
      offenseCategoryValue({
        document: DOCUMENT,
        variantKey: null,
        checked: {},
        values: {},
      }),
    ).toBeNull();
  });
});

describe("2. Direct policy names the manual that answered", () => {
  it("gives the title, section and page", () => {
    expect(
      manualReferenceValue(
        grounding({
          unverified: false,
          sources: [source("Dress for Success — Tanning Consultant, page 12", 0.71)],
        }),
      ),
    ).toBe("Driven to Shine Policy Manual — Dress for Success — Tanning Consultant, page 12");
  });

  it("joins the sections when one manual answered at several", () => {
    expect(
      manualReferenceValue(
        grounding({
          unverified: false,
          sources: [
            source("Dress for Success, page 12", 0.71),
            source("Personal Hygiene, page 13", 0.55),
          ],
        }),
      ),
    ).toBe(
      "Driven to Shine Policy Manual — Dress for Success, page 12; Personal Hygiene, page 13",
    );
  });

  it("names the best-scoring manual, not a bibliography of every hit", () => {
    const value = manualReferenceValue(
      grounding({
        unverified: false,
        sources: [
          { ...source("Appendix, page 40", 0.41), documentId: "other", documentTitle: "NCR 2022" },
          source("Dress for Success, page 12", 0.78),
        ],
      }),
    );

    expect(value).toBe("Driven to Shine Policy Manual — Dress for Success, page 12");
    expect(value).not.toContain("NCR 2022");
  });

  /*
   * THE FAIL-CLOSED HALF. Naming the manual is only possible because a manual
   * answered — so an unverified grounding names nothing, the field stays empty,
   * and finalizing still asks for an acknowledgement.
   */
  it("names nothing when the grounding is unverified", () => {
    expect(manualReferenceValue(grounding({ sources: [source("page 12", 0.9)] }))).toBeNull();
    expect(manualReferenceValue(grounding({ unverified: false, sources: [] }))).toBeNull();
  });
});

describe("3. what reaches the form", () => {
  it("overrides whatever the model composed", () => {
    const result = applyDerivedPolicyFields({
      document: DOCUMENT,
      variantKey: null,
      values: {
        policy_violated: "Sun Tan City Handbook 4.1",
        policy_language: "[Verify exact policy language from official manual]",
      },
      checked: { offense_type: ["dress_code"] },
      grounding: grounding({
        unverified: false,
        sources: [source("Dress for Success, page 12", 0.7)],
      }),
      fieldKeys: FIELD_KEYS,
    });

    expect(result.values.policy_violated).toBe("Dress Code Violation");
    expect(result.values.policy_language).toBe(
      "Driven to Shine Policy Manual — Dress for Success, page 12",
    );
    expect(result.derived).toEqual(["policy_violated", "policy_language"]);
    expect(result.unresolved).toEqual([]);
    expect(JSON.stringify(result.values)).not.toContain("Handbook 4.1");
    expect(JSON.stringify(result.values)).not.toContain("Verify exact policy");
  });

  it("removes rather than keeps what it cannot derive", () => {
    const result = applyDerivedPolicyFields({
      document: DOCUMENT,
      variantKey: null,
      values: { policy_violated: "Dress Code Policy", policy_language: "Something plausible." },
      checked: {},
      grounding: grounding(),
      fieldKeys: FIELD_KEYS,
    });

    expect(result.values.policy_violated).toBeUndefined();
    expect(result.values.policy_language).toBeUndefined();
    expect(result.derived).toEqual([]);
    expect(result.unresolved).toEqual(["policy_violated", "policy_language"]);
  });

  it("touches no other field", () => {
    const result = applyDerivedPolicyFields({
      document: DOCUMENT,
      variantKey: null,
      values: { observation: "Observed: she wore a mini skirt today.", action_plan: "A plan." },
      checked: { offense_type: ["dress_code"] },
      grounding: grounding(),
      fieldKeys: FIELD_KEYS,
    });

    expect(result.values.observation).toBe("Observed: she wore a mini skirt today.");
    expect(result.values.action_plan).toBe("A plan.");
  });

  /*
   * A form without these fields cannot have them conjured onto it — the
   * Coaching Form has neither, and nothing here may invent one.
   */
  it("writes nothing onto a form that has no policy fields", () => {
    const result = applyDerivedPolicyFields({
      document: DOCUMENT,
      variantKey: null,
      values: {},
      checked: { offense_type: ["dress_code"] },
      grounding: grounding({
        unverified: false,
        sources: [source("Dress for Success, page 12", 0.7)],
      }),
      fieldKeys: new Set<string>(),
    });

    expect(result.values).toEqual({});
    expect(result.derived).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});

/**
 * ============================================================================
 * 4. THE OLDER PUBLISHED VERSION MUST NOT EMPTY THE FIELD
 * ============================================================================
 *
 * An instance is pinned to the version it was created under, and that pinning
 * is immutable on purpose — a filed form keeps the document it was filed
 * against. Instances created before `policy_violated` was redefined are pinned
 * to a version where it is still `policyGrounded`, so the write-time guard —
 * which reads the INSTANCE'S OWN fields and allows a policy-quoting value
 * through only on provenance that says verified — refused a value copied
 * straight off the tick box, and the manager got a blank line under a ticked
 * offense.
 *
 * The provenance is what settles it, and it names the FORM as the source. That
 * distinction is not decoration: nobody reading the audit trail should conclude
 * a manual was consulted for a value that came off a checkbox.
 */
describe("4. a value taken off the form carries the form's own provenance", () => {
  /*
   * THE REAL FIELDS, with the one flag the older published version differs by.
   * Hand-rolling a field list here would assert against a shape rather than
   * against the document, and the document is what an instance is pinned to.
   */
  const groundedOnOlderVersion = fieldsForVariant(DOCUMENT, null).map((field) =>
    field.key === "policy_violated" ? { ...field, policyGrounded: true } : field,
  );

  it("names the form rather than a manual", () => {
    expect(formDerivedProvenance(["policy_violated"])).toEqual({
      policy_violated: {
        grounded: false,
        derived: true,
        source: "offense_type",
        verified: true,
      },
    });
  });

  it("covers only the field that is copied off the form", () => {
    expect(FORM_DERIVED_POLICY_KEYS.has("policy_violated")).toBe(true);
    // The field that NAMES A MANUAL is deliberately absent, so it still fails
    // closed and still holds up a finalize without an acknowledgement.
    expect(FORM_DERIVED_POLICY_KEYS.has("policy_language")).toBe(false);
    expect(formDerivedProvenance(["policy_language"])).toEqual({});
  });

  it("gets the derived value past the write-time guard on the older version", () => {
    const result = refuseUnverifiedPolicyValues(
      groundedOnOlderVersion,
      { policy_violated: "Dress Code Violation" },
      formDerivedProvenance(["policy_violated"]),
    );

    expect(result.values.policy_violated).toBe("Dress Code Violation");
    expect(result.refused).toEqual([]);
  });

  it("still refuses an unsourced value that names a manual", () => {
    const result = refuseUnverifiedPolicyValues(
      groundedOnOlderVersion,
      { policy_language: "Skirts must reach mid-thigh." },
      formDerivedProvenance(["policy_violated"]),
    );

    expect(result.values.policy_language).toBeUndefined();
    expect(result.refused).toEqual(["policy_language"]);
  });
});
