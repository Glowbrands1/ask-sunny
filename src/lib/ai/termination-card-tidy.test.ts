import { afterEach, describe, expect, it, vi } from "vitest";

import { withTerminationStated } from "./termination-stated";
import type { AskRequest, AskResponse } from "./types";

/*
 * TERMINATION_CARD_TIDY_ENABLED (ported from the sibling app: QA's 17o live notes, 12 Nov 2026). On the sibling's card a
 * line follows the Action plan; the plan-line pattern took the line break after it, so the next line ran on. Here the
 * plan is the card's last line today; this pins that a line after it keeps its blank line with the flag. Invented person.
 */
const CARD = [
  "I'll draft a **Corrective Action Form** for **Marnie Holloway** from what you've described.",
  "",
  "Is this new corrective action a **Verbal Warning** or a **Written Warning**? Tell me here, or tick it on the form — I won't choose it for you.",
  "",
  "**Action Plan:** Management will review the Attendance policy with Marnie. Future policy violations may result in additional corrective action up to and including termination of employment.",
  "",
  "**Position:** Tanning Consultant, from Woven — tell me if that has changed.",
].join("\n");
const response = { content: CARD, citations: [], formProposal: { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Marnie Holloway" } } as unknown as AskResponse;
const request = { question: "I need a term CA for Marnie Holloway, no call no show.", history: [] } as unknown as AskRequest;

afterEach(() => vi.unstubAllEnvs());

describe("TERMINATION_CARD_TIDY_ENABLED", () => {
  it("off: the line after the plan runs on (as before)", () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    vi.stubEnv("TERMINATION_CARD_TIDY_ENABLED", "false");
    expect(withTerminationStated(response, request).content).toMatch(/progressive corrective action plan\.\n\*\*Position:\*\*/);
  });

  it("on: the plan line keeps its blank line before the next", () => {
    vi.stubEnv("TERMINATION_STATED_TICKS_ENABLED", "true");
    vi.stubEnv("TERMINATION_CARD_TIDY_ENABLED", "true");
    expect(withTerminationStated(response, request).content).toMatch(/progressive corrective action plan\.\n\n\*\*Position:\*\*/);
  });
});
