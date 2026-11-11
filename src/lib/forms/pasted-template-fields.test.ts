import { describe, expect, it } from "vitest";

import { TEMPLATE } from "@/app/api/chat/replay-pack/nov5-pau-sf-s21-s25-cases";

import { pastedTemplateValues, templatePerson, templateSections, withPastedLineBreaks } from "./pasted-template-fields";

/**
 * PASTED_TEMPLATE_FIELDS_TO_OPEN_DRAFT_ENABLED (QA's Sunny round-25 live test of sf-s21, 11 Nov 2026): sf-s21's exact
 * pasted template ("Observation of Offense: … Action Plan: …", Tamsyn's CA) onto Wynne's open Corrective Action draft.
 * Every person invented.
 */
const CA_FIELDS = [
  { key: "employee_name", label: "Employee Name" },
  { key: "observation", label: "Observation of Offense" },
  { key: "action_plan", label: "Action Plan" },
  { key: "prior_actions", label: "Prior Actions" },
];

describe("a pasted template's labelled sections", () => {
  it("splits sf-s21's paste by the open form's own labels", () => {
    const sections = templateSections(TEMPLATE, CA_FIELDS);
    expect(Object.keys(sections)).toEqual(["observation", "action_plan"]);
    expect(sections.observation).toMatch(/^During the month of September 2026, Tamsyn completed 237 tanning transactions\./);
    expect(sections.observation).not.toMatch(/Action Plan:/);
    expect(sections.action_plan).toMatch(/^The Leadership Team will coach Tamsyn on Must See Behaviors/);
  });

  it("reads the template's person as Tamsyn, never a capitalised phrase", () => {
    expect(templatePerson(TEMPLATE, "Wynne Sarrow")).toBe("Tamsyn");
  });

  it("places the sections in the draft's employee's name: no person switch", () => {
    const values = pastedTemplateValues({ text: TEMPLATE, fields: CA_FIELDS, employeeName: "Wynne Sarrow" });
    expect(Object.keys(values)).toEqual(["observation", "action_plan"]);
    expect(JSON.stringify(values)).not.toMatch(/Tamsyn/);
    expect(values.observation).toMatch(/Wynne completed 237 tanning transactions/);
    expect(values.action_plan).toMatch(/coach Wynne on Must See Behaviors/);
    expect(values).not.toHaveProperty("employee_name");
  });

  it("a full name in the template is written as the draft's full name", () => {
    const text = "Observation of Offense: Tamsyn Fairlow was late. Tamsyn was late again.\nAction Plan: Tamsyn will be coached.";
    const values = pastedTemplateValues({ text, fields: CA_FIELDS, employeeName: "Wynne Sarrow" });
    expect(values.observation).toBe("Wynne Sarrow was late. Wynne was late again.");
    expect(values.action_plan).toBe("Wynne will be coached.");
  });

  it("a turn with no field label places nothing", () => {
    expect(pastedTemplateValues({ text: "she was late again today", fields: CA_FIELDS, employeeName: "Wynne Sarrow" })).toEqual({});
  });
});

describe("round 25 5c: pasted lines keep their line breaks", () => {
  const STEPS = "Step 1 - 10/6/26 - Verbal reminder about arriving on time.\nStep 2 - 10/20/26 - Follow-up talk; she said she would leave earlier.\nStep 3 - 11/3/26 - Written follow-up sent.";
  it("QA's saved one-line value gets the pasted line breaks back", () => {
    expect(withPastedLineBreaks(STEPS.split("\n").join(" "), STEPS)).toBe(STEPS);
  });
  it("a value already on separate lines, or a different value, is left alone", () => {
    expect(withPastedLineBreaks(STEPS, STEPS)).toBeNull();
    expect(withPastedLineBreaks("None - first occurrence.", STEPS)).toBeNull();
    expect(withPastedLineBreaks("one line", "one line")).toBeNull();
  });
});
