import { afterEach, describe, expect, it } from "vitest";

import { readsAsTeamSubject } from "./team-subject";

/**
 * QA-6 negation probes, 26 Oct 2026 (CARD_NEVER_SILENT_ENABLED on): a negated
 * chatty team phrase, or one in a turn that names a person, made the team
 * card. Names invented.
 */
const FLAG = "CARD_NEVER_SILENT_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const sentence = (text: string) => text[0]!.toUpperCase() + text.slice(1);

describe("CARD_NEVER_SILENT_ENABLED on: a negated or named chatty team phrase is not the team", () => {
  it.each([
    "do not make it generic for the whole team",
    "never reuse for any team member",
    "do not leave the employee name blank",
    "leave the name blank for Rowan Pell",
    "make it generic for the whole team except Rowan Pell",
  ])("'%s' is not the team, in lowercase and sentence case", (turn) => {
    process.env[FLAG] = "on";
    expect(readsAsTeamSubject(turn)).toBe(false);
    expect(readsAsTeamSubject(sentence(turn))).toBe(false);
  });

  it.each([
    "I want a coaching form I can reuse for any team member, so please leave the employee name blank and make it generic for the whole team",
    "need a coaching form for team not signing documents",
    "Please make it generic for the whole team",
  ])("'%s' is still the team", (turn) => {
    process.env[FLAG] = "on";
    expect(readsAsTeamSubject(turn)).toBe(true);
  });

  it("'not for the whole team, just for Rowan Pell' is not the team", () => {
    process.env[FLAG] = "on";
    expect(readsAsTeamSubject("not for the whole team, just for Rowan Pell")).toBe(false);
  });
});
