import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskRequest } from "@/lib/ai/types";

import {
  acceptedOffRoster,
  acceptedOffRosterName,
  installAcceptedOffRoster,
  offRosterOffer,
  offeredOffRosterName,
  withOffRosterAnswer,
} from "./off-roster-confirm";

/**
 * OFF_ROSTER_CONFIRM_ENABLED (QA, the flip-3 gate, 6 Nov 2026). The end-to-end cases are in the replay pack
 * (`nov6-off-roster-confirm-cases.ts`); these pin the answer reading, and QA's rule that a "use <name>" with a
 * DIFFERENT name than the one offered is never taken. The names are invented.
 */
const OFFER = `I couldn't find **Zebulon Marchbanks** in the Woven roster, so that name is not on the form. ${offRosterOffer("Zebulon Marchbanks")}\n\nWho is this form for? Tell me the employee's full name.`;

function request(question: string): AskRequest {
  return {
    question,
    mode: "answer",
    history: [
      { id: "u1", role: "user", content: "create a ca form for Zebulon Marchbanks, he was late opening the salon on 11/2" },
      { id: "a1", role: "assistant", content: OFFER },
    ],
  } as unknown as AskRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
  installAcceptedOffRoster(() => undefined);
});

describe("the offer's name", () => {
  it("is read from the app's own offer", () => {
    expect(offeredOffRosterName(OFFER)).toBe("Zebulon Marchbanks");
    expect(offeredOffRosterName("Who is this form for? Tell me the employee's full name.")).toBeNull();
  });
});

describe("the answer to the offer", () => {
  it.each([
    "use Zebulon Marchbanks",
    "Use zebulon marchbanks.",
    "yes, use that name",
    "use that name",
    "yes",
    "Zebulon Marchbanks",
  ])("%j takes the offered name", (answer) => {
    expect(acceptedOffRosterName(answer, "Zebulon Marchbanks")).toBe("Zebulon Marchbanks");
  });

  it.each(["use Zebulon Marchwood", "use Remy Calder", "Zebulon Marchwood", "no", "no, don't use that name", "not that name"])(
    "%j is not taken: another name is looked up as any name is",
    (answer) => {
      expect(acceptedOffRosterName(answer, "Zebulon Marchbanks")).toBeNull();
    },
  );

  it("with no offer, nothing is taken", () => {
    expect(acceptedOffRosterName("use Zebulon Marchbanks", null)).toBeNull();
  });
});

describe("OFF_ROSTER_CONFIRM_ENABLED on: the turn that takes the name", () => {
  it("is read as the manager's turn that typed it, and the name is the one taken", () => {
    vi.stubEnv("OFF_ROSTER_CONFIRM_ENABLED", "true");
    const taken = withOffRosterAnswer(request("yes, use that name"));
    expect(taken?.accepted).toBe("Zebulon Marchbanks");
    expect(taken?.request.question).toBe("create a ca form for Zebulon Marchbanks, he was late opening the salon on 11/2");
  });

  it("a different name is not taken, and the turn is read as typed", () => {
    vi.stubEnv("OFF_ROSTER_CONFIRM_ENABLED", "true");
    expect(withOffRosterAnswer(request("use Zebulon Marchwood"))).toBeNull();
  });
});

describe("OFF_ROSTER_CONFIRM_ENABLED off: as before", () => {
  it("no turn is rewritten and no name is taken", () => {
    installAcceptedOffRoster(() => "Zebulon Marchbanks");
    expect(withOffRosterAnswer(request("use Zebulon Marchbanks"))).toBeNull();
    expect(acceptedOffRoster()).toBeUndefined();
  });
});
