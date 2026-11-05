import { afterEach, describe, expect, it, vi } from "vitest";

import { managerAccount } from "./remap-incident";

/**
 * OBSERVATION_WITHOUT_ASK_ENABLED (Pau, 5 Nov 2026, sf-s28): the card's
 * Observation of Offense was "can i give a ca for not signing off on the
 * cleaning check list", the whole question. The wording is production's; the
 * person is invented.
 */

const FLAG = "OBSERVATION_WITHOUT_ASK_ENABLED";
const NAME = "Thessaly Brandt";
const ASKED = "can i give a ca for not signing off on the cleaning check list";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sf-s28: the ask is not the account", () => {
  it("off: the whole question (the live report)", () => {
    expect(managerAccount(ASKED, NAME)).toBe(ASKED);
  });

  it("on: what follows the ask's \"for\"", () => {
    vi.stubEnv(FLAG, "true");
    expect(managerAccount(ASKED, NAME)).toBe("not signing off on the cleaning check list");
  });

  it("on: an ask that only names the employee is no account", () => {
    vi.stubEnv(FLAG, "true");
    expect(managerAccount(`can i give a ca for ${NAME}`, NAME)).toBe("");
  });
});

describe("controls, on: an account with no ask is as said", () => {
  it.each(["she did not sign off on the cleaning check list", "she was late for her shift on 11/3"])("%s", (said) => {
    vi.stubEnv(FLAG, "true");
    expect(managerAccount(said, NAME)).toBe(said);
  });
});
