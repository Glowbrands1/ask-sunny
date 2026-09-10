import { describe, expect, it } from "vitest";

import { parseFormDocument } from "./document";
import { correctiveActionDocument } from "./library";
import {
  applyDerivedPolicyFields,
  manualReferenceValue,
  offenseCategoryValue,
} from "./policy-fields";
import type { PolicyGrounding } from "./policy-grounding";

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
    ).toBe("Driven to Shine Policy Manual 2.2025 — Dress for Success — Tanning Consultant, page 12");
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
      "Driven to Shine Policy Manual 2.2025 — Dress for Success, page 12; Personal Hygiene, page 13",
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

    expect(value).toBe("Driven to Shine Policy Manual 2.2025 — Dress for Success, page 12");
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
      "Driven to Shine Policy Manual 2.2025 — Dress for Success, page 12",
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
