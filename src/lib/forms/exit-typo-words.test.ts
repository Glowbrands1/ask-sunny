import { afterEach, describe, expect, it, vi } from "vitest";

import { readExitDetails, withExitWordsSpelled } from "./exit-details";

// Pau's P17 (Sunny production, 10 Nov 2026), the manager's words; the employee is not named.
const SAID = "salon items will be returneded and they are eligiable for rehire. payroll not deducted";

const answers = (text: string) => {
  const read = readExitDetails(text, "2026-11-10").answers;
  return { items: read.store_items_returned, rehire: read.eligible_for_rehire, payroll: read.payroll_deduction_applicable };
};

describe("EXIT_TYPO_WORDS_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the misspelled answers are left blank (the bug); payroll is read", () => {
    // The off case sets the flag itself, so it holds whatever the environment has on (QA, Gate-Sunny on #793).
    vi.stubEnv("EXIT_TYPO_WORDS_ENABLED", "");
    expect(answers(SAID)).toEqual({ items: undefined, rehire: undefined, payroll: "no" });
  });

  it("on: \"returneded\" and \"eligiable\" are read as returned and eligible", () => {
    vi.stubEnv("EXIT_TYPO_WORDS_ENABLED", "true");
    expect(answers(SAID)).toEqual({ items: "yes", rehire: "yes", payroll: "no" });
  });

  it("real words are never corrected; a correctly spelled turn is unchanged", () => {
    expect(withExitWordsSpelled("she retired and is reliable")).toBe("she retired and is reliable");
    expect(withExitWordsSpelled("items returned, eligible for rehire")).toBe("items returned, eligible for rehire");
    expect(withExitWordsSpelled("not elegible for rehre")).toBe("not eligible for rehire");
  });
});

// QA, R713 (Gate-Bubbles, 11 Nov 2026): real words missing from REAL_WORDS were "corrected" into the readers' words —
// required, repaired, revived and rewired became "rehired"; detected and defected "deducted"; forested "forfeited".
describe("EXIT_TYPO_WORDS_ENABLED: real words stay as written (QA, R713)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const QA_SAID = "he quit on 11/8/26. he is not required back. payroll not deducted";

  it("\"he is not required back\" is not read as \"not rehired\": Eligible for Rehire is read the same as with the flag off", () => {
    vi.stubEnv("EXIT_TYPO_WORDS_ENABLED", "");
    const off = answers(QA_SAID);
    vi.stubEnv("EXIT_TYPO_WORDS_ENABLED", "true");
    const on = answers(QA_SAID);
    expect(on.rehire).not.toBe("no");
    expect(on).toEqual(off);
    expect(on.payroll).toBe("no");
  });

  it.each([
    "require", "requires", "requiring", "required",
    "repair", "repairs", "repairing", "repaired",
    "revive", "revives", "reviving", "revived",
    "rewire", "rewires", "rewiring", "rewired",
    "detect", "detects", "detecting", "detected",
    "defect", "defects", "defecting", "defected",
    "forest", "forests", "foresting", "forested",
    // The same check over an English word list found these too (one or two letters from a reader's word).
    "maximum", "dedicated", "retaining", "revised", "retried", "resized", "depicted", "dejected", "recited", "refined",
  ])("%s is never changed", (word) => {
    expect(withExitWordsSpelled(`he ${word} it`)).toBe(`he ${word} it`);
  });
});
