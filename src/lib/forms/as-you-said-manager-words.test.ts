import { afterEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";

/*
 * AS_YOU_SAID_MANAGER_WORDS_ENABLED (live chat, 4 Nov 2026; the employee invented). The card said
 * "**Policy:** Late Opening, as you said. I'll quote that section …" for leaving early and taking the spray
 * booths down early. The intent reader's heading went onto the turn as the app's own line (`ai/form-state.ts`
 * stateSentences), and the policy reader took it as the manager naming Late Opening.
 */
const REQUEST =
  "Write a CA for Isolde Brannock she is TC works at Omaha Pacific and on 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down the spray booths down at 8:11 PM before the Salon was closed.";
const WITH_APP_LINE = `The employee is Isolde Brannock. Policy reference: Late Opening, JBA Policy Manual p.15.\n${REQUEST}`;

afterEach(() => vi.unstubAllEnvs());

describe("AS_YOU_SAID_MANAGER_WORDS_ENABLED", () => {
  it("off: the app's \"Policy reference\" line reads as the manager naming Late Opening (the live card)", () => {
    const reading = readCaPolicy(WITH_APP_LINE);
    expect(reading.stated).toBe("late_opening");
    expect(caPolicyProposalLine(reading)).toMatch(/^\*\*Policy:\*\* Late Opening, as you said\./);
  });

  it("on: the app's line names nothing; the card does not say \"as you said\"", () => {
    vi.stubEnv("AS_YOU_SAID_MANAGER_WORDS_ENABLED", "true");
    const reading = readCaPolicy(WITH_APP_LINE);
    expect(reading.stated).not.toBe("late_opening");
    expect(caPolicyProposalLine(reading) ?? "").not.toMatch(/as you said/);
  });

  it("on: a policy the manager typed is still theirs", () => {
    vi.stubEnv("AS_YOU_SAID_MANAGER_WORDS_ENABLED", "true");
    const reading = readCaPolicy(`Policy reference: Late Opening, JBA Policy Manual p.15.\nwrite a CA for Isolde Brannock for late opening on 11/3/26`);
    expect(reading.stated).toBe("late_opening");
    expect(caPolicyProposalLine(reading)).toMatch(/Late Opening, as you said/);
  });
});
