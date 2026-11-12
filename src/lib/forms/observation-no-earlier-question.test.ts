import { afterEach, describe, expect, it, vi } from "vitest";

import { withObservationNoEarlierQuestion } from "./observation-no-earlier-question";

// Pau via QA, sf-s25 (5 Nov 2026), the manager's words; the person invented.
const ASKED = "What policy would it be if a tanning consultant did not complete the closing correctly and i have already talked to her about it";
const ACCOUNT = "Wynne Sarrow she is TC works and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01.";
const CARD = {
  content: `Here is what I would put on a **Corrective Action Form**.\n\n**Observation of Offense:** ${ASKED} ${ACCOUNT}\n\n**Action Plan:** Management will review the applicable company policy with Wynne.`,
  formProposal: { issue: `${ASKED} ${ACCOUNT}` },
};
const EARLIER = ["closing policy", ASKED];

describe("OBSERVATION_NO_EARLIER_QUESTION_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the Observation opens with the earlier question (the bug)", () => {
    expect(withObservationNoEarlierQuestion(CARD, EARLIER)).toEqual(CARD);
  });

  it("on: the Observation and the issue start after the earlier question", () => {
    vi.stubEnv("OBSERVATION_NO_EARLIER_QUESTION_ENABLED", "true");
    const out = withObservationNoEarlierQuestion(CARD, EARLIER);
    expect(out.content).toContain(`**Observation of Offense:** ${ACCOUNT}`);
    expect(out.content).not.toMatch(/What policy would it be/);
    expect(out.formProposal.issue).toBe(ACCOUNT);
  });

  it("on: an earlier turn that states, or an Observation that is all question, is left as it is", () => {
    vi.stubEnv("OBSERVATION_NO_EARLIER_QUESTION_ENABLED", "true");
    const stated = { content: `**Observation of Offense:** She left early on 11/3/26 and the booths were down.`, formProposal: { issue: null } };
    expect(withObservationNoEarlierQuestion(stated, ["She left early on 11/3/26"])).toEqual(stated);
    const allQuestion = { content: `**Observation of Offense:** ${ASKED}`, formProposal: { issue: null } };
    expect(withObservationNoEarlierQuestion(allQuestion, EARLIER)).toEqual(allQuestion);
  });
});
