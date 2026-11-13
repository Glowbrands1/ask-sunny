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

describe("a date the manager gave in other words is given (Gate-Sunny-3, 13 Nov 2026)", () => {
  const check = (source: string, written: string, today = "2026-11-13") => cleanupChanges({ source, written, today });

  it("\"the 2nd\" written out as a full date, and \"the 15th\"", () => {
    expect(check("create a CA form for quinn marlowe at kearney. Quinn was late on the 2nd", "Quinn Marlowe was late on October 2, 2026.")).toEqual([]);
    expect(check("she left early on the 15th", "She left early on October 15, 2026.")).toEqual([]);
  });

  it("\"last tuesday\", \"yesterday\" and a corrected year are the same day", () => {
    expect(check("she was late last tuesday", "She was late on Tuesday, November 10, 2026.")).toEqual([]);
    expect(check("she was late yesterday", "She was late on November 12, 2026.")).toEqual([]);
    expect(check("late on 10/2/25", "Late on October 2, 2026.")).toEqual([]);
  });

  it("a day the manager never named is still a changed date", () => {
    expect(check("Quinn was late on the 2nd", "Quinn was late on October 3, 2026.")).toEqual(["date October 3, 2026 was not given"]);
    expect(check("she was late last tuesday", "She was late on November 12, 2026.")).toEqual(["date November 12, 2026 was not given"]);
  });
});

describe("a policy page is the app's citation, not the manager's number (Gate-Sunny-3, 13 Nov 2026)", () => {
  it("\"JBA Policy Manual p.14\" and \"p. 12\" are not numbers that were not given; another number still is", () => {
    const source = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
    expect(cleanupChanges({ source, written: "Wrenna Calloway arrived late to work.\n\nPolicy reference: Attendance Policy, JBA Policy Manual p.14", today: TODAY })).toEqual([]);
    expect(cleanupChanges({ source, written: "Source: JBA Policy Manual — Standards of Conduct, p. 12", today: TODAY })).toEqual([]);
    expect(cleanupChanges({ source, written: "She was 25 minutes late.", today: TODAY })).toEqual(["number 25 was not given"]);
  });
});

describe("a yearless dashed date is given (Gate-Sunny-3, 13 Nov 2026: prior-sentence-fix T1)", () => {
  it("\"late on 10-5 and 10-15. i coached her on 10-16\" written out; 10-17 was not given", () => {
    const source = "late on 10-5 and 10-15. i coached her on 10-16";
    expect(cleanupChanges({ source, written: "She was late on October 5, 2026 and October 15, 2026. She was coached on October 16, 2026.", today: "2026-11-13" })).toEqual([]);
    expect(cleanupChanges({ source, written: "She was coached on October 17, 2026.", today: "2026-11-13" })).toEqual(["date October 17, 2026 was not given"]);
  });
});

describe("a possessive of a name is the same name (Gate-Sunny-3, 13 Nov 2026)", () => {
  it("\"Marnie Holloway's drawer\" and \"Sela's\" keep the name; a respelled possessive does not", () => {
    const source = "please make a ca for marnie holloway, she was late on 11/1/26 and left the drawer open";
    const names = ["Marnie Holloway"];
    expect(cleanupChanges({ source, names, today: TODAY, written: "Observed:\nMarnie Holloway's drawer was left open after she arrived late on 11/1/26." })).toEqual([]);
    expect(cleanupChanges({ source: "Sela was late", names: ["Sela Brightwater"], today: TODAY, written: "Observed:\nToday Sela’s shift began late." })).toEqual([]);
    expect(cleanupChanges({ source, names, today: TODAY, written: "Observed:\nMarnie Halloway's drawer was left open." })).toEqual(["name holloway was written Halloway"]);
  });
});
