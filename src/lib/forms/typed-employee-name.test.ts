import { afterEach, describe, expect, it, vi } from "vitest";

import { typedEmployeeName } from "./typed-employee-name";

/** QA, 25 Oct 2026: "Test Employee" typed as the employee's name is the name (KEEP_FORM_EMPLOYEE_ENABLED). */
describe("typedEmployeeName", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline", "Test Employee"],
    ["Create an exit form for Test Employee at Lawrence, she resigned and her last day was 10-20", "Test Employee"],
    ["name is Test Employee", "Test Employee"],
    ["Employee name is Test Employee", "Test Employee"],
    ["employee: Test Employee", "Test Employee"],
    ["Test Employee at Kearney", "Test Employee"],
    ["Test Employee, Salon Director", "Test Employee"],
    ["Test Employee", "Test Employee"],
    ["the Employee Performance Plan for Test Employee", "Test Employee"],
  ])("%s → %s", (text, name) => {
    expect(typedEmployeeName(text)).toBe(name);
  });

  it.each([
    "an employee was late",
    "my employee Jordan Hale was late",
    "the employee was late",
    "employee name is Jordan Hale",
    "create a CA for test employee at Kearney",
    "create a coaching form for my Employee",
    "a form for the Employee Handbook",
    "start an Employee Performance Plan for Jordan Hale",
    "coaching for New Employee orientation",
    "a form for Former Employee records",
    "coaching for Each Employee",
    "coaching for Test Employees",
    "the Employee Dress Code for Test",
  ])("%s → no typed name", (text) => {
    expect(typedEmployeeName(text)).toBeNull();
  });

  it("with the not-a-name guard on, a placeholder or a place is not a first name", () => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
    expect(typedEmployeeName("create a CA for Blank Employee")).toBeNull();
    expect(typedEmployeeName("create a CA for Lawrence Employee")).toBeNull();
    expect(typedEmployeeName("create a CA for Test Employee at Kearney")).toBe("Test Employee");
  });
});
