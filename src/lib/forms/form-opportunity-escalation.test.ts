import { describe, expect, it } from "vitest";

import { detectFormOpportunity, suggestedTemplateKeys } from "./form-opportunity";

const read = (text: string) => detectFormOpportunity({ context: { text }, employeeKnown: true });
const keys = (text: string) => {
  const opportunity = read(text);
  return opportunity ? suggestedTemplateKeys({ opportunity, rolePlanKey: null }) : null;
};

/*
 * Ask Bubbles admin feedback, 16 Oct 2026 (ported from 8e3e81e).
 */
describe("a coaching conversation that did not work is offered the next rung — beside Coaching, never first", () => {
  it.each([
    "I have an employee Colene at our Grand Island location who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code",
    "I talked to her about being late and she was late again this week",
    "I already coached him on the dress code and he keeps coming in out of uniform",
    "I spoke with her about her attitude and it's continuing",
  ])("%j", (text) => {
    expect(keys(text)).toEqual(["coaching", "dpoa"]);
    expect(read(text)!.signals).toContain("prior coaching and recurrence");
  });

  it("is never the primary card", () => {
    expect(keys("I verbally coached her on dress code and she still is out of dress code")![0]).toBe("coaching");
  });
});

describe("and not otherwise", () => {
  it.each([
    // the first rung worked
    "I coached her about being late and she improved",
    // a first offence, nothing tried
    "She was out of dress code today",
    // a rota note
    "Jessica is on the late shift again",
  ])("%j does not offer a Corrective Action Form", (text) => {
    expect(keys(text) ?? []).not.toContain("dpoa");
  });

  it("an unknown employee raises nothing", () => {
    expect(detectFormOpportunity({ context: { text: "I coached her and she still is out of dress code" }, employeeKnown: false })).toBeNull();
  });
});
