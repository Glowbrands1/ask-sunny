import { describe, expect, it } from "vitest";

import { cleanupChanges, cleanupKeepsFacts, SPELLING_CLEANUP_RULES, withOwnWords } from "./spelling-cleanup";

/** SPELLING_CLEANUP_ENABLED (Pau via QA, 13 Nov 2026): the code check under the cleanup rule. People invented. */
const TODAY = "2026-11-10";
const SAID = "please make a ca for Brisa Talmadge for not doing th e10 minute sanitaion";

describe("the cleanup rule", () => {
  it("says what may change and what never does", () => {
    const rules = SPELLING_CLEANUP_RULES.join(" ");
    expect(rules).toMatch(/fix their spelling, spacing and capitals/);
    expect(rules).toMatch(/Never add a fact, soften or strengthen anything, or reword/);
    expect(rules).toMatch(/Never change a name, a date, a number or anything in quotation marks/);
  });
});

describe("cleanupChanges: spelling, spacing and capitals may change; names, dates, numbers and quotes may not", () => {
  it("the sanitation account, cleaned, keeps every fact", () => {
    expect(
      cleanupChanges({ source: SAID, written: "Observed:\nBrisa Talmadge did not complete the 10-minute sanitation.", today: TODAY, names: ["Brisa Talmadge"] }),
    ).toEqual([]);
  });

  it("a date written another way is the same day; a different day is not", () => {
    const source = "she was late on 11/2 and 11/3";
    expect(cleanupKeepsFacts({ source, written: "She was late on November 2, 2026 and November 3, 2026.", today: TODAY })).toBe(true);
    expect(cleanupChanges({ source, written: "She was late on November 4, 2026.", today: TODAY })).toEqual(["date November 4, 2026 was not given"]);
  });

  it("a number changed, or added, is refused", () => {
    expect(cleanupChanges({ source: "the drawer was $20 short", written: "The drawer was $25 short.", today: TODAY })).toEqual(["number 25 was not given"]);
    expect(cleanupKeepsFacts({ source: "the drawer was $20 short", written: "The drawer was $20.00 short.", today: TODAY })).toBe(true);
  });

  it("a quote is kept exactly as typed", () => {
    const source = 'she told the guest "we dont do refunds here"';
    expect(cleanupChanges({ source, written: 'She told the guest "we don\'t do refunds here."', today: TODAY })).toEqual([
      'quote "we don\'t do refunds here." is not as typed',
    ]);
    expect(cleanupKeepsFacts({ source, written: 'She told the guest "we dont do refunds here".', today: TODAY })).toBe(true);
  });

  it("a name respelled is refused; its capital mended is not", () => {
    expect(cleanupChanges({ source: SAID, written: "Brisa Talmage did not complete the sanitation.", today: TODAY, names: ["Brisa Talmadge"] })).toEqual([
      "name talmadge was written Talmage",
    ]);
    expect(cleanupKeepsFacts({ source: "she told marnie holloway to restock", written: "She told Marnie Holloway to restock.", today: TODAY, names: [] })).toBe(true);
    expect(
      cleanupKeepsFacts({ source: "she told Marnie Holloway to restock", written: "She told Marnie Holloway to restock.", today: TODAY, names: [] }),
    ).toBe(true);
  });

  it("nothing written is nothing to check", () => {
    expect(cleanupChanges({ source: SAID, written: "", today: TODAY })).toEqual([]);
  });
});

describe("patchCleanupChanges: the chat's form edits (Step B) under the same limits", () => {
  it("a patch that mends spelling keeps every fact; one that changes the date does not", async () => {
    const { patchCleanupChanges } = await import("./form-patch-model");
    const input = {
      today: TODAY,
      templateName: "Corrective Action Form",
      employeeName: "Brisa Talmadge",
      fields: [{ key: "observation", label: "Observation of Offense", kind: "long text", filledBy: "assistant" as const, value: "" }],
      readOnly: [],
      turns: [],
      latest: "add that she skiped the 10 minute sanitaion on 11/9",
    };
    expect(patchCleanupChanges(input, { set: { observation: "She skipped the 10-minute sanitation on November 9, 2026." }, clear: [] })).toEqual([]);
    expect(patchCleanupChanges(input, { set: { observation: "She skipped the 10-minute sanitation on November 8, 2026." }, clear: [] })).toEqual([
      "date November 8, 2026 was not given",
    ]);
  });
});

describe("withOwnWords: QA's safety ruling, the fallback checked again field by field", () => {
  it("a field that still changes the name gets the manager's own words; a field that keeps every fact stands", () => {
    const result = withOwnWords(
      { observation: "Observed:\nBrisa Talmage was not doing the 10-minute sanitation.", expectation: "Complete the 10-minute sanitation every shift." },
      { source: SAID, today: TODAY, names: ["Brisa Talmadge"], own: (key) => (key === "observation" ? SAID : null) },
    );
    expect(result.replaced).toEqual(["observation"]);
    expect(result.values).toEqual({ observation: SAID, expectation: "Complete the 10-minute sanitation every shift." });
  });

  it("with no own words for the field, it is left out so the form keeps what it holds", () => {
    const result = withOwnWords({ observation: 'She said "I don\'t care."' }, { source: 'she said "i dont care"', today: TODAY, own: () => null });
    expect(result).toEqual({ values: {}, replaced: ["observation"] });
  });
});
