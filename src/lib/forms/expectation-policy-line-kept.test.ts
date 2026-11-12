import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withoutInventedDetail } from "./account-only-policy-query";

/**
 * EXPECTATION_POLICY_LINE_KEPT_ENABLED (ported from Ask Bubbles: QA's audit there, 10 Nov 2026). With ACCOUNT_ONLY_POLICY_QUERY on (production),
 * `withoutInventedDetail` dropped the policy's Expectation from the saved Observation. The values are that case's
 * (Ask Bubbles' `form-edit-noop-guard-e2e.test.ts`) in this app's wording, with an invented person.
 */
const NOTES = "Create a Corrective Action for Jane Doe, she was late to open on 10-20-26";
const POLICY_LINE = "An employee scheduled to open is expected to arrive on time and have the salon ready to open.";
const VALUE = `Observed:\nJane Doe was late to open on October 20, 2026.\nExpectation:\n${POLICY_LINE}`;
const FLAGS = ["ACCOUNT_ONLY_POLICY_QUERY_ENABLED", "EXPECTATION_POLICY_LINE_KEPT_ENABLED"];

function run(value: string, notes = NOTES): string {
  return withoutInventedDetail({ observation: value }, new Set(["observation"]), {
    notes,
    managerWords: () => "Observed:\nshe was late to open on 10-20-26",
    formDate: "October 20, 2026",
    employeeName: "Jane Doe",
    datesIn: () => [],
  }).observation!;
}

describe("EXPECTATION_POLICY_LINE_KEPT: the policy's expectation of every employee is kept", () => {
  beforeEach(() => {
    process.env.ACCOUNT_ONLY_POLICY_QUERY_ENABLED = "true";
  });
  afterEach(() => {
    for (const flag of FLAGS) delete process.env[flag];
  });

  it("flag off (as before, the defect): the Expectation sentence is dropped", () => {
    expect(run(VALUE)).not.toContain(POLICY_LINE);
  });

  it("flag on: the Expectation sentence is kept, and the value is unchanged", () => {
    process.env.EXPECTATION_POLICY_LINE_KEPT_ENABLED = "true";
    expect(run(VALUE)).toBe(VALUE);
  });

  it("flag on: a sentence about the employee themself that adds a duty is still taken out", () => {
    process.env.EXPECTATION_POLICY_LINE_KEPT_ENABLED = "true";
    const notes = "Create a Corrective Action for Jane Doe, she was late on 10-20-26";
    const value = `Observed:\nJane Doe was late on October 20, 2026.\nExpectation:\nJane is expected to be on time for her opening shift. ${POLICY_LINE.replace("open", "work").replace(" and have the salon ready to open", "")}`;
    const out = run(value, notes);
    expect(out).not.toMatch(/opening shift/);
    expect(out).toContain("An employee scheduled to work is expected to arrive on time.");
  });

  // Ported from Ask Bubbles (Gate-Bubbles-5, 2f2b8517): exempt only from "scheduled to"; "open" is still checked.
  it("flag on: a general expectation about opening goes when the manager never said open", () => {
    process.env.EXPECTATION_POLICY_LINE_KEPT_ENABLED = "true";
    const notes = "create a CA form for jane doe at kearney. she was late on the 2nd yes payroll deduct $25";
    const line = "An employee assigned to open the salon is expected to arrive on time and ready to work at the start of the scheduled shift.";
    const out = run(`Observed:\nJane Doe was late on October 20, 2026.\nExpectation:\n${line}`, notes);
    expect(out).not.toContain(line);
    expect(out).not.toMatch(/\bopen/i);
  });

  it("flag on: a general expectation scheduled to work, with no other new detail, is kept", () => {
    process.env.EXPECTATION_POLICY_LINE_KEPT_ENABLED = "true";
    const line = "An employee scheduled to work is expected to arrive on time.";
    const notes = "Create a Corrective Action for Jane Doe, she was late on 10-20-26";
    expect(run(`Observed:\nJane Doe was late on October 20, 2026.\nExpectation:\n${line}`, notes)).toContain(line);
  });

  it("flag on: the Observed section is read as before", () => {
    process.env.EXPECTATION_POLICY_LINE_KEPT_ENABLED = "true";
    const notes = "Create a Corrective Action for Jane Doe, she was late on 10-20-26";
    const out = run("Observed:\nEmployees must open on time; Jane Doe was late to open on October 20, 2026.", notes);
    expect(out).not.toMatch(/Employees must open/);
  });
});
