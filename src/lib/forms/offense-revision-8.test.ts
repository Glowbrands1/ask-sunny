import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import REVISION_6 from "@/test/fixtures/forms/corrective-action-revision-6.json";
import REVISION_7 from "@/test/fixtures/forms/corrective-action-revision-7.json";

import { caPolicyProposalLine, readCaPolicy, statedOffenseKeys, withStatedOffense } from "./ca-policy";
import { checkboxGroupsForVariant, fieldsForVariant, parseFormDocument } from "./document";
import type { LoadedInstance } from "./instances";
import { TEMPLATE_SEEDS, correctiveActionDocument } from "./library";
import {
  CURRENT_CA_OFFENSE_KEYS,
  OFFENSE_KEY_SUCCESSORS,
  offeredOffenseKey,
  offeredOffenseKeys,
  withOfferedOffense,
} from "./offense-keys";
import { boxSectionNames, sectionHeadingsFor, type ManualSection } from "./official-policy-manual";
import { renderFormPdf, type RenderMeta } from "./pdf-render";
import { offenseCategoryValue } from "./policy-fields";
import { policyFieldsWithCitation } from "./required-policy-citation";
import { copiedContent } from "./same-form-copy";

/**
 * ============================================================================
 * CORRECTIVE ACTION REVISION 8: TYPE OF OFFENSE (client request relayed by
 * Pau, 4 Nov 2026; template approved via QA)
 * ============================================================================
 *
 * The evidence QA asked for, in one place:
 *   1. an OLD saved form (revision 6, the database's published revision, or
 *      revision 7, the live library's) opens and prints with its old boxes
 *      and values, and nothing about it is rewritten;
 *   2. what the copy paths do with an old form's ticks;
 *   3. the assistant no longer offers the removed boxes, and attendance /
 *      tardiness is the Attendance Policy box.
 * Every name is invented. (Ported from Ask Bubbles, where the change is
 * revision 7; here revision 7 is the Payroll deduction amount line and the
 * Type of Offense is revision 8.)
 */

const OLD = parseFormDocument(REVISION_6);
const OLD_7 = parseFormDocument(REVISION_7);
const NEW = parseFormDocument(correctiveActionDocument());
const options = (document: typeof OLD) =>
  checkboxGroupsForVariant(document, null).find((group) => group.key === "offense_type")!.options.map((option) => option.key);
const OLD_OFFERED = options(OLD);
const NEW_OFFERED = options(NEW);

const META: RenderMeta = {
  templateName: "Corrective Action Form",
  templateVersion: 6,
  employeeName: "Orla Penhallow",
  formDate: "2026-10-30",
  locationName: "Invented Salon Alpha",
  reference: "form-rev8",
  status: "finalized",
};

async function printed(document: typeof OLD, values: { values: Record<string, string>; checked: Record<string, string[]> }) {
  const pdf = await getDocumentProxy(renderFormPdf(document, null, values, META));
  return (await extractText(pdf, { mergePages: true })).text;
}

describe("the revision 8 template", () => {
  it("is revision 8 and offers exactly Attendance Policy, Standards of Conduct, Dress Code Violation, Other", () => {
    const seed = TEMPLATE_SEEDS.find((entry) => entry.key === "dpoa")!;
    expect(seed.revision).toBe(8);
    expect(checkboxGroupsForVariant(NEW, null).find((group) => group.key === "offense_type")!.options).toEqual([
      { key: "attendance_policy", label: "Attendance Policy" },
      { key: "standards_of_conduct", label: "Standards of Conduct" },
      { key: "dress_code", label: "Dress Code Violation" },
      { key: "other", label: "Other" },
    ]);
    expect(fieldsForVariant(NEW, null).some((field) => field.key === "other_offense")).toBe(false);
  });

  it("CURRENT_CA_OFFENSE_KEYS is the library's own list", () => {
    expect(CURRENT_CA_OFFENSE_KEYS).toEqual(NEW_OFFERED);
  });

  it("the revision 6 and 7 fixtures are the documents forms were filed on (six boxes and the Other write-in)", () => {
    for (const document of [OLD, OLD_7]) {
      expect(options(document)).toEqual(["tardiness", "absenteeism", "standards_of_conduct", "under_performance", "dress_code", "company_policies"]);
      expect(fieldsForVariant(document, null).some((field) => field.key === "other_offense")).toBe(true);
    }
    // Revision 7 is revision 6 plus the Payroll deduction amount line, which revision 8 keeps.
    expect(fieldsForVariant(OLD, null).some((field) => field.key === "payroll_deduct_amount")).toBe(false);
    expect(fieldsForVariant(OLD_7, null).some((field) => field.key === "payroll_deduct_amount")).toBe(true);
    expect(fieldsForVariant(NEW, null).some((field) => field.key === "payroll_deduct_amount")).toBe(true);
  });
});

describe.each([
  ["revision 6", REVISION_6],
  ["revision 7", REVISION_7],
] as const)("1. an old (%s) form opens and prints with its old values", (_name, raw) => {
  const OLD = parseFormDocument(raw);
  const stored = {
    values: { employee_name: "Orla Penhallow", other_offense: "Register count left unfinished", policy_violated: "Tardiness/Leaving Early" },
    checked: { offense_type: ["tardiness", "company_policies"] },
  };

  it("prints its old boxes, its write-in and its Policy Violated, as filed", async () => {
    const text = await printed(OLD, stored);
    expect(text).toContain("Tardiness/Leaving Early");
    expect(text).toContain("Violation of Company Policies");
    expect(text).toContain("Register count left unfinished");
    expect(text).not.toContain("Attendance Policy");
  });

  it("Policy Violated still reads its own labels", () => {
    expect(offenseCategoryValue({ document: OLD, variantKey: null, checked: stored.checked, values: stored.values })).toBe(
      "Tardiness/Leaving Early, Violation of Company Policies",
    );
  });

  it("a version that offers the old boxes is never remapped", () => {
    expect(offeredOffenseKeys(["tardiness", "absenteeism", "under_performance", "company_policies"], OLD_OFFERED)).toEqual([
      "tardiness",
      "absenteeism",
      "under_performance",
      "company_policies",
    ]);
    const checked = { offense_type: ["tardiness"] };
    expect(withOfferedOffense(checked, OLD_OFFERED)).toBe(checked);
    expect(withStatedOffense({ checked: {}, values: {}, keys: ["tardiness"], offered: OLD_OFFERED }).ticked).toEqual(["tardiness"]);
  });

  it("names a section beside the old box on an old form, never twice", () => {
    const names = boxSectionNames(["Attendance", "Late Opening"]);
    expect(
      offenseCategoryValue({ document: OLD, variantKey: null, checked: { offense_type: ["tardiness"] }, values: {}, sectionNames: names }),
    ).toBe("Tardiness/Leaving Early — Late Opening");
    const visitors = boxSectionNames(["Standards of Conduct", "Visitors in the Workplace"]);
    expect(
      offenseCategoryValue({
        document: OLD,
        variantKey: null,
        checked: { offense_type: ["standards_of_conduct", "company_policies"] },
        values: {},
        sectionNames: visitors,
      }),
    ).toBe("Standards of Conduct, Violation of Company Policies — Visitors in the Workplace");
  });
});

describe("the new form prints the new boxes", () => {
  it("prints Attendance Policy and Other, and no removed box", async () => {
    const text = await printed(NEW, { values: { employee_name: "Orla Penhallow" }, checked: { offense_type: ["attendance_policy", "other"] } });
    for (const label of ["Attendance Policy", "Standards of Conduct", "Dress Code Violation", "Other"]) expect(text).toContain(label);
    for (const label of ["Tardiness/Leaving Early", "Absenteeism", "Under Performance", "Violation of Company Policies"]) {
      expect(text).not.toContain(label);
    }
  });
});

describe("2. the removed boxes, on the new form", () => {
  it("each maps to the box that replaced it", () => {
    expect(OFFENSE_KEY_SUCCESSORS).toEqual({
      tardiness: "attendance_policy",
      absenteeism: "attendance_policy",
      late_opening: "attendance_policy",
      under_performance: "standards_of_conduct",
      company_policies: "standards_of_conduct",
    });
    for (const [removed, successor] of Object.entries(OFFENSE_KEY_SUCCESSORS)) {
      expect(offeredOffenseKey(removed, NEW_OFFERED)).toBe(successor);
    }
    expect(offeredOffenseKeys(["tardiness", "absenteeism"], NEW_OFFERED)).toEqual(["attendance_policy"]);
    expect(offeredOffenseKey("not_a_box", NEW_OFFERED)).toBeNull();
  });

  it("the drafting model's old key is ticked as its replacement, not dropped", () => {
    expect(withOfferedOffense({ offense_type: ["tardiness"], warning_type: ["verbal"] }, NEW_OFFERED)).toEqual({
      offense_type: ["attendance_policy"],
      warning_type: ["verbal"],
    });
  });

  it("Late Opening and Seminar/Webinar Attendance follow the Attendance Policy box", () => {
    expect(sectionHeadingsFor({ offenseKeys: ["attendance_policy"], notes: "she opened the salon late" })).toEqual([["Late Opening"], ["Attendance"]]);
    expect(sectionHeadingsFor({ offenseKeys: ["attendance_policy"], notes: "she missed the webinar" })).toEqual([
      ["Seminar/Webinar Attendance"],
      ["Attendance"],
    ]);
    expect(boxSectionNames(["Attendance", "Late Opening"], NEW_OFFERED)).toEqual({ attendance_policy: "Late Opening" });
  });

  it("Visitors in the Workplace is named beside the Standards of Conduct", () => {
    expect(boxSectionNames(["Visitors in the Workplace"], NEW_OFFERED)).toEqual({ standards_of_conduct: "Visitors in the Workplace" });
    expect(
      offenseCategoryValue({
        document: NEW,
        variantKey: null,
        checked: { offense_type: ["standards_of_conduct"] },
        values: {},
        sectionNames: boxSectionNames(["Visitors in the Workplace"]),
      }),
    ).toBe("Standards of Conduct — Visitors in the Workplace");
  });

  it("Other prints as Other (no write-in)", () => {
    expect(offenseCategoryValue({ document: NEW, variantKey: null, checked: { offense_type: ["other"] }, values: {} })).toBe("Other");
  });
});

describe("2. same-form copy from an old form onto the new one", () => {
  const instance = (id: string, name: string, document: unknown, values: { fieldKey: string; value: string | null; checked: string[] }[]) =>
    ({
      instance: { id, employeeName: name, variantKey: null },
      version: { document },
      values: values.map((row) => ({ ...row, filledBy: "assistant", provenance: null })),
    }) as unknown as LoadedInstance;

  it("ticks the boxes that replaced the old ones, and Other for an old write-in", () => {
    const source = instance("src", "Orla Penhallow", REVISION_7, [
      { fieldKey: "offense_type", value: null, checked: ["tardiness", "absenteeism"] },
      { fieldKey: "other_offense", value: "Register count", checked: [] },
    ]);
    const target = instance("dst", "Bevan Quarrell", correctiveActionDocument(), []);
    expect(copiedContent(source, target).checked.offense_type).toEqual(["attendance_policy", "other"]);
  });

  it("copies a new form onto a new form exactly", () => {
    const source = instance("src", "Orla Penhallow", correctiveActionDocument(), [{ fieldKey: "offense_type", value: null, checked: ["dress_code"] }]);
    const target = instance("dst", "Bevan Quarrell", correctiveActionDocument(), []);
    expect(copiedContent(source, target).checked.offense_type).toEqual(["dress_code"]);
  });
});

describe("3. the assistant never offers a removed box", () => {
  // Offered as a box: the card names a box in bold. "it's under performance" is answered with the Standards of Conduct (below).
  const REMOVED = /\*\*(?:Tardiness\/Leaving Early|Absenteeism|Under Performance|Violation of Company Polic(?:y|ies))\b/;

  it.each([
    "she was late to her shift three times",
    "she was a no call no show on saturday",
    "the policy is attendance",
    "it's under performance",
    "she missed the deadline to hit her sales goal",
  ])("%s", (text) => {
    expect(caPolicyProposalLine(readCaPolicy(text)) ?? "").not.toMatch(REMOVED);
  });

  it("a manager who names Under Performance is answered with the Standards of Conduct", () => {
    expect(caPolicyProposalLine(readCaPolicy("it's under performance"))).toMatch(/^\*\*Policy:\*\* Standards of Conduct — /);
  });

  it("attendance and tardiness tick the Attendance Policy box on the new form", () => {
    for (const text of ["the policy is attendance", "she was late to her shift", "she was a no call no show"]) {
      const keys = statedOffenseKeys(readCaPolicy(text), text) ?? ["tardiness"];
      expect(withStatedOffense({ checked: {}, values: {}, keys, offered: NEW_OFFERED }).ticked, text).toEqual(["attendance_policy"]);
    }
  });
});

describe("Ask Sunny: the Attendance Policy box is cited by section and page like the Tardiness box it replaced", () => {
  const LATE_OPENING = { heading: "Late Opening", page: 15 } as ManualSection;
  const ATTENDANCE = { heading: "Attendance", page: 14 } as ManualSection;

  it("ATTENDANCE_POLICY_CITATION: Policy Violated on the new box reads the cited sections", () => {
    const values = policyFieldsWithCitation({
      attendance: true,
      pageRequired: false,
      values: { policy_violated: "Attendance Policy — Late Opening" },
      sections: [LATE_OPENING, ATTENDANCE],
    });
    expect(values.policy_violated).toBe("Late Opening Policy, JBA Policy Manual p.15; Attendance Policy, JBA Policy Manual p.14");
  });

  it("an old form's Tardiness box reads as it did, and a box that is not attendance is untouched", () => {
    const old = policyFieldsWithCitation({
      attendance: true,
      pageRequired: false,
      values: { policy_violated: "Tardiness/Leaving Early" },
      sections: [ATTENDANCE],
    });
    expect(old.policy_violated).toBe("Attendance Policy, JBA Policy Manual p.14");
    const conduct = policyFieldsWithCitation({
      attendance: true,
      pageRequired: false,
      values: { policy_violated: "Standards of Conduct" },
      sections: [ATTENDANCE],
    });
    expect(conduct.policy_violated).toBe("Standards of Conduct");
  });
});
