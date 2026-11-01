import { afterEach, describe, expect, it, vi } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";

import { decideIntentTurn } from "./intent-slots";
import { isReportName } from "./not-a-person";

/**
 * ============================================================================
 * A REPORT IS NOT A PERSON (REPORT_NAME_NOT_A_PERSON_ENABLED)
 * ============================================================================
 *
 * QA, live, 1 Nov 2026 (a real chat): "Show me the most recent Daily Stats and
 * what I need to focus on today." saved "Daily Stats" as the conversation's
 * EMPLOYEE — two capitalised words read as a name — so a form asked for later
 * in that chat would have been for "Daily Stats". The app's own report names,
 * read from the report registry, are never a person.
 */

const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
const TEMPLATES = [
  { key: "dpoa", name: "Corrective Action Form" },
  { key: "coaching", name: "Coaching Form" },
] as const;
const ASK = "Show me the most recent Daily Stats and what I need to focus on today.";

function employeeAfter(question: string, raw: unknown = null) {
  return decideIntentTurn({
    question,
    history: [],
    today: "2026-10-31",
    saved: null,
    raw,
    people: [],
    salons: SALONS,
    headings: [],
    templates: TEMPLATES,
    formInProgress: false,
  }).state.employeeName;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe(`"${ASK}"`, () => {
  it("off (production today): Daily Stats is saved as the employee", () => {
    expect(employeeAfter(ASK)).toBe("Daily Stats");
  });

  it("REPORT_NAME_NOT_A_PERSON: no employee is saved", () => {
    vi.stubEnv("REPORT_NAME_NOT_A_PERSON_ENABLED", "true");
    expect(employeeAfter(ASK)).toBeNull();
  });

  it("REPORT_NAME_NOT_A_PERSON: nor when the reader returned it as the employee", () => {
    vi.stubEnv("REPORT_NAME_NOT_A_PERSON_ENABLED", "true");
    expect(employeeAfter(ASK, { employee: "Daily Stats" })).toBeNull();
  });

  it("REPORT_NAME_NOT_A_PERSON: a person beside a report is still the employee (names invented)", () => {
    vi.stubEnv("REPORT_NAME_NOT_A_PERSON_ENABLED", "true");
    expect(employeeAfter("coaching form for Marnie Holloway about the Daily Stats")).toBe("Marnie Holloway");
  });
});

describe("isReportName", () => {
  it("knows the registry's report names, with or without 'report'", () => {
    for (const name of ["Daily Stats", "daily stats", "Sales Totals", "Salon Performance", "Comp Report", "Bed Usage", "Spa Engagement", "Daily Stats report"]) {
      expect(isReportName(name), name).toBe(true);
    }
  });

  it("is never a person's name, even one that shares a word", () => {
    for (const name of ["Marnie Holloway", "Daily", "Stats Holloway", "Bea Usage"]) expect(isReportName(name), name).toBe(false);
  });
});
