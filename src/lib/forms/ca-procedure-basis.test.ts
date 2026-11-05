import { afterEach, describe, expect, it } from "vitest";

import { conductHasReason, OFFENSE_BASIS_PROPERTY, offenseBasisProperty, readOffenseBasis } from "./ca-conduct-reason";
import { readCaPolicy } from "./ca-policy";

/**
 * CA_PROCEDURE_BASIS_ENABLED (Pau via QA, 5 Nov 2026, sf-b6 in the sibling app; ruling A): the
 * drafting model may name a store procedure as the basis, and an unreasoned
 * Standards of Conduct tick then moves to Other like upkeep. The manager's
 * words are QA's (person invented).
 */
const B6 = "I need a corrective action form for Wynne Sarrow for counting the drawer early and turning away a customer";

afterEach(() => {
  delete process.env.CA_PROCEDURE_BASIS_ENABLED;
});

describe("the store-procedure basis", () => {
  it("off: the tool is as before and store_procedure is not read", () => {
    expect(offenseBasisProperty()).toBe(OFFENSE_BASIS_PROPERTY);
    expect(readOffenseBasis({ offense_basis: "store_procedure" })).toBeNull();
    expect(conductHasReason(readCaPolicy(B6), false, "store_procedure")).toBe(true);
  });

  it("on: the tool offers it, it is read, and it is no reason for the Standards of Conduct", () => {
    process.env.CA_PROCEDURE_BASIS_ENABLED = "true";
    expect(offenseBasisProperty().enum).toContain("store_procedure");
    expect(offenseBasisProperty().description).toContain("store_procedure =");
    expect(readOffenseBasis({ offense_basis: "store_procedure" })).toBe("store_procedure");
    expect(conductHasReason(readCaPolicy(B6), false, "store_procedure")).toBe(false);
  });

  it("on: conduct, a stated policy, or no basis keeps the Standards of Conduct", () => {
    process.env.CA_PROCEDURE_BASIS_ENABLED = "true";
    expect(conductHasReason(readCaPolicy("she was rude to a guest"), false, "conduct")).toBe(true);
    expect(conductHasReason(readCaPolicy(B6), true, "store_procedure")).toBe(true);
    expect(conductHasReason(readCaPolicy(B6), false, null)).toBe(true);
  });
});
