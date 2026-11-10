import { afterEach, describe, expect, it, vi } from "vitest";

import { withLateOpeningNeedsOpening } from "./late-opening-needs-opening";

// Pau via QA, sf-s25 (5 Nov 2026), the manager's words; the person invented.
const SAID =
  "Write a CA for Wynne Sarrow she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";
const CARD = {
  content:
    "Here is what I would put on a **Corrective Action Form**.\n\nLate Opening Policy, JBA Policy Manual p.15\n\n**Date:** 11/3/2026\n\n**Action Plan:** Management will review the Late Opening policy with Wynne. Future policy violations may result in additional corrective action.",
  formProposal: { templateKey: "dpoa" },
};

describe("LATE_OPENING_NEEDS_OPENING_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the card is left as it is", () => {
    expect(withLateOpeningNeedsOpening(CARD, [SAID])).toEqual(CARD);
  });

  it("on: a closing account cites no Late Opening; the Action Plan reviews the applicable company policy", () => {
    vi.stubEnv("LATE_OPENING_NEEDS_OPENING_ENABLED", "true");
    const out = withLateOpeningNeedsOpening(CARD, [SAID]);
    expect(out.content).not.toMatch(/Late Opening/);
    expect(out.content).toMatch(/review the applicable company policy with Wynne/);
    expect(out.content).toMatch(/\*\*Date:\*\* 11\/3\/2026/);
  });

  it("on: an account that says opening keeps Late Opening", () => {
    vi.stubEnv("LATE_OPENING_NEEDS_OPENING_ENABLED", "true");
    expect(withLateOpeningNeedsOpening(CARD, ["make me a CA for Wynne Sarrow for being late to opening this morning, the salon was closed until 9:20"])).toEqual(CARD);
  });
});
