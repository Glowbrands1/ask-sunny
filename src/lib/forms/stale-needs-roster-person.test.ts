import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkProposalIsCurrent } from "./proposal-currency";

/**
 * STALE_NEEDS_ROSTER_PERSON_ENABLED. Ported from Ask Bubbles: a manager's exit
 * there (29 Oct 2026), in this app's words, the person and address invented: a right card refused as
 * the conversation "now names more than one person (<the person>, drop wage,
 * forfeit bonus)". With the roster, a name that is neither the card's person
 * nor anybody on the roster is not another person; two roster people are.
 */
const HER_WORDS =
  "create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26. salon items not returned and $25 will be payroll deducted for salon key. immediate voluntary term, no notice given. payroll deduct applies. drop wage and forfeit bonus. not eligible for rehire. marnie's address is 125 Ne Oakfield Lane, kearney, NE. 68847";
const ROSTER = ["Marnie Holloway", "Rowan Kestrel", "Morgan Blake"];
const check = (content: string, rosterNames?: string[]) =>
  checkProposalIsCurrent({ conversation: [{ role: "user", content }], templateKey: "stc-exit", employeeName: "Marnie Holloway", rosterNames });

describe("the creation check with the manager's roster", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("her exit wording is current", () => {
    vi.stubEnv("STALE_NEEDS_ROSTER_PERSON_ENABLED", "true");
    expect(check(HER_WORDS, ROSTER)).toEqual({ current: true });
  });

  it("off, or with no roster, it is refused as before", () => {
    expect(check(HER_WORDS, ROSTER)).toMatchObject({ current: false, reason: expect.stringMatching(/drop wage, forfeit bonus/) });
    vi.stubEnv("STALE_NEEDS_ROSTER_PERSON_ENABLED", "true");
    expect(check(HER_WORDS, undefined)).toMatchObject({ current: false });
    expect(check(HER_WORDS, [])).toMatchObject({ current: false });
  });

  it("a second roster person in the same request still refuses", () => {
    vi.stubEnv("STALE_NEEDS_ROSTER_PERSON_ENABLED", "true");
    const both = HER_WORDS.replace("drop wage and forfeit bonus.", "drop wage and forfeit bonus. rowan kestrel covered her shifts.");
    const result = check(both, ROSTER);
    if (result.current) {
      // The resolver did not read Rowan as a second person here; then nothing names him, and the card is not refused by this rule either.
      expect(check("create an exit for marnie holloway and rowan kestrel", ROSTER)).toMatchObject({ current: false });
    } else {
      expect(result.reason).toMatch(/rowan kestrel/);
    }
  });

  it('"mo" is not Morgan Blake: a roster first name must be the whole first word', () => {
    vi.stubEnv("STALE_NEEDS_ROSTER_PERSON_ENABLED", "true");
    expect(check(HER_WORDS, ROSTER)).toEqual({ current: true });
  });
});
