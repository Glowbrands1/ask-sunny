import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { JBA_MANUAL_CHUNKS } from "@/lib/ai/__fixtures__/jba-policy-manual";

import { manualSectionHeadings } from "./official-policy-manual";
import { readEmployeeMentions } from "./proposal";
import { isNotAName, maskNotANameText, saidInReply } from "./not-a-name";

/**
 * The readers behind QA round 4 (24 Oct 2026), with NOT_A_NAME_GUARD_ENABLED.
 * The end-to-end replays are `src/lib/ai/not-a-name-oct24.test.ts`.
 */

describe("NOT_A_NAME_GUARD_ENABLED off", () => {
  it("changes nothing", () => {
    expect(isNotAName("blank")).toBe(false);
    expect(maskNotANameText("Policy reference: Dress Code, JBA Policy Manual p.15.")).toBe(
      "Policy reference: Dress Code, JBA Policy Manual p.15.",
    );
  });
});

describe("NOT_A_NAME_GUARD_ENABLED on", () => {
  beforeEach(() => {
    vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "blank",
    "Blank",
    "n/a",
    "unknown",
    "If Possible",
    "require practice",
    "Require Practice",
    "spa",
    "spa Here",
    "EFT",
    "EFT's",
    "efts",
    "Spa Sessions",
    "lawrence",
    "Lawrence",
    "KS Lawrence",
    "manhattan",
    "Fitzpatrick Skin Type Chart",
    "EFT Agreements",
    "team",
    "everyone",
  ])("%s is not a name", (candidate) => {
    expect(isNotAName(candidate)).toBe(true);
  });

  it.each(["Test Testy", "Test Employee", "Jordan Testperson", "Lawrence Smith", "Will Turner", "Mark Grant", "Tanner Price", "Spencer Tan"])(
    "%s is still a name",
    (candidate) => {
      expect(isNotAName(candidate)).toBe(false);
    },
  );

  it("the app's own state lines are not read for a person: no manual heading becomes a second candidate", () => {
    // Off, 40+ headings came back as a person beside the employee: "Core
    // Values", "Wet Floor Sign", "No Public Restrooms" → "Public Restrooms".
    const strays: string[] = [];
    for (const heading of manualSectionHeadings(JBA_MANUAL_CHUNKS as never)) {
      for (const lead of ["The employee is Jordan Testperson. ", ""]) {
        const question = `The form is the Coaching Form.\n${lead}Job title: Tanning Consultant. It happened at KS Lawrence. It happened on 9/29/2026. Policy reference: ${heading}, JBA Policy Manual p.20.\ncreate a coaching form for test testy`;
        const names = readEmployeeMentions(question).names.filter((name) => !/^(?:jordan testperson|test testy)$/i.test(name));
        if (names.length > 0) strays.push(`${heading} → ${names.join(", ")}`);
      }
    }
    expect(strays).toEqual([]);
  });

  it("the October promo list names nobody", () => {
    const promo =
      "Timeline: October 1 – October 31\nOffers: \n• $5 Red Light Visits\n• Eight Red Light Visits for $35\n• Wellness Product Bundle: KIT Restored Red Light for $79.99 ($64.98 Savings + $6 Bonus)\n➢ BOT Restored Prep Spray\n➢ BOT Restored Post Cream\n➢ BOT Restored Target Serum\n➢ Five Wellness Visits";
    expect(readEmployeeMentions(promo).names).toEqual([]);
  });

  it("a store number after the name is not a place before it", () => {
    expect(readEmployeeMentions("coaching form for Jane Doe store 373").names).toEqual(["Jane Doe"]);
  });

  it("a name beside a dollar amount is still read", () => {
    expect(readEmployeeMentions("CA for Jordan Testperson, payroll deduct $25").names).toEqual(["Jordan Testperson"]);
  });

  it('"for lawrence location" is the salon; the employee in the same sentence stays', () => {
    const turn =
      "create a coaching form for lawrence location tanning consultant, test testy, who was talking on her cell phone for 25 minutes on 9-29-26 when customers were waiting to check in";
    const names = readEmployeeMentions(turn).names.map((name) => name.toLowerCase());
    expect(names).not.toContain("lawrence");
  });

  it('"for EFT\'s and spa" names nobody', () => {
    expect(readEmployeeMentions("Can you create a coaching form for EFT's and spa").names).toEqual([]);
  });

  it('"1. employee name is blank" names nobody', () => {
    expect(readEmployeeMentions("1. employee name is blank\n2. knowledge on october promotions").names).toEqual([]);
  });

  it("one bulleted name is still an answer", () => {
    expect(readEmployeeMentions("- Jordan Testperson").names).toEqual(["Jordan Testperson"]);
  });
});

describe("saidInReply", () => {
  it("finds a name a reply cites, not one a card names as its subject", () => {
    const answer = 'Only one client per room ("One Tanner per Room", JBA Policy Manual p.50).';
    expect(saidInReply([answer], "One Tanner")).toBe(true);
    expect(saidInReply(["Here's what I'll fill in on the **Resignation/Exit Form** for **Avery Testperson**:\n\n- **Name:** Avery Testperson"], "Avery Testperson")).toBe(false);
    expect(saidInReply(["Nothing about anyone here."], "Avery Testperson")).toBe(false);
  });
});
