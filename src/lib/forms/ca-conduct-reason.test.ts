import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readCaPolicy } = await import("./ca-policy");
const { conductHasReason, readOffenseBasis, withoutUnreasonedConduct } = await import("./ca-conduct-reason");

/*
 * Pau, 4 Nov 2026 (16:50 UTC): a cleaning Corrective Action does not cite the
 * Standards of Conduct by default. QA's live wording and Pau's, names invented.
 */
const OFFERED = ["attendance_policy", "standards_of_conduct", "dress_code", "other"];
const BATHROOMS = "make a corrective action for Halloran Sweetbriar, the tanning beds were left dirty at close";
const DUTIES = "make a corrective action for Halloran Sweetbriar, he did not complete daily cleaning duties";

function flag(on: boolean) {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", on ? "true" : "false");
  vi.stubEnv("CHAT_GLOSSARY_ENABLED", "true");
}
afterEach(() => vi.unstubAllEnvs());

const ticked = (keys: string[]) => ({ values: {} as Record<string, string>, checked: { offense_type: keys } });

describe("a Standards of Conduct tick needs a reason in the manager's words (CA_SALES_POLICY_ENABLED)", () => {
  it("QA's live wording: the tick moves to Other, with the manager's account beside it", () => {
    flag(true);
    const out = withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS, basis: "upkeep_or_task", writeInOffered: true });
    expect(out?.checked.offense_type).toEqual(["other"]);
    expect(out?.values.other_offense).toBe("The tanning beds were left dirty at close");
    // Revision 8: no write-in on the form, so nothing is written for it ("Other prints just Other").
    const rev7 = withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS, basis: "upkeep_or_task" });
    expect(rev7?.checked.offense_type).toEqual(["other"]);
    expect(rev7?.values).not.toHaveProperty("other_offense");
  });

  it("Pau's wording: the general task reading with the model's upkeep basis is no reason; with no basis it stands (Woven training past due reads the same)", () => {
    flag(true);
    const reading = readCaPolicy(DUTIES);
    expect(reading.topics).toEqual(["task"]);
    expect(conductHasReason(reading, false, "upkeep_or_task")).toBe(false);
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading, stated: false, offered: OFFERED, notes: DUTIES, basis: "upkeep_or_task" })?.checked.offense_type).toEqual(["other"]);
    expect(conductHasReason(reading, false)).toBe(true);
    expect(conductHasReason(readCaPolicy("she ignored her woven training that was due 10/16/26"), false)).toBe(true);
  });

  it("a named policy, the MSB reading and a direction not followed keep it", () => {
    flag(true);
    expect(conductHasReason(readCaPolicy(BATHROOMS), true)).toBe(true);
    expect(conductHasReason(readCaPolicy("MSB CA for Halloran Sweetbriar for underperformance in the month of October"), false)).toBe(true);
    const direction = readCaPolicy("make a corrective action for Halloran Sweetbriar, he refused to follow his manager's direction to restock");
    expect(direction.topics).toContain("direction");
    expect(conductHasReason(direction, false)).toBe(true);
  });

  it("another box, or a version with no Other box, is left alone", () => {
    flag(true);
    expect(withoutUnreasonedConduct({ draft: ticked(["attendance_policy"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS, basis: "upkeep_or_task" })).toBeNull();
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: ["standards_of_conduct", "company_policies"], notes: BATHROOMS, basis: "upkeep_or_task" })).toBeNull();
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS, basis: "upkeep_or_task", specific: true })).toBeNull();
  });

  it("off: nothing changes", () => {
    flag(false);
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS, basis: "upkeep_or_task" })).toBeNull();
  });

  it("the drafting model's offense_basis: only upkeep_or_task moves it; sales, MSB, conduct, other or none keep it (Pau: wrong items keeps the Standards of Conduct)", () => {
    flag(true);
    const WRONG_ITEMS = "create a corrective action for Halloran Sweetbriar for ringing up the wrong items on a guest's order";
    const reading = readCaPolicy(WRONG_ITEMS);
    for (const basis of ["sales", "msb", "conduct", "other", null] as const) {
      expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading, stated: false, offered: OFFERED, notes: WRONG_ITEMS, basis }), String(basis)).toBeNull();
    }
    for (const basis of ["upkeep_or_task"] as const) {
      expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS, basis })?.checked.offense_type, String(basis)).toEqual(["other"]);
    }
  });

  it("readOffenseBasis: only the listed values, else null", () => {
    expect(readOffenseBasis({ offense_basis: "sales" })).toBe("sales");
    expect(readOffenseBasis({ offense_basis: "cleaning" })).toBeNull();
    expect(readOffenseBasis({})).toBeNull();
    expect(readOffenseBasis(null)).toBeNull();
  });
});
