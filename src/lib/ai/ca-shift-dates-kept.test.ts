import { afterEach, describe, expect, it, vi } from "vitest";

import { describesIncident } from "@/lib/forms/corrective-action-intake";

import { withFirstNameAnswer } from "./first-name-suggest";
import type { AskRequest } from "./types";

/**
 * QA, Sunny live test (8 Nov 2026; the name invented and on no directory): shift dates given in a CA request were lost.
 * "make me CA for Rhea failing to complete shifts" → "Is this for **Rhea Calloway**? Tell me if that should change." →
 * "make me CA for Rhea Calloway failing to complete shifts 11/7 and 11/8" (also "… not showing up to her shifts on 11/7
 * and 11/8" and "Rhea Calloway 11/7 and 11/8"): the card's Observation was "failing to complete shifts", with no
 * dates and no date question. The replay pack covers the route (`nov8-ca-shift-dates-kept-cases.ts`).
 *
 * FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED: the answer that names the person in full keeps what it says besides the name.
 * SHIFT_ACCOUNT_IS_INCIDENT_ENABLED: "<name> not showing up to her shifts on …" is an account.
 */
const T1 = "make me CA for Rhea failing to complete shifts";
const ASKED = "Is this for **Rhea Calloway**? Tell me if that should change.";

function answer(reply: string): string {
  const request = {
    question: reply,
    mode: "standard",
    history: [
      { id: "m1", role: "user", content: T1, createdAt: "2026-11-08T00:00:00Z" },
      { id: "m1a", role: "assistant", content: ASKED, createdAt: "2026-11-08T00:00:00Z" },
    ],
  } as unknown as AskRequest;
  return withFirstNameAnswer(request).question;
}

describe("FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: \"Rhea Calloway 11/7 and 11/8\" is read as the name alone (the reported loss)", () => {
    vi.stubEnv("FIRST_NAME_SUGGEST_ENABLED", "true");
    expect(answer("Rhea Calloway 11/7 and 11/8")).toBe("make me CA for Rhea Calloway failing to complete shifts");
  });

  it("on: what the answer says besides the name follows the request", () => {
    vi.stubEnv("FIRST_NAME_SUGGEST_ENABLED", "true");
    vi.stubEnv("FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(answer("Rhea Calloway 11/7 and 11/8")).toBe("make me CA for Rhea Calloway failing to complete shifts 11/7 and 11/8");
  });

  it.each([
    // QA's live test of round 7 (9 Nov 2026): "… failing to complete shifts failing to complete shifts 11/7 and 11/8".
    ["Rhea Calloway failing to complete shifts 11/7 and 11/8", "make me CA for Rhea Calloway failing to complete shifts 11/7 and 11/8"],
    // QA's live test of round 7: "… failing to complete shifts not showing up to her shifts on 11/7 and 11/8".
    ["Rhea Calloway not showing up to her shifts on 11/7 and 11/8", "make me CA for Rhea Calloway not showing up to her shifts on 11/7 and 11/8"],
  ])("on: an answer that tells its own account replaces the request's (%s)", (reply, request) => {
    vi.stubEnv("FIRST_NAME_SUGGEST_ENABLED", "true");
    vi.stubEnv("FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(answer(reply)).toBe(request);
  });

  it.each([
    "make me CA for Rhea Calloway failing to complete shifts 11/7 and 11/8",
    "make me CA for Rhea Calloway not showing up to her shifts on 11/7 and 11/8",
  ])("on: an answer that asks for the form itself is the request (%s)", (reply) => {
    vi.stubEnv("FIRST_NAME_SUGGEST_ENABLED", "true");
    vi.stubEnv("FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(answer(reply)).toBe(reply);
  });

  it.each(["Rhea Calloway", "Rhea Calloway.", "yes"])("on: the name alone, or yes, as before (%s)", (reply) => {
    vi.stubEnv("FIRST_NAME_SUGGEST_ENABLED", "true");
    const before = answer(reply);
    vi.stubEnv("FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED", "true");
    expect(answer(reply)).toBe(before);
  });
});

describe("SHIFT_ACCOUNT_IS_INCIDENT_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());
  const SAID = "make me CA for Rhea Calloway not showing up to her shifts on 11/7 and 11/8";

  it("off: the request is read as no account (the reported empty Observation)", () => {
    expect(describesIncident(SAID)).toBe(false);
  });

  it.each([SAID, "Rhea Calloway failing to complete shifts", "ca for rhea calloway missing her shift on 11/7", "not completing her shifts"])(
    "on: a shift not shown up to, not completed or missed is an account (%s)",
    (said) => {
      vi.stubEnv("SHIFT_ACCOUNT_IS_INCIDENT_ENABLED", "true");
      expect(describesIncident(said)).toBe(true);
    },
  );

  it.each(["make me CA for Rhea Calloway", "she works the morning shift", "make me a CA for the shift lead"])("on: no shift account, as before (%s)", (said) => {
    const before = describesIncident(said);
    vi.stubEnv("SHIFT_ACCOUNT_IS_INCIDENT_ENABLED", "true");
    expect(describesIncident(said)).toBe(before);
  });
});
