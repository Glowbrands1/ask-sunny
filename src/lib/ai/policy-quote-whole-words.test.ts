import { afterEach, describe, expect, it, vi } from "vitest";

import { policyQuote } from "./violation-policy";

/*
 * Port from Ask Bubbles (Gate-Bubbles-2's POLICY_CITATION gate, 12 Nov 2026): the quoted manual passage was cut
 * mid-word ("… does not count as calling i") and could end on a stray "*". The pack's manual wording, invented.
 */
const LONG =
  "Each employee knows their schedule and arrives on time. Poor punctuality and absences hurt the team and the client. " +
  "An employee who cannot work a scheduled shift finds a coworker to cover it (See Shift Replacement). A no call or no " +
  "show for a scheduled shift may lead to termination. An employee who will be tardy or absent calls their manager on " +
  "duty at least 2 hours before the shift, unless an emergency makes that impossible. A text message to a manager does " +
  "not count as calling in, and the employee still calls.";

afterEach(() => vi.unstubAllEnvs());

describe("POLICY_QUOTE_WHOLE_WORDS_ENABLED: the quote", () => {
  it("ends at a sentence inside the limit, with an ellipsis, never mid-word", () => {
    const quote = policyQuote(LONG);
    expect(quote.length).toBeLessThanOrEqual(502);
    expect(quote).toMatch(/\. …$/);
    expect(quote).not.toMatch(/calling i$/);
  });

  it("drops emphasis markers, so no stray '*' ends it", () => {
    expect(policyQuote("**Late Opening.** An employee assigned to open must arrive on time.*")).toBe(
      "Late Opening. An employee assigned to open must arrive on time.",
    );
  });

  it("a short passage is kept whole", () => {
    expect(policyQuote("Short policy text.")).toBe("Short policy text.");
  });
});
