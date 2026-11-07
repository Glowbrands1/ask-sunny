import { describe, expect, it } from "vitest";

import { citedPolicy } from "./policy-line";

const SOC = /standards of conduct/i;

describe("citedPolicy (QA, 7 Nov 2026): what the policy line cites, not which words it holds", () => {
  it("the Other line cites Other, though it names the Standards of Conduct to say it is not cited", () => {
    const line = "**Policy:** Other — cleaning duties left undone are recorded under Other on the Corrective Action Form, not the Standards of Conduct. Tell me if a different policy applies.";
    expect(citedPolicy(line)).toBe("Other");
    expect(citedPolicy(line)).not.toMatch(SOC);
  });

  it("negative: a line that cites the Standards of Conduct is still read as citing it, in each shape", () => {
    for (const line of [
      "**Policy:** Standards of Conduct — the bathrooms were left dirty at close. I'll cite that section of the current policy manual, with its page, on the draft; tell me if a different policy applies.",
      "**Policy:** Standards of Conduct, as you said. I'll quote that section from the current policy manual on the draft.",
      "**Policy:** this reads as **Standards of Conduct** — the bathrooms were left dirty. I'll check it against the current policy manual and quote that section on the draft.",
      "**Policy:** Standards of Conduct, from what you described (\"dirty\") — the policy manual's section on page 12. I'll quote it on the draft; tell me if a different policy applies.",
    ]) {
      expect(citedPolicy(line), line).toMatch(SOC);
    }
  });

  it("other citations read as themselves", () => {
    expect(citedPolicy("**Policy:** Attendance — missing a shift is an absence from a scheduled shift.")).toBe("Attendance");
    expect(citedPolicy("")).toBe("");
  });
});
