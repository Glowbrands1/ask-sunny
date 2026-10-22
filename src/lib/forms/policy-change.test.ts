import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CHUNKS } from "@/lib/ai/__fixtures__/jba-policy-manual";

import { findManualSection, manualSectionHeadings } from "./official-policy-manual";
import {
  citedBoxSections,
  headingsNamedIn,
  nextPolicySections,
  readPolicyChange,
  sectionsNamedIn,
  similarHeadings,
  unresolvedPolicyName,
} from "./policy-change";
import { extractEmployeeNames } from "./proposal";

/**
 * "Add the Late Opening policy to this form" — read against the real JBA
 * manual fixture. See `policy-change.ts`.
 */

describe("which kind of change a turn asks for", () => {
  it.each([
    ["can you add late opening policy to the direct policy section of this from", "add"],
    ["add the late opening policy too", "add"],
    ["please include the dress code policy as well", "add"],
    ["Actually use the dress code policy instead", "replace"],
    ["change the policy to Late Opening", "replace"],
    ["swap the attendance policy for the late opening one", "replace"],
    ["use the late opening policy", "replace"],
    ["take the late opening policy off the form", "remove"],
    ["remove the attendance policy", "remove"],
  ] as const)("%s → %s", (question, mode) => {
    expect(readPolicyChange(question)).toBe(mode);
  });

  it.each([
    "what is the late opening policy?",
    "Does the attendance policy apply here?",
    "I have independently verified and the policy is correct you may issue",
    "change it to a written warning",
    "",
  ])("%s → not a policy change", (question) => {
    expect(readPolicyChange(question)).toBeNull();
  });
});

describe("the manual's sections a turn names", () => {
  const named = (text: string) => sectionsNamedIn({ text, chunks: JBA_MANUAL_CHUNKS }).map((s) => `${s.heading} p${s.page}`);

  it("finds a heading the manual prints, in the manager's own words", () => {
    expect(named("can you add late opening policy to the direct policy section of this from")).toEqual(["Late Opening p15"]);
    expect(named("ADD THE LATE OPENING POLICY")).toEqual(["Late Opening p15"]);
  });

  it("finds the section an offense box points at, by the policy's everyday name", () => {
    expect(named("use the dress code policy instead")).toEqual(["Dress Code for The Company p15"]);
    expect(named("add the attendance policy")[0]).toMatch(/^Attendance p\d+$/);
  });

  it("names nothing for a policy the manual does not print", () => {
    expect(named("add the moon landing policy")).toEqual([]);
    expect(unresolvedPolicyName("add the moon landing policy")).toBe("moon landing");
    expect(unresolvedPolicyName("the policy is correct")).toBeNull();
  });

  it("never reads 'policy' or the manual's furniture as a section", () => {
    const headings = manualSectionHeadings(JBA_MANUAL_CHUNKS);
    expect(headings).toContain("Late Opening");
    expect(headings).not.toContain("Table of Contents");
    expect(headingsNamedIn("add the policy to the policy section", headings)).toEqual([]);
  });

  it("offers the manual's own near names, never chooses one", () => {
    expect(similarHeadings("late opening hours", JBA_MANUAL_CHUNKS)).toContain("Late Opening");
  });
});

describe("what the line cites after the change", () => {
  const section = (heading: string) => findManualSection(JBA_MANUAL_CHUNKS, [heading])!;
  const attendance = section("Attendance");
  const late = section("Late Opening");
  const dress = section("Dress Code for The Company");

  it("adds after what is there, once", () => {
    expect(nextPolicySections({ mode: "add", current: [attendance], named: [late, attendance] }).map((s) => s.heading)).toEqual([
      "Attendance",
      "Late Opening",
    ]);
  });

  it("replaces with only what was named", () => {
    expect(nextPolicySections({ mode: "replace", current: [attendance, late], named: [dress] }).map((s) => s.heading)).toEqual([
      "Dress Code for The Company",
    ]);
  });

  it("removes only what was named", () => {
    expect(nextPolicySections({ mode: "remove", current: [attendance, late], named: [late] }).map((s) => s.heading)).toEqual([
      "Attendance",
    ]);
  });
});

describe("a policy title in capitals is not a person", () => {
  it("reads Wren Halvorsen, and not Late Opening, as the employee", () => {
    expect(
      extractEmployeeNames("create corrective action for for Wren Halvorsen for Late Opening from the policy manual. It is a verbal warning"),
    ).toEqual(["Wren Halvorsen"]);
    expect(extractEmployeeNames("CA for Dana Moss about Dress Code")).toEqual(["Dana Moss"]);
  });

  it("still reads a name with one ordinary word in it", () => {
    expect(extractEmployeeNames("coaching form for Grace Early")).toEqual(["Grace Early"]);
  });
});

describe("the section Policy Violated names beside a box", () => {
  it("is a cited section that is not the box's own, from verified manual provenance only", () => {
    const provenance = {
      verified: true,
      source: "official_policy_manual",
      sections: [{ locator: "Attendance" }, { locator: "Visitors in the Workplace" }],
    };
    expect(citedBoxSections(provenance)).toEqual({ company_policies: "Visitors in the Workplace" });
    expect(citedBoxSections({ ...provenance, sections: [{ locator: "Attendance" }] })).toEqual({});
    /* A late opening is named beside Tardiness; Attendance, its own section, is not. */
    expect(citedBoxSections({ ...provenance, sections: [{ locator: "Late Opening" }, { locator: "Attendance" }] })).toEqual({
      tardiness: "Late Opening",
    });
    expect(citedBoxSections({ ...provenance, verified: false })).toEqual({});
    expect(citedBoxSections(undefined)).toEqual({});
  });
});
