import { execFileSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { caSalesPolicyPeople } from "@/app/api/chat/replay-pack/nov4-ca-sales-policy-cases";

import { caPolicyProposalLine, readCaPolicy, statedOffenseKeys } from "./ca-policy";
import { CA_SALES_POLICY_RULE, withSalesOffense } from "./ca-sales-policy";

/**
 * CA_SALES_POLICY_ENABLED (client request relayed by Pau, 4 Nov 2026; ported
 * from Ask Bubbles #422): sales and MSB corrective actions cite the Standards
 * of Conduct. Every name here is invented (the repository is public).
 */

const FLAG = "CA_SALES_POLICY_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});
const on = () => (process.env[FLAG] = "true");
const off = () => delete process.env[FLAG];

const MSB = "I need a corrective action for Saffira Tolleston for MSB";
const LOW_SALES = "write a corrective action for Garrick Wendlemoor, his sales are low and he is not hitting his goals";
const NAMED_UNDER_PERFORMANCE = "the policy is under performance";
const ATTENDANCE = "I need a corrective action for Bettina Crossfield, she was late to her shift three times this week";
const CLEANING = "make a corrective action for Anselm Fenwright, the tanning beds were left dirty at close";
const ALL = [MSB, LOW_SALES, NAMED_UNDER_PERFORMANCE, ATTENDANCE, CLEANING];

describe("CA_SALES_POLICY_ENABLED off: the reading and the card line are as on main", () => {
  it.each(ALL)("%s", (text) => {
    off();
    const reading = readCaPolicy(text);
    expect(reading.source === "sales_performance" || reading.source === "msb").toBe(false);
    expect(caPolicyProposalLine(reading) ?? "").not.toMatch(/Must See Behaviors|sales performance against goals/);
  });

  it("the MSB request suggests no policy (fails before the fix with the flag on, see below)", () => {
    off();
    expect(readCaPolicy(MSB).suggestion).toBeNull();
    expect(statedOffenseKeys(readCaPolicy(MSB), MSB)).toBeNull();
  });

  it("the low-sales request suggests no policy (fails before the fix with the flag on, see below)", () => {
    off();
    expect(readCaPolicy(LOW_SALES).suggestion).toBeNull();
    expect(statedOffenseKeys(readCaPolicy(LOW_SALES), LOW_SALES)).toBeNull();
  });
});

describe("CA_SALES_POLICY_ENABLED on", () => {
  it("(a) MSB, a chat glossary term, reads as the Standards of Conduct", () => {
    on();
    const reading = readCaPolicy(MSB);
    expect(reading).toMatchObject({ stated: null, suggestion: "standards_of_conduct", source: "msb", ambiguous: null });
    expect(statedOffenseKeys(reading, MSB)).toEqual(["standards_of_conduct"]);
    expect(caPolicyProposalLine(reading)).toMatch(/^\*\*Policy:\*\* Standards of Conduct — Must See Behaviors \(MSB\)/);
  });

  it("(b) low sales / not hitting goals (the Under Performance reading) reads as the Standards of Conduct", () => {
    on();
    const reading = readCaPolicy(LOW_SALES);
    expect(reading).toMatchObject({ stated: null, suggestion: "standards_of_conduct", source: "sales_performance" });
    expect(statedOffenseKeys(reading, LOW_SALES)).toEqual(["standards_of_conduct"]);
    expect(caPolicyProposalLine(reading)).toMatch(/Standards of Conduct — sales performance against goals/);
  });

  it("Under Performance named by the manager is the Standards of Conduct", () => {
    on();
    expect(readCaPolicy(NAMED_UNDER_PERFORMANCE)).toMatchObject({ stated: null, suggestion: "standards_of_conduct" });
  });

  it("negative control: attendance is untouched (Attendance, tardiness)", () => {
    on();
    const reading = readCaPolicy(ATTENDANCE);
    off();
    expect(reading).toEqual(readCaPolicy(ATTENDANCE));
  });

  it("negative control: cleaning is untouched and does not suggest the Standards of Conduct", () => {
    on();
    const reading = readCaPolicy(CLEANING);
    expect(reading.suggestion).toBeNull();
    off();
    expect(reading).toEqual(readCaPolicy(CLEANING));
  });

  it("(c) the drafting model's Under Performance tick becomes the Standards of Conduct; other ticks stay", () => {
    const offered = ["tardiness", "absenteeism", "standards_of_conduct", "under_performance", "dress_code", "company_policies"];
    expect(withSalesOffense({ checked: { offense_type: ["under_performance"] }, values: {}, offered })?.checked.offense_type).toEqual([
      "standards_of_conduct",
    ]);
    expect(
      withSalesOffense({ checked: { offense_type: ["under_performance", "dress_code"] }, values: {}, offered })?.checked.offense_type,
    ).toEqual(["standards_of_conduct", "dress_code"]);
    expect(withSalesOffense({ checked: { offense_type: ["tardiness"] }, values: {}, offered })).toBeNull();
    expect(withSalesOffense({ checked: { offense_type: ["under_performance"] }, values: {}, offered: ["under_performance"] })).toBeNull();
  });

  it("the added prompt line names the Standards of Conduct box by key", () => {
    expect(CA_SALES_POLICY_RULE).toContain("standards_of_conduct");
  });
});

describe("the replay cases' invented people are on no other fixture", () => {
  it.each(caSalesPolicyPeople().map((person) => `${person.firstName} ${person.lastName}`))("%s", (name) => {
    const last = name.split(" ").pop()!;
    let hits = "";
    try {
      hits = execFileSync("git", ["grep", "-l", "-w", last, "--", "src", "evals", "e2e"], { encoding: "utf8" });
    } catch {
      hits = "";
    }
    const elsewhere = hits
      .split("\n")
      .filter(Boolean)
      .filter((file) => !/nov4-ca-sales-policy-cases\.ts$|ca-sales-policy\.test\.ts$/.test(file));
    expect(elsewhere).toEqual([]);
  });
});
