import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { caPolicyProposalLine, cleaningIncidentPhrase, readCaPolicy } from "./ca-policy";
import { withoutUnreasonedConduct } from "./ca-conduct-reason";

/*
 * Pau's ruling (cleaning duties not done are Other, with no Standards of
 * Conduct), QA's sf-s15 trace, 5 Nov 2026: QA's exact wording, the person
 * invented. Behind CA_SALES_POLICY_ENABLED; no new words (the cleaning reader
 * already in ca-policy.ts).
 */
const SF_S15 = "Write me a CA for Isolde Brannock for failing to complete opening duties. Isolde did not complete daily cleaning duties. on november 2, 2026";
const WOVEN = "Write me a CA for Isolde Brannock. Isolde did not complete her Woven training by the deadline on november 2, 2026";
const OFFERED = ["attendance_policy", "standards_of_conduct", "dress_code", "other"];

beforeEach(() => {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "");
  vi.stubEnv("POLICY_CLEANING_INCIDENT_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");

const draft = () => ({ values: {} as Record<string, string>, checked: { offense_type: ["standards_of_conduct"] } as Record<string, string[]> });
const guard = (notes: string, basis: "conduct" | "upkeep_or_task" | null = null) =>
  withoutUnreasonedConduct({ draft: draft(), reading: readCaPolicy(notes), stated: false, offered: OFFERED, notes, basis });

describe("CA_SALES_POLICY_ENABLED: cleaning left undone is Other", () => {
  it("off: the card reads as the Standards of Conduct, and the draft's tick stands (as before)", () => {
    const reading = readCaPolicy(SF_S15);
    expect(reading.suggestion).toBe("standards_of_conduct");
    expect(reading.other).toBeUndefined();
    expect(caPolicyProposalLine(reading)).toMatch(/this reads as \*\*Standards of Conduct\*\*/);
    expect(guard(SF_S15)).toBeNull();
  });

  it("POLICY_CLEANING_INCIDENT_ENABLED on, CA_SALES off: the cleaning reader and the reading are as before (no Other mark)", () => {
    vi.stubEnv("POLICY_CLEANING_INCIDENT_ENABLED", "true");
    expect(cleaningIncidentPhrase(SF_S15)).toBe("did not complete daily cleaning");
    const reading = readCaPolicy(SF_S15);
    expect(reading.other).toBeUndefined();
    expect(reading.topics).not.toContain("task");
    expect(guard(SF_S15)).toBeNull();
  });

  it("on: the reading keeps its task topic, loses the Standards of Conduct suggestion, and the card says Other", () => {
    on();
    const reading = readCaPolicy(SF_S15);
    expect(reading).toMatchObject({ suggestion: null, other: "cleaning", topics: ["task"] });
    const line = caPolicyProposalLine(reading)!;
    expect(line).toMatch(/^\*\*Policy:\*\* Other\b/);
    expect(line).not.toMatch(/reads as \*\*Standards of Conduct/);
  });

  it("on: a draft ticked Standards of Conduct with no basis becomes Other (a plain box: nothing written beside it)", () => {
    on();
    const moved = guard(SF_S15)!;
    expect(moved.checked.offense_type).toEqual(["other"]);
    expect(moved.values).toEqual({});
  });

  it("on: the model's own basis still decides when it sends one (\"conduct\" keeps the tick)", () => {
    on();
    expect(guard(SF_S15, "conduct")).toBeNull();
  });

  it("on, negatives: Woven training past due and a policy the manager named keep the Standards of Conduct", () => {
    on();
    expect(readCaPolicy(WOVEN).other).toBeUndefined();
    expect(guard(WOVEN)).toBeNull();
    const named = `${SF_S15}. The policy violated is standards of conduct.`;
    expect(readCaPolicy(named).other).toBeUndefined();
  });
});
