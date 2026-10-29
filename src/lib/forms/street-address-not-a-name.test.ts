import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { employeeState, managerContext } from "./proposal";

/**
 * STREET_ADDRESS_NOT_A_NAME_ENABLED (QA, 29 Oct 2026). A manager's exit with
 * the person's street address (her wording shape; the person and address
 * invented): the name reader offered "Ne Oakfield Lane", "kearney ne" and
 * "NE" as more people.
 */
const HER_WORDS =
  "create an exit for marnie holloway, assistant salon manager at kearney, ne. last day worked 10-26-26. not eligible for rehire. marnie's address is 125 Ne Oakfield Lane, kearney, NE. 68847";

const people = (content: string) => {
  const { resolution } = employeeState(managerContext([], { content }));
  return resolution.kind === "ambiguous" ? resolution.candidates : resolution.kind === "resolved" ? [resolution.employeeName] : [];
};

describe("a street address is not a person", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: a part of the address is read as a person", () => {
    expect(people(HER_WORDS).map((name) => name.toLowerCase())).toEqual(expect.arrayContaining([expect.stringMatching(/oakfield|kearney|^ne$/)]));
  });

  it.each([
    "125 Ne Oakfield Lane, kearney, NE. 68847",
    "125 ne oakfield lane, kearney, ne 68847",
    "125 oakfield lane kearney ne",
    "4410 W 12th St, kearney ne",
    "88 Birch Court Apt 4, kearney",
  ])('on: "%s" — she is the only person', (address) => {
    vi.stubEnv("STREET_ADDRESS_NOT_A_NAME_ENABLED", "true");
    expect(people(`create an exit for marnie holloway. last day worked 10-26-26. not eligible for rehire. marnie's address is ${address}`)).toEqual(["marnie holloway"]);
  });

  it("on: her words, she is the only person", () => {
    vi.stubEnv("STREET_ADDRESS_NOT_A_NAME_ENABLED", "true");
    expect(people(HER_WORDS)).toEqual(["marnie holloway"]);
  });

  it('on: "jordan lane" with no house number is still a person', () => {
    vi.stubEnv("STREET_ADDRESS_NOT_A_NAME_ENABLED", "true");
    expect(people("create a ca for jordan lane, he was late")).toEqual(["jordan lane"]);
  });

  it("on: two real people beside an address are still two people", () => {
    vi.stubEnv("STREET_ADDRESS_NOT_A_NAME_ENABLED", "true");
    expect(people("create an exit for marnie holloway and rowan kestrel. address 125 Ne Oakfield Lane, kearney, NE. 68847")).toEqual(["marnie holloway", "rowan kestrel"]);
  });
});
