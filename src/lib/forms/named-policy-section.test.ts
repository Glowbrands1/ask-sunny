import { describe, expect, it } from "vitest";

import type { ManualChunk } from "./official-policy-manual";
import { namedManualSection, namedPolicies, namesHeading } from "./named-policy-section";

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
