import { describe, expect, it } from "vitest";

import { yearCheckWarnings } from "./date-year-check";

/*
 * A real manager's exit form (20 Nov 2026, finalized): "Date that notice was given" was saved as 2020-11-20 beside a
 * form dated 2026-11-20, entered by hand on the page. Before Finalize, an exit date whose year is more than a year from
 * the form's date is flagged "Check the year" (a warning, never a block).
 */
const FIELDS = [
  { key: "last_day_worked", label: "Last Day Worked" },
  { key: "notice_given_date", label: "Date that notice was given" },
  { key: "notice_fulfilled_date", label: "Date that notice was fulfilled" },
  { key: "resignation_date", label: "Resignation Date" },
  { key: "details", label: "Additional Details" },
];

describe("yearCheckWarnings", () => {
  it("flags the production form's 2020 notice date beside a 2026 form date", () => {
    const values = { form_date: "2026-11-20", last_day_worked: "2026-11-17", notice_given_date: "2020-11-20", notice_fulfilled_date: "2026-11-20", resignation_date: "2026-11-20" };
    expect(yearCheckWarnings(FIELDS, values, values.form_date)).toEqual([{ key: "notice_given_date", label: "Date that notice was given", value: "2020-11-20" }]);
  });

  it("does not flag dates within a year of the form date, across a new year", () => {
    expect(yearCheckWarnings(FIELDS, { last_day_worked: "2025-12-30", notice_given_date: "2026-12-30" }, "2026-01-02")).toEqual([]);
  });

  it("flags a date more than a year after the form date", () => {
    expect(yearCheckWarnings(FIELDS, { last_day_worked: "2028-11-17" }, "2026-11-20").map((warning) => warning.key)).toEqual(["last_day_worked"]);
  });

  it("checks only the exit form's date lines, and nothing without a form date or a full date", () => {
    expect(yearCheckWarnings(FIELDS, { details: "2020-11-20" }, "2026-11-20")).toEqual([]);
    expect(yearCheckWarnings(FIELDS, { notice_given_date: "2020-11-20" }, null)).toEqual([]);
    expect(yearCheckWarnings(FIELDS, { notice_given_date: "11/20" }, "2026-11-20")).toEqual([]);
  });
});
