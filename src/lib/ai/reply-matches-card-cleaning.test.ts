import { afterEach, describe, expect, it, vi } from "vitest";

import { withCleaningOtherPolicy } from "./reply-matches-card";
import type { AskResponse } from "./types";

/*
 * CLEANING_OTHER_EVERY_WORDING_ENABLED. QA's live eval ca-sales-negative-cleaning-duties (6 Nov 2026, 2 of 2 runs,
 * the person invented): "make a corrective action for Ansgar Whitlowe, he did not complete daily cleaning duties"
 * got a reply whose Policy line named the Standards of Conduct. This is such a reply, as the live model wrote it.
 */
const SAID = "make a corrective action for Ansgar Whitlowe, he did not complete daily cleaning duties";

function reply(issue: string, policy: string): AskResponse {
  return {
    content: [
      "I'll draft a **Corrective Action Form** for **Ansgar Whitlowe** from what you've described.",
      "",
      policy,
      "",
      "Standards of Conduct Policy, JBA Policy Manual p.12",
      "",
      "Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do.",
    ].join("\n"),
    formProposal: { templateKey: "dpoa", employeeName: "Ansgar Whitlowe", issue },
  } as unknown as AskResponse;
}

const LIVE = reply(
  "he did not complete daily cleaning duties",
  "**Policy:** this reads as **Standards of Conduct** — assigned work that wasn't completed. I'll check it against the current policy manual and quote that section on the draft.",
);

afterEach(() => vi.unstubAllEnvs());

describe("withCleaningOtherPolicy", () => {
  it("off: the live reply stands (the failure)", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    expect(withCleaningOtherPolicy(LIVE, SAID)).toBe(LIVE);
  });

  it("on: the Policy line is Other and the Standards of Conduct citation goes", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CLEANING_OTHER_EVERY_WORDING_ENABLED", "true");
    const content = withCleaningOtherPolicy(LIVE, SAID).content;
    expect(content).toMatch(/^\*\*Policy:\*\* Other — cleaning duties left undone/m);
    expect(content).not.toMatch(/reads as \*\*Standards of Conduct|Standards of Conduct Policy, JBA Policy Manual/);
    // Without the turn's message (FORM_NAME off), the card's Issue is read.
    expect(withCleaningOtherPolicy(LIVE, undefined).content).toMatch(/^\*\*Policy:\*\* Other\b/m);
  });

  it("on: an account that is not cleaning keeps its Standards of Conduct", () => {
    vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
    vi.stubEnv("CLEANING_OTHER_EVERY_WORDING_ENABLED", "true");
    const woven = reply("he did not complete his Woven training by the deadline", "**Policy:** Standards of Conduct — a required deadline that was missed.");
    expect(withCleaningOtherPolicy(woven, "make a CA for Ansgar Whitlowe, he did not complete his Woven training by the deadline")).toBe(woven);
    const named = reply("he did not complete daily cleaning duties", "**Policy:** Standards of Conduct, as you said.");
    expect(withCleaningOtherPolicy(named, `${SAID}. the policy is standards of conduct`)).toBe(named);
  });
});
