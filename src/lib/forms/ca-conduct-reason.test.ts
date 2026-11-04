import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readCaPolicy } = await import("./ca-policy");
const { conductHasReason, withoutUnreasonedConduct } = await import("./ca-conduct-reason");

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
    const out = withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS });
    expect(out?.checked.offense_type).toEqual(["other"]);
    expect(out?.values.other_offense).toBe("The tanning beds were left dirty at close");
  });

  it("Pau's wording: the general task reading is no reason", () => {
    flag(true);
    const reading = readCaPolicy(DUTIES);
    expect(reading.topics).toEqual(["task"]);
    expect(conductHasReason(reading, false)).toBe(false);
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading, stated: false, offered: OFFERED, notes: DUTIES })?.checked.offense_type).toEqual(["other"]);
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
    expect(withoutUnreasonedConduct({ draft: ticked(["attendance_policy"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS })).toBeNull();
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: ["standards_of_conduct", "company_policies"], notes: BATHROOMS })).toBeNull();
  });

  it("off: nothing changes", () => {
    flag(false);
    expect(withoutUnreasonedConduct({ draft: ticked(["standards_of_conduct"]), reading: readCaPolicy(BATHROOMS), stated: false, offered: OFFERED, notes: BATHROOMS })).toBeNull();
  });
});
