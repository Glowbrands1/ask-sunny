import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { statedPayrollDeduct } from "./payroll-deduct-answer";

/* PAYROLL_BARE_SENTENCE_ENABLED. Pau's P15 wording verbatim (invented name). The replay case runs the route. */
const P15 = "I need a term CA for Delphine Marrow. Didn't show up for her opening shift. Payroll deduction.";

describe("PAYROLL_BARE_SENTENCE_ENABLED", () => {
  // QA (11 Nov 2026, before the flip): each test starts with the flag unset, whatever the env says, and the env's own
  // value is put back after, so "off" still holds in a flags-on run.
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.PAYROLL_BARE_SENTENCE_ENABLED;
    delete process.env.PAYROLL_BARE_SENTENCE_ENABLED;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.PAYROLL_BARE_SENTENCE_ENABLED;
    else process.env.PAYROLL_BARE_SENTENCE_ENABLED = saved;
  });

  it("off: P15's last sentence states nothing (as production)", () => {
    expect(statedPayrollDeduct(P15)).toBeNull();
  });

  it.each([P15, "Payroll deduction.", "payroll deduct", "verbal. Payroll deduction!"])("on: %s is a Yes", (said) => {
    process.env.PAYROLL_BARE_SENTENCE_ENABLED = "true";
    expect(statedPayrollDeduct(said)).toBe("yes");
  });

  it.each([
    ["Payroll deduction?", null],
    ["no payroll deduction.", "no"],
    ["payroll deduction is not applicable.", "no"],
    ["payroll deduction was waived.", "no"],
    ["maybe a payroll deduction.", null],
    ["she asked about payroll deduction.", null],
  ])("on, not a bare Yes: %s", (said, expected) => {
    process.env.PAYROLL_BARE_SENTENCE_ENABLED = "true";
    expect(statedPayrollDeduct(said)).toBe(expected);
  });
});
