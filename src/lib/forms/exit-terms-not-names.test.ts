import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { employeeState, managerContext } from "./proposal";
import { checkProposalIsCurrent } from "./proposal-currency";

/**
 * EXIT_TERMS_NOT_NAMES_ENABLED. A manager's exit in the sibling app, 29 Oct
 * 2026, in this app's words (the person's name and address invented). With the person not on
 * the roster (a new hire not yet in Woven), the chat asked "Which of them is
 * this Resignation/Exit Form for — Marnie Holloway, drop wage or forfeit
 * bonus?". The resolver's candidates are what that question lists.
 */
const HER_WORDS =
  "create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. drop wage and forfeit bonus. not eligible for rehire. marnie's address is 125 Ne Oakfield Lane, kearney, NE. 68847";

const people = () => {
  const { resolution } = employeeState(managerContext([], { content: HER_WORDS }));
  return resolution.kind === "ambiguous" ? resolution.candidates : resolution.kind === "resolved" ? [resolution.employeeName] : [];
};

describe("the exit form's shortcut words name nobody", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: drop wage and forfeit bonus are read as people (the live question)", () => {
    expect(people()).toEqual(expect.arrayContaining(["drop wage", "forfeit bonus"]));
  });

  it("on: they are not", () => {
    vi.stubEnv("EXIT_TERMS_NOT_NAMES_ENABLED", "true");
    expect(people()).toContain("marnie holloway");
    expect(people()).not.toContain("drop wage");
    expect(people()).not.toContain("forfeit bonus");
  });

  it("on, with no roster (a new hire): Create takes the card for her as made of the form's words, not people", () => {
    vi.stubEnv("EXIT_TERMS_NOT_NAMES_ENABLED", "true");
    const result = checkProposalIsCurrent({ conversation: [{ role: "user", content: HER_WORDS }], templateKey: "stc-exit", employeeName: "Marnie Holloway" });
    expect(result.current || !/drop wage|forfeit bonus/.test(result.reason)).toBe(true);
  });

  it.each(["drop wage", "forfeit bonus", "drop wage and forfeit bonus", "salon key", "salon items not returned", "no notice given", "not eligible for rehire", "immediate voluntary term", "payroll deduct applies"])(
    'on: "%s" alone is never a person',
    (phrase) => {
      vi.stubEnv("EXIT_TERMS_NOT_NAMES_ENABLED", "true");
      const { resolution } = employeeState(managerContext([], { content: `create an exit for marnie holloway. ${phrase}.` }));
      const names = resolution.kind === "ambiguous" ? resolution.candidates : resolution.kind === "resolved" ? [resolution.employeeName] : [];
      expect(names.map((name) => name.toLowerCase())).not.toContain(phrase);
    },
  );

  it("a real second person is still a person", () => {
    vi.stubEnv("EXIT_TERMS_NOT_NAMES_ENABLED", "true");
    const { resolution } = employeeState(managerContext([], { content: "create an exit for marnie holloway and rowan kestrel" }));
    expect(resolution.kind === "ambiguous" ? resolution.candidates : []).toEqual(expect.arrayContaining(["marnie holloway", "rowan kestrel"]));
  });
});
