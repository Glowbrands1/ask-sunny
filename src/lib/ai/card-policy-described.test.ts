import { afterEach, describe, expect, it } from "vitest";

import { wordsSupportHeading } from "@/lib/forms/official-policy-manual";

import { cardManualHeading } from "./form-card-slots";

/**
 * CARD_POLICY_DESCRIBED_ENABLED (Pau via QA, 5 Nov 2026, sf-s25; the manager's
 * words verbatim, person invented): a closing account's card cited "Late
 * Opening Policy, JBA Policy Manual p.15", the heading the intent read chose,
 * stored as "Policy reference: Late Opening, JBA Policy Manual p.15." ahead of
 * the manager's words.
 */
const CLOSING =
  "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";
const STORED = "The employee is Wynne Sarrow. It happened on 11/3/2026. Policy reference: Late Opening, JBA Policy Manual p.15.";

afterEach(() => {
  delete process.env.CARD_POLICY_DESCRIBED_ENABLED;
});

describe("a stored heading is cited only when the manager's words support it", () => {
  it("the closing account describes no late opening; a late opening does", () => {
    expect(wordsSupportHeading("Late Opening", CLOSING)).toBe(false);
    expect(wordsSupportHeading("Late Opening", "she opened the salon late on 11/2")).toBe(true);
    // A heading the table has no rule for is not contradicted.
    expect(wordsSupportHeading("Cell Phone/Smart Watch Policy", CLOSING)).toBe(true);
  });

  it("off, the stored Late Opening is the card's heading (the reported card)", () => {
    expect(cardManualHeading(`${STORED}\n${CLOSING}`)).toBe("Late Opening");
  });

  it("on, it is not; a late opening the manager described, or a policy they named, still is", () => {
    process.env.CARD_POLICY_DESCRIBED_ENABLED = "true";
    expect(cardManualHeading(`${STORED}\n${CLOSING}`)).toBeNull();
    expect(cardManualHeading(`${STORED}\nWrite a CA for Wynne Sarrow, she opened the salon late on 11/2`)).toBe("Late Opening");
    expect(cardManualHeading(`${STORED}\nWrite a CA for Wynne Sarrow under the Late Opening policy`)).toBe("Late Opening");
  });
});
