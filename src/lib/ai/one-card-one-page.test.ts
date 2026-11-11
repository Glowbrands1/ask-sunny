import { describe, expect, it } from "vitest";

import { policyAsShown } from "./form-card-slots";

/**
 * ONE_CARD_ONE_PAGE_ENABLED (QA, Sunny round 9 live, 9 Nov 2026; the person invented): the citation line takes the page the
 * card already gives that section. The live card read "**Policy:** "left the front desk unattended" reads as the policy
 * manual's **Standards of Conduct** (page 13)" over "Standards of Conduct Policy, JBA Policy Manual p.12". The route is in
 * the replay pack (`nov9-one-card-one-page-cases.ts`).
 */
const DESK =
  "I'll draft a **Corrective Action Form** for **Corwin Ashgrove** from what you've described, and check the applicable company policy before anything policy-related goes on it.\n\n**Policy:** \"left the front desk unattended\" reads as the policy manual's **Standards of Conduct** (page 13). I'll quote it on the draft under **Standards of Conduct** — tell me if a different policy applies.";
const SIBLING_LINE = '**Policy:** Standards of Conduct, from what you described ("left the front desk unattended") — the policy manual\'s section on page 13.';

describe("policyAsShown", () => {
  it("the saved heading takes the page the Policy line gives it (p.12 → p.13)", () => {
    expect(policyAsShown(DESK, { heading: "Standards of Conduct", page: 12 })).toEqual({ heading: "Standards of Conduct", page: 13 });
  });

  it("the sibling app's Policy line wording is read the same way", () => {
    expect(policyAsShown(SIBLING_LINE, { heading: "Standards of Conduct", page: 12 })).toEqual({ heading: "Standards of Conduct", page: 13 });
  });

  it("a Coaching card's own citation line gives the page", () => {
    expect(policyAsShown("Standards of Conduct Policy, JBA Policy Manual p.13", { heading: "Standards of Conduct", page: 12 })).toEqual({
      heading: "Standards of Conduct",
      page: 13,
    });
  });

  it("no saved heading: the section the Policy line names, with its page", () => {
    expect(policyAsShown(DESK, null)).toEqual({ heading: "Standards of Conduct", page: 13 });
  });

  it("a section the card gives no page keeps its own (Late Opening p.15)", () => {
    expect(policyAsShown("**Policy:** Late Opening, as you said.", { heading: "Late Opening", page: 15 })).toEqual({ heading: "Late Opening", page: 15 });
  });

  it("another section's page is never taken", () => {
    expect(policyAsShown(DESK, { heading: "Attendance", page: 14 })).toEqual({ heading: "Attendance", page: 14 });
  });
});
