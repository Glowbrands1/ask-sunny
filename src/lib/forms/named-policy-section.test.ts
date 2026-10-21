import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CHUNKS } from "@/lib/ai/__fixtures__/jba-policy-manual";

import type { ManualChunk } from "./official-policy-manual";
import {
  SPECIFIC_SECTION_BOXES,
  describedManualSection,
  namedManualSection,
  namedPolicies,
  namesHeading,
} from "./named-policy-section";

/**
 * A policy the manager names, matched against the pinned manual's own sheet
 * headings — District Manager feedback, 21 Oct 2026: "violating visitors at
 * work policy" is the manual's "Visitors in the Workplace". Generic: nothing
 * here lists that phrase; the headings below are the manual's.
 */

const sheet = (chunkIndex: number, heading: string, page: number): ManualChunk => ({
  chunkIndex,
  page: page + 1,
  printedPage: page,
  sections: [{ heading, page }],
  section: heading,
  content: `${heading}\nText of the section.`,
});

const CHUNKS: ManualChunk[] = [
  sheet(30, "Standards of Conduct", 12),
  sheet(33, "Attendance", 14),
  sheet(34, "Late Opening", 15),
  sheet(35, "Dress Code for The Company", 15),
  sheet(55, "Safety in the Workplace", 25),
  sheet(64, "Visitors in the Workplace", 30),
  sheet(65, "Animals in the Workplace", 30),
  sheet(70, "Cell Phone Usage", 32),
];

describe("namesHeading", () => {
  it.each([
    ["visitors at work", "Visitors in the Workplace"],
    ["visitor", "Visitors in the Workplace"],
    ["visitors in the workplace", "Visitors in the Workplace"],
    ["cell phone", "Cell Phone Usage"],
    ["late opening", "Late Opening"],
  ])("%s → %s", (phrase, heading) => {
    expect(namesHeading(phrase, heading)).toBe(true);
  });

  it.each([
    ["cell phone", "Cell Phone/Smart Watch Policy"],
    ["smart watch", "Cell Phone/Smart Watch Policy"],
    ["cell phone/smart watch", "Cell Phone/Smart Watch Policy"],
  ])("%s → %s: either side of a heading's slash names it", (phrase, heading) => {
    expect(namesHeading(phrase, heading)).toBe(true);
  });

  it.each([
    ["phone", "Cell Phone/Smart Watch Policy"],
    ["unicorn phone", "Cell Phone/Smart Watch Policy"],
    ["workplace", "Visitors in the Workplace"],
    ["visitors at work", "Animals in the Workplace"],
    ["phone", "Cell Phone Usage"],
    ["opening", "Late Opening"],
  ])("%s is not %s", (phrase, heading) => {
    expect(namesHeading(phrase, heading)).toBe(false);
  });
});

describe("namedPolicies", () => {
  it("reads the words a verb names as a policy", () => {
    expect(
      namedPolicies(
        "create verbal CA for remy calder for violating visitors at work policy on 10-10-26. juno spent 40 minutes talking with friend",
      ).map((named) => named.phrase),
    ).toEqual(["visitors at work"]);
    expect(namedPolicies("she broke the cell phone policy again").map((named) => named.phrase)).toEqual(["cell phone"]);
  });

  it("names none in a question, or in 'company policy' alone", () => {
    expect(namedPolicies("is that against the visitor policy?")).toEqual([]);
    expect(namedPolicies("violation of company policy")).toEqual([]);
  });
});

describe("namedManualSection", () => {
  it("finds the manual's section, its printed page, and the box it is cited under", () => {
    const found = namedManualSection({ text: "for violating visitors at work policy on 10-10-26", chunks: CHUNKS });
    expect(found).toMatchObject({
      phrase: "visitors at work",
      section: { heading: "Visitors in the Workplace", page: 30 },
      offenseKey: "company_policies",
    });
  });

  it("cites a section a box already cites under that box", () => {
    expect(namedManualSection({ text: "violated the late opening policy", chunks: CHUNKS })?.offenseKey).toBe("tardiness");
  });

  it("fails closed: no heading, two headings, or no manual", () => {
    expect(namedManualSection({ text: "violating the unicorn parking policy", chunks: CHUNKS })).toBeNull();
    expect(namedManualSection({ text: "violating the workplace policy", chunks: CHUNKS })).toBeNull();
    expect(namedManualSection({ text: "violating visitors at work policy", chunks: null })).toBeNull();
    expect(
      namedManualSection({
        text: "violating visitors at work policy",
        chunks: [...CHUNKS, sheet(90, "Visitors at Work", 40)],
      }),
    ).toBeNull();
  });
});

/*
 * District Manager feedback, 21 Oct 2026: "on 10-20-26 <employee> was talking
 * on her cell phone for over 30 minutes" named no policy and was cited under
 * the Standards of Conduct. Read against the real JBA manual's headings (all
 * 110 chunks of the indexed manual), including the ones that would collide
 * with a looser reading.
 */
describe("describedManualSection — a policy the account describes", () => {
  const described = (text: string) => describedManualSection({ text, chunks: JBA_MANUAL_CHUNKS });

  it.each([
    [
      "create a verbal corrective action form for remy calder. on 10-20-26 remy was talking on her cell phone for over 30 minutes",
      "cell phone",
    ],
    ["she was on her phone for 20 minutes while clients waited", "phone"],
    ["tess was on her cell for an hour", "cell"],
    ["she was looking at her smart watch all afternoon", "smart watch"],
  ])("%s → %s → Cell Phone/Smart Watch Policy, page 19", (text, phrase) => {
    expect(described(text)).toMatchObject({
      phrase,
      section: { heading: "Cell Phone/Smart Watch Policy", page: 19 },
      offenseKey: "company_policies",
    });
  });

  it.each([
    /* Incidental mentions. */
    "she left her phone number on the schedule",
    "she called in by phone to say she would be out sick",
    "her friend came to visit",
    /* A rule, not an account. */
    "cell phones must be kept out of sight",
    /* Two headings answer: nothing. */
    "she was posting on social media",
    /* Words a heading shares with every account. */
    "create a disciplinary action form for tess. she was rude to a client",
    "she did not check the schedule",
    "tess left the back door open all night",
    "she was talking to a client about her weekend",
    "she gave a client a coupon",
    /* A section the account names that the manual does not title a Policy. */
    "her friend was visiting for an hour behind the counter",
    "she did not follow the coupon collection process",
    "she did not fill in her time records",
    "she did not find a shift replacement",
    "payroll deduct applies",
    "a $25 payroll deduction applies",
  ])("%s → nothing", (text) => {
    expect(described(text)).toBeNull();
  });

  it("never over what already decides the policy", () => {
    /* A policy named — found, or not — is the manager's. */
    expect(described("violating the unicorn parking policy. she was on her cell phone")).toBeNull();
    expect(described("for violating the dress code. she was on her cell phone")).toBeNull();
    /* Attendance, a late opening, dress code: their own boxes. */
    expect(described("she was 20 minutes late because she was on her cell phone")).toBeNull();
    expect(described("she opened the salon late and was on her cell phone")).toBeNull();
    expect(described("her uniform was dirty and she was on her cell phone")).toBeNull();
    /* A conduct incident the Standards of Conduct lists. */
    expect(described("she refused to follow my direction to put her cell phone away")).toBeNull();
    /* A question describes nothing. */
    expect(described("was she on her cell phone?")).toBeNull();
    /* No manual. */
    expect(describedManualSection({ text: "on her cell phone", chunks: null })).toBeNull();
  });

  it("is read from the manual's headings, not a list: a manual without the section cites nothing", () => {
    expect(
      describedManualSection({
        text: "remy was talking on her cell phone",
        chunks: JBA_MANUAL_CHUNKS.filter(
          (chunk) => !(chunk.sections ?? []).some((entry) => entry.heading === "Cell Phone/Smart Watch Policy"),
        ).map((chunk) => (chunk.section === "Cell Phone/Smart Watch Policy" ? { ...chunk, section: null } : chunk)),
      }),
    ).toBeNull();
  });

  it("leaves the boxes with their own specific section to the draft", () => {
    expect([...SPECIFIC_SECTION_BOXES].sort()).toEqual(["absenteeism", "dress_code", "tardiness"]);
  });
});
