import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { shortagePolicyPage } from "./form-card-slots";

/*
 * CITATION_PAGE_AGREES_ENABLED (QA's ruling (b), 10 Nov 2026): a cash-drawer CA card read "**Standards of Conduct**
 * (page 13)" on its Policy line and "Standards of Conduct Policy, JBA Policy Manual p.12" under it. The managers' wording is
 * from QA's round-9 live check; the person is invented.
 */
const POLICY_LINE =
  '**Policy:** "cash drawer was short" reads as the policy manual\'s **Standards of Conduct** (page 13). I\'ll quote it on the draft under **Standards of Conduct** — tell me if a different policy applies.';
const CA = { templateKey: "dpoa", templateName: "Corrective Action Form" } as ChatFormProposal;
const COACHING = { templateKey: "coaching", templateName: "Coaching Form" } as ChatFormProposal;
const SOC = { heading: "Standards of Conduct", page: 12 };

describe("CITATION_PAGE_AGREES_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());
  const on = (value: boolean) => {
    vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true");
    vi.stubEnv("CITATION_PAGE_AGREES_ENABLED", value ? "true" : "");
  };

  it.each([
    "create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3",
    "I need another corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3",
    "I need another corrective action for Corwin Ashgrove for his cash drawer being short $20 on 11/3",
  ])("%s: the CA's citation takes the Policy line's page 13", (said) => {
    on(true);
    expect(shortagePolicyPage(POLICY_LINE, SOC, CA, said)).toEqual({ heading: "Standards of Conduct", page: 13 });
  });

  it("off: the citation keeps the page it had", () => {
    on(false);
    expect(shortagePolicyPage(POLICY_LINE, SOC, CA, "create a corrective action for Corwin Ashgrove, his cash drawer was short $20 on 11/3")).toEqual(SOC);
  });

  it("a Sales / MSB CA keeps p.12", () => {
    on(true);
    const msb = "**Policy:** Standards of Conduct — Must See Behaviors (MSB). I'll cite that section of the current policy manual, with its page, on the draft.";
    expect(shortagePolicyPage(msb, SOC, CA, "create a corrective action for Corwin Ashgrove, he did not meet his MSB goal this week")).toEqual(SOC);
  });

  it("only a Corrective Action card, and only a shortage", () => {
    on(true);
    expect(shortagePolicyPage(POLICY_LINE, SOC, COACHING, "create a coaching form for Corwin Ashgrove, his cash drawer was short $20 on 11/3")).toEqual(SOC);
    expect(shortagePolicyPage(POLICY_LINE, SOC, CA, "create a corrective action for Corwin Ashgrove, he left the front desk unattended on 11/6/26")).toEqual(SOC);
    expect(shortagePolicyPage(POLICY_LINE, SOC, CA, "create a corrective action for Corwin Ashgrove, the drawer was not short")).toEqual(SOC);
  });
});
