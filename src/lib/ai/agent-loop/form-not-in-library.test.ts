import { describe, expect, it } from "vitest";

import { formAskedOutsideLibrary, withLibraryForms } from "./form-not-in-library";
import { quoteNamesForm } from "./tools";

/*
 * QA, live on the agent loop, 24 Nov 2026: "Draft a vacation request form" → "There's no \"Vacation Request Form\" in the
 * forms library — PTO requests … run through … directly …", and never the forms that exist. Their exact words first.
 */
const TEMPLATES = [
  { name: "Corrective Action Form", shortName: "CA" },
  { name: "Coaching Form", shortName: null },
  { name: "Resignation/Exit Form", shortName: null },
];
const NAMES = TEMPLATES.map((row) => row.name);
const outside = (said: string) => formAskedOutsideLibrary(said, TEMPLATES, quoteNamesForm);

describe("formAskedOutsideLibrary", () => {
  it.each([
    ["Draft a vacation request form", "vacation request form"],
    ["draft a PTO request", "PTO request"],
    ["Draft a vacation request", "vacation request"],
    ["can you make me a time off request form", "time off request form"],
  ])("%s → %s", (said, asked) => {
    expect(outside(said)).toBe(asked);
  });

  it.each([
    "Create a coaching form.",
    "create a coaching document for Remy Calder regarding her missed vacation request",
    "make me a CA for Remy for being late on 11/5",
    "I need an exit form for Remy Calder",
    "Remy Calder quit, do the paperwork",
    "she wants to get a time off request approved",
    "send a request to HR",
  ])("none: %s", (said) => {
    expect(outside(said)).toBeNull();
  });
});

describe("withLibraryForms", () => {
  it("QA's reply gains the list, and says there's no such form once", () => {
    const reply = "There's no \"Vacation Request Form\" in the forms library — PTO requests run through the staff app directly.";
    const out = withLibraryForms(reply, "vacation request form", NAMES);
    expect(out).toBe(`${reply}\n\nThe forms you can create are Corrective Action Form, Coaching Form and Resignation/Exit Form.`);
  });

  it("a reply that does not say it gets one short line", () => {
    expect(withLibraryForms("PTO requests go through the staff app.", "PTO request", NAMES)).toMatch(/\n\nThere's no PTO request form in the forms library\. The forms you can create are .+\.$/);
  });

  it("a reply that already names the forms is kept", () => {
    const reply = "That form isn't in the forms library. The forms you can create are Corrective Action Form, Coaching Form and Resignation/Exit Form. Which one do you want?";
    expect(withLibraryForms(reply, "vacation request form", NAMES)).toBe(reply);
  });
});
