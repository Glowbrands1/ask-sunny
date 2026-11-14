import { afterEach, describe, expect, it, vi } from "vitest";

import { readGroundedChoice } from "./grounded-entities";
import type { GroundedPerson } from "./grounded-entities";

/**
 * SAME_NAME_ASKS_WHICH_ENABLED (QA, 12 Nov 2026; high priority). Two active people with one name at ONE salon: the
 * labelled choice "Did you mean 1. **<name>** (<salon>, <title>) or 2. …" was answered by matching the salon first, so
 * every answer — "2", "1", a job title — chose the first person. The answer selects by identity (salon AND title), never
 * by name. People are synthetic.
 */

const ASKED =
  'Did you mean 1. **Marnie Holloway** (NE Kearney, Tanning Consultant) or 2. **Marnie Holloway** (NE Kearney, Assistant Salon Director)? More than one person on your team is a close match for **marnie holloway**. Reply with the number, the salon, or the job title — or say "keep marnie holloway" to use the name exactly as you typed it.';

const PEOPLE = [
  { id: "e-1", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, salonIds: ["loc-0309"], title: "Tanning Consultant", primaryLocationName: null },
  { id: "e-90", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, salonIds: ["loc-0309"], title: "Assistant Salon Director", primaryLocationName: null },
] as unknown as GroundedPerson[];

const HISTORY = [
  { role: "user", content: "verbal CA for marnie holloway, she was late on 11/1/26" },
  { role: "assistant", content: ASKED },
];

const chosen = (reply: string) => {
  const choice = readGroundedChoice(HISTORY, reply, PEOPLE);
  return choice?.kind === "person" ? choice.id : null;
};

afterEach(() => vi.unstubAllEnvs());

describe("an answer to the same-name choice selects by identity", () => {
  it("off: every answer chose the first person — \"2\" gave the Tanning Consultant (the bug)", () => {
    vi.stubEnv("SAME_NAME_ASKS_WHICH_ENABLED", "false");
    expect(chosen("2")).toBe("e-1");
    expect(chosen("the assistant salon director")).toBe("e-1");
  });

  it("on: the number, and the job title, select that person", () => {
    vi.stubEnv("SAME_NAME_ASKS_WHICH_ENABLED", "true");
    expect(chosen("2")).toBe("e-90");
    expect(chosen("1")).toBe("e-1");
    expect(chosen("the assistant salon director")).toBe("e-90");
    expect(chosen("tanning consultant")).toBe("e-1");
  });

  it("on: the salon both share selects nobody", () => {
    vi.stubEnv("SAME_NAME_ASKS_WHICH_ENABLED", "true");
    expect(chosen("kearney")).toBeNull();
  });

  it("on: the answer is read after the saved form state put in front of it", () => {
    vi.stubEnv("SAME_NAME_ASKS_WHICH_ENABLED", "true");
    expect(chosen("The form is the Corrective Action Form.\nThe employee is marnie holloway. It happened on 11/1/2026.\n2")).toBe("e-90");
  });
});
