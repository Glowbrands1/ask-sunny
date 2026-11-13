import { afterEach, describe, expect, it, vi } from "vitest";

import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";

import { closeWordDistance, editDistance } from "./close-spelling";
import { closeHeadingReading, closePolicyQuestion, namedManualSection } from "./named-policy-section";
import { manualSectionHeadings } from "./official-policy-manual";

/*
 * CLOSE_SPELLING_MATCH (Pau via QA, 13 Nov 2026; ported from the sibling app): "Allow close spellings ("Care and
 * Clening" → "Care and Cleaning"). Put the list's correct spelling on the form. Ask "Did you mean …?" when there is
 * more than one possible match, or when the match isn't confident." Invented wording.
 */
const HEADINGS = manualSectionHeadings(JBA_MANUAL_CA_CHUNKS);
const cited = (text: string) => namedManualSection({ text, chunks: JBA_MANUAL_CA_CHUNKS })?.section.heading ?? null;

afterEach(() => vi.unstubAllEnvs());

describe("close-spelling: the distance between two words", () => {
  it("counts one change, insert, delete or swap as one", () => {
    expect(editDistance("clening", "cleaning")).toBe(1);
    expect(editDistance("phnoe", "phone")).toBe(1);
    expect(editDistance("wrkplace", "workplace")).toBe(1);
  });

  it("reads a short word as no other word", () => {
    expect(closeWordDistance("dres", "dress")).toBeNull();
    expect(closeWordDistance("clening", "cleaning")).toBe(1);
    expect(closeWordDistance("retalaton", "retaliation")).toBe(2);
    expect(closeWordDistance("visotrs", "visitors")).toBeNull();
  });
});

describe("close-spelling: a policy named a letter off", () => {
  it("flag off: only the exact spelling names a heading (as on main)", () => {
    expect(cited("ca for avery for violating the anmals in the workplace policy")).toBeNull();
    expect(closePolicyQuestion("anmals in the wrkplace", JBA_MANUAL_CA_CHUNKS)).toBeNull();
  });

  it("flag on: one word one letter off names the one heading, cited in the manual's spelling", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(cited("ca for avery for violating the anmals in the workplace policy")).toBe("Animals in the Workplace");
    expect(cited("ca for avery for violating the vistors at work policy")).toBe("Visitors in the Workplace");
    expect(cited("ca for avery for violating the smokng policy")).toBe("Smoking/Vaping");
  });

  it("flag on: a heading named as spelled is matched exactly as before", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(cited("ca for avery for violating the visitors at work policy")).toBe("Visitors in the Workplace");
    expect(closePolicyQuestion("visitors at work", JBA_MANUAL_CA_CHUNKS)).toBeNull();
  });

  it("flag on: two words off is not confident — nothing is cited, the manager is asked", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(cited("ca for avery for violating the anmals in the wrkplace policy")).toBeNull();
    expect(closeHeadingReading("anmals in the wrkplace", HEADINGS)).toEqual({ confident: null, candidates: ["Animals in the Workplace"] });
    expect(closePolicyQuestion("anmals in the wrkplace", JBA_MANUAL_CA_CHUNKS)).toMatch(
      /^\*\*Policy:\*\* I don't see a section of the policy manual called "anmals in the wrkplace"\. Did you mean \*\*Animals in the Workplace\*\* \(page \d+\)\?/,
    );
  });

  it("flag on: two headings close is not confident — both are offered", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(closeHeadingReading("visitrs", ["Visitors", "Visiters"])).toEqual({ confident: null, candidates: ["Visitors", "Visiters"] });
  });

  it("flag on: a heading's title before \"of\" answers for it, and close to it too", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    const heading = "Care and Cleaning of Equipment and Facilities";
    expect(closeHeadingReading("care and clening", [heading, "Standards of Conduct"]).confident).toBe(heading);
  });

  it("flag on: words no heading is close to name nothing and ask nothing", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(cited("ca for avery for violating the parking lot policy")).toBeNull();
    expect(closePolicyQuestion("parking lot", JBA_MANUAL_CA_CHUNKS)).toBeNull();
  });
});

describe("close-spelling: QA's proof cases (13 Nov 2026)", () => {
  it("one letter off from two headings: not confident, both offered as \"A or B\"", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(closeHeadingReading("key holdr", ["Key Holder Guidelines", "Key Holder Requirements", "Standards of Conduct"])).toEqual({
      confident: null,
      candidates: ["Key Holder Guidelines", "Key Holder Requirements"],
    });
  });

  it("a word many headings share is never a confident match", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    expect(closeHeadingReading("wrkplace", HEADINGS).confident).toBeNull();
    expect(closeHeadingReading("workplace", HEADINGS).confident).toBeNull();
    expect(closeHeadingReading("sociall", HEADINGS).confident).toBeNull();
  });

  it("a long title with one word off, every word said, is confident; a word missing is not", () => {
    vi.stubEnv("CLOSE_SPELLING_MATCH_ENABLED", "true");
    const heading = "Texting as General Work communications";
    expect(closeHeadingReading("texting as general work comunications", [heading]).confident).toBe(heading);
    expect(closeHeadingReading("texting as general comunications", [heading]).confident).toBeNull();
  });
});
