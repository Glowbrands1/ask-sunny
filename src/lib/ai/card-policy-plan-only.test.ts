import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChatFormProposal } from "@/types";

import { withCardPolicyPlanOnly } from "./card-policy-plan-only";
import type { AskResponse } from "./types";

/**
 * CARD_POLICY_PLAN_ONLY_ENABLED (QA, 8 Nov 2026): the shape of the bad turn in QA's replays of 1f5850e6 (the person is
 * invented). The Policy line cites Standards of Conduct; the plan and the sources also carry Evaluations and Raises.
 */
const CA = { proposalId: "p", templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Rowan Kestrel" } as unknown as ChatFormProposal;
const POLICY = "**Policy:** Standards of Conduct — sales performance against goals. I'll cite that section of the current policy manual, with its page, on the draft; tell me if a different policy applies.";
const BAD_PLAN =
  "**Action Plan:** Management will review the Standards of Conduct and Evaluations and Raises policies with Rowan. Future policy violations may result in additional corrective action up to and including termination of employment.";
const SOC = { excerpt: "Standards of Conduct. Standards of Conduct\nThe Company asks …", locator: "Page 12" };
const EVAL = { excerpt: "Evaluations and Raises. Employees are entitled to a review …", locator: "Page 34 — Evaluations and Raises" };

function reply(lines: string[], citations: unknown[] = [SOC, EVAL], formProposal: ChatFormProposal = CA): AskResponse {
  return { content: lines.join("\n\n"), citations, formProposal } as unknown as AskResponse;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withCardPolicyPlanOnly", () => {
  const bad = () => reply([POLICY, "Standards of Conduct Policy, JBA Policy Manual p.12", "Evaluations and Raises Policy, JBA Policy Manual p.34", BAD_PLAN]);

  it("off: the reply is as built", () => {
    const built = bad();
    expect(withCardPolicyPlanOnly(built)).toBe(built);
  });

  describe("on", () => {
    it("the plan, the citation lines and the citations keep only Standards of Conduct", () => {
      vi.stubEnv("CARD_POLICY_PLAN_ONLY_ENABLED", "true");
      const out = withCardPolicyPlanOnly(bad());
      expect(out.content).toContain("**Action Plan:** Management will review the Standards of Conduct policy with Rowan.");
      expect(out.content).toContain("Standards of Conduct Policy, JBA Policy Manual p.12");
      expect(out.content).not.toMatch(/Evaluations and Raises/);
      expect(out.citations).toEqual([SOC]);
    });

    it("a plan that already names only the card's policy is left as it is", () => {
      vi.stubEnv("CARD_POLICY_PLAN_ONLY_ENABLED", "true");
      const built = reply([POLICY, "Standards of Conduct Policy, JBA Policy Manual p.12", "**Action Plan:** Management will review the Standards of Conduct policy with Rowan."], [SOC]);
      expect(withCardPolicyPlanOnly(built)).toBe(built);
    });

    it("a manager-named policy (\", as you said\") is the card's policy", () => {
      vi.stubEnv("CARD_POLICY_PLAN_ONLY_ENABLED", "true");
      const out = withCardPolicyPlanOnly(
        reply(["**Policy:** Attendance, as you said. I'll quote that section from the current policy manual on the draft.", "**Action Plan:** Management will review the Attendance and Evaluations and Raises policies with Rowan."], [EVAL]),
      );
      expect(out.content).toContain("Management will review the Attendance policy with Rowan.");
      // No citation for the card's own policy: the citations are left as they were, never emptied.
      expect(out.citations).toEqual([EVAL]);
    });

    it("no Policy line: unchanged", () => {
      vi.stubEnv("CARD_POLICY_PLAN_ONLY_ENABLED", "true");
      const built = reply([BAD_PLAN]);
      expect(withCardPolicyPlanOnly(built)).toBe(built);
    });

    it("a plan that names none of the card's policy is left alone, never emptied", () => {
      vi.stubEnv("CARD_POLICY_PLAN_ONLY_ENABLED", "true");
      const built = reply([POLICY, "**Action Plan:** Management will review the applicable company policy with Rowan."], [SOC]);
      expect(withCardPolicyPlanOnly(built)).toBe(built);
    });

    it("a Coaching card is left alone", () => {
      vi.stubEnv("CARD_POLICY_PLAN_ONLY_ENABLED", "true");
      const built = reply([POLICY, BAD_PLAN], [SOC, EVAL], { ...CA, templateKey: "coaching", templateName: "Coaching Form" } as ChatFormProposal);
      expect(withCardPolicyPlanOnly(built)).toBe(built);
    });
  });
});
