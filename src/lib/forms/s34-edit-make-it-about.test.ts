import { afterEach, describe, expect, it, vi } from "vitest";

import { scopeRevision, type RevisableField } from "./revision";

/**
 * EDIT_MAKE_IT_ABOUT_ENABLED (Pau's scan, sf-s34, 7 Nov 2026; Pau-approved 7 Nov). On an open Coaching draft the
 * manager wrote the live wording below; the scope was the date alone, so the Details rewrite was refused and the
 * reply said nothing changed. With the flag on, "make it about …" also allows the form's account.
 */
const LIVE = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";

const COACHING: RevisableField[] = [
  { key: "employee_name", label: "Employee Name" },
  { key: "form_date", label: "Date" },
  { key: "job_title", label: "Job Title" },
  { key: "location", label: "Location" },
  { key: "coaching_details", label: "Details of Coaching" },
];
const CA: RevisableField[] = [
  { key: "employee_name", label: "Employee Name" },
  { key: "form_date", label: "Date" },
  { key: "observation", label: "Observation of Offense" },
];

const keys = (question: string, fields: RevisableField[]) => {
  const scope = scopeRevision(question, fields);
  return { mode: scope.mode, keys: [...scope.keys].sort() };
};

describe("EDIT_MAKE_IT_ABOUT_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the live wording is scoped to the date alone (the reported failure)", () => {
    expect(keys(LIVE, COACHING)).toEqual({ mode: "fields", keys: ["form_date"] });
  });

  it("on: the live wording also allows the Coaching Details", () => {
    vi.stubEnv("EDIT_MAKE_IT_ABOUT_ENABLED", "true");
    expect(keys(LIVE, COACHING)).toEqual({ mode: "fields", keys: ["coaching_details", "form_date"] });
  });

  it("on: on a Corrective Action it is the Observation", () => {
    vi.stubEnv("EDIT_MAKE_IT_ABOUT_ENABLED", "true");
    expect(keys("make this about him leaving early", CA).keys).toContain("observation");
  });

  it.each(["make it shorter", "change the date to 10/14/26", "make it more professional"])('"%s" is scoped the same on and off', (question) => {
    const off = keys(question, COACHING);
    vi.stubEnv("EDIT_MAKE_IT_ABOUT_ENABLED", "true");
    expect(keys(question, COACHING)).toEqual(off);
  });
});
