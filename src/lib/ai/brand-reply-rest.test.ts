import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTIED_REPLY, ownBrandOnly, withOwnBrandOnly } from "./own-brand-only";
import type { AskResponse } from "./types";

/**
 * BRAND_REPLY_GUARD_ENABLED (ported from the sibling app: QA's October triage of its #198, 10 Nov 2026). The same reply
 * shapes, in this company's names. On main with production's flags (OWN_BRAND_ONLY on) the brand list kept the office,
 * the availability reply was dropped whole, and "SALON/STORE" stayed.
 */
const REPLIES = {
  attendance:
    "The attendance policy applies across all brands (Sun Tan City, Crunch, Buff City Soap, JB & Associates office) [p.14]. A no call no show for a scheduled shift may result in immediate termination [p.14].",
  availability: "Submit availability changes two weeks ahead in MyGlow for Sun Tan City, MyGlow for Buff City Soap, or Woven for Crunch Fitness [p.37].",
  lateOpeningUpper: "IF YOU CAN'T OPEN THE SALON/STORE ON TIME, NOTIFY YOUR MANAGER [p.15]. The employee reimburses $25.00 via payroll deduction [p.15].",
};

function reply(content: string): string {
  return withOwnBrandOnly({ content, citations: [] } as unknown as AskResponse).content;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("off (main, production's flags): the leaks", () => {
  it("the office stays in the list, the availability rule is dropped whole, SALON/STORE stays", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    expect(reply(REPLIES.attendance)).toContain("(Sun Tan City, JB & Associates office)");
    expect(reply(REPLIES.availability)).toBe("");
    expect(reply(REPLIES.lateOpeningUpper)).toContain("SALON/STORE");
  });
});

describe("on: only this company, every rule kept", () => {
  it("attendance: the brand list goes, the rule stays", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    expect(reply(REPLIES.attendance)).toBe(
      "The attendance policy applies across all brands [p.14]. A no call no show for a scheduled shift may result in immediate termination [p.14].",
    );
  });

  it("availability: this company's own system is kept", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    expect(reply(REPLIES.availability)).toBe("Submit availability changes two weeks ahead in MyGlow for Sun Tan City [p.37].");
  });

  it('QA\'s #266 leftover: "MyGlow for Sun Tan City, or MyGlow for Buff City Soap [p.37]" keeps this company\'s clause, never an empty reply', () => {
    const said = "Submit availability changes in MyGlow for Sun Tan City, or MyGlow for Buff City Soap [p.37].";
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    // Off (main, production's flags): the own-brand step blanks the whole sentence.
    expect(ownBrandOnly(said)).toBe("");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    expect(reply(said)).toBe("Submit availability changes in MyGlow for Sun Tan City [p.37].");
  });

  it("on: a reply the own-brand step would empty whole is never sent empty", () => {
    const said = "Crunch Fitness members check in with the Crunch app at the front desk [p.40].";
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    expect(reply(said)).toBe("");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    expect(reply(said)).toBe(EMPTIED_REPLY);
  });

  it('late opening: "SALON/STORE" is "SALON", in the case it was written in', () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    expect(reply(REPLIES.lateOpeningUpper)).toBe(
      "IF YOU CAN'T OPEN THE SALON ON TIME, NOTIFY YOUR MANAGER [p.15]. The employee reimburses $25.00 via payroll deduction [p.15].",
    );
    expect(reply("If you can't open the salon/store on time, call your manager.")).toBe("If you can't open the salon on time, call your manager.");
  });

  it.each([
    ["all lowercase", (text: string) => text.toLowerCase()],
    ["sentence case", (text: string) => text.charAt(0) + text.slice(1).toLowerCase()],
  ])("%s: the same rules are kept and no other brand is named", (_register, recase) => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    for (const text of Object.values(REPLIES)) {
      const out = reply(recase(text));
      expect(out, text).not.toMatch(/buff\s+city|crunch|store\b/i);
      expect(out.length, text).toBeGreaterThan(20);
    }
  });

  it("a reply that names no other brand is untouched", () => {
    vi.stubEnv("OWN_BRAND_ONLY_ENABLED", "true");
    vi.stubEnv("BRAND_REPLY_GUARD_ENABLED", "true");
    const text = "Cite the JBA Policy Manual, Late Opening, p.15. The Late Opening policy applies for any brand under JB & Associates.";
    expect(reply(text)).toBe(text);
  });
});
