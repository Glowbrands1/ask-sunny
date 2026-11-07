import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, readCaPolicy } from "./ca-policy";

/**
 * AS_YOU_SAID_APP_READ_ENABLED (QA's Sunny gate, 7 Nov 2026). With AS_YOU_SAID_MANAGER_WORDS_ENABLED on, a CA whose
 * only Policy line was "Late Opening, as you said" — read from the app's own line on the turn — lost the line.
 * The turn as the card reads it: the manager's words, then the app's own line (`ai/form-state.ts`).
 */
const LATE = "make me a CA for Remy Calder for being late to opening this morning\nPolicy reference: Late Opening Policy, JBA Policy Manual p.15.";
const NAMED = "create a verbal CA for Remy Calder for violating the late opening policy on 11-2-26\nPolicy reference: Late Opening Policy, JBA Policy Manual p.15.";
const NONE = "make me a CA for Remy Calder for being late to opening this morning";

const line = (text: string) => caPolicyProposalLine(readCaPolicy(text)) ?? "";

describe("AS_YOU_SAID_APP_READ_ENABLED", () => {
  beforeEach(() => vi.stubEnv("AS_YOU_SAID_MANAGER_WORDS_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("off, with AS_YOU_SAID on: the app-read policy has no Policy line (the gate's regression)", () => {
    expect(line(LATE)).toBe("");
  });

  it("on: the app-read policy is said as a reading, never \"as you said\"", () => {
    vi.stubEnv("AS_YOU_SAID_APP_READ_ENABLED", "true");
    expect(line(LATE)).toMatch(/^\*\*Policy:\*\* Late Opening — from what you described\./);
    expect(line(LATE)).not.toMatch(/as you said/i);
  });

  it("on: a policy the manager named is still theirs (\"as you said\")", () => {
    vi.stubEnv("AS_YOU_SAID_APP_READ_ENABLED", "true");
    expect(line(NAMED)).toMatch(/Late Opening, as you said/);
  });

  it("on: with no app line on the turn, nothing changes", () => {
    const off = line(NONE);
    vi.stubEnv("AS_YOU_SAID_APP_READ_ENABLED", "true");
    expect(line(NONE)).toBe(off);
  });

  it("on, with AS_YOU_SAID off: the reading is as before AS_YOU_SAID (\"as you said\" from the whole turn)", () => {
    vi.stubEnv("AS_YOU_SAID_MANAGER_WORDS_ENABLED", "false");
    const before = line(LATE);
    vi.stubEnv("AS_YOU_SAID_APP_READ_ENABLED", "true");
    expect(line(LATE)).toBe(before);
  });
});
