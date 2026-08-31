import { describe, expect, it } from "vitest";

import {
  asBoolean,
  asDateIso,
  asNumber,
  asText,
  buildIso,
  normalizeHeader,
  stripYearTokens,
  yearTokens,
} from "./cells";
import { sheetViewFromGrid, columnIndex, columnLetter } from "./workbook";

/** Builds a single-cell sheet so the coercers can be exercised directly. */
function cell(value: string | number | boolean | Date | null) {
  return sheetViewFromGrid("t", [[value]]).cell(1, 1);
}

describe("asText", () => {
  it("normalises whitespace and returns null for blanks", () => {
    expect(asText(cell("  Fictional   District  One "))).toBe("Fictional District One");
    expect(asText(cell(""))).toBeNull();
    expect(asText(cell(null))).toBeNull();
    expect(asText(cell("   "))).toBeNull();
  });

  it("keeps a zero-padded identifier exactly as written", () => {
    expect(asText(cell("0468"))).toBe("0468");
  });
});

describe("asNumber", () => {
  it("passes numeric cells through, including zero and negatives", () => {
    expect(asNumber(cell(0))).toBe(0);
    expect(asNumber(cell(-0.0299))).toBe(-0.0299);
    expect(asNumber(cell(11469.87))).toBe(11469.87);
  });

  it("parses formatted currency and accounting negatives", () => {
    expect(asNumber(cell("$1,234.56"))).toBe(1234.56);
    expect(asNumber(cell("(1,234.56)"))).toBe(-1234.56);
    expect(asNumber(cell("-1234.56"))).toBe(-1234.56);
  });

  it("converts a text percentage to the fraction the schema stores", () => {
    expect(asNumber(cell("-2.99%"))).toBeCloseTo(-0.0299, 10);
    expect(asNumber(cell("0%"))).toBe(0);
  });

  it("refuses text that is not unambiguously a number", () => {
    // A placeholder is a missing figure, not a zero.
    expect(asNumber(cell("-"))).toBeNull();
    expect(asNumber(cell("N/A"))).toBeNull();
    expect(asNumber(cell("see note"))).toBeNull();
    expect(asNumber(cell("12abc"))).toBeNull();
    expect(asNumber(cell(""))).toBeNull();
  });

  it("never turns a salon number into a figure by accident", () => {
    // '0468' IS numeric text, so this documents that the parser must not run
    // salon numbers through asNumber — it reads them with asText.
    expect(asNumber(cell("0468"))).toBe(468);
    expect(asText(cell("0468"))).toBe("0468");
  });
});

describe("asBoolean", () => {
  it("accepts the spellings the export actually uses", () => {
    for (const truthy of ["Y", "Yes", "TRUE", "t", "comp"]) {
      expect(asBoolean(cell(truthy)), truthy).toBe(true);
    }
    for (const falsy of ["N", "No", "FALSE", "f", "non-comp"]) {
      expect(asBoolean(cell(falsy)), falsy).toBe(false);
    }
    expect(asBoolean(cell(true))).toBe(true);
    expect(asBoolean(cell(1))).toBe(true);
    expect(asBoolean(cell(0))).toBe(false);
  });

  it("returns null for anything unrecognised rather than defaulting to false", () => {
    expect(asBoolean(cell("maybe"))).toBeNull();
    expect(asBoolean(cell(""))).toBeNull();
    expect(asBoolean(cell(7))).toBeNull();
  });
});

describe("asDateIso and buildIso", () => {
  it("reads a real date cell in UTC", () => {
    expect(asDateIso(cell(new Date(Date.UTC(2021, 4, 17))))).toBe("2021-05-17");
  });

  it("reads unambiguous text dates", () => {
    expect(asDateIso(cell("03/14/2023"))).toBe("2023-03-14");
    expect(asDateIso(cell("2023-03-14"))).toBe("2023-03-14");
  });

  it("refuses an impossible date instead of rolling it forward", () => {
    // JavaScript would happily make this 2 March.
    expect(buildIso(2026, 2, 30)).toBeNull();
    expect(asDateIso(cell("02/30/2026"))).toBeNull();
  });

  it("refuses a two-digit year rather than guessing a century", () => {
    expect(asDateIso(cell("03/14/23"))).toBeNull();
  });
});

describe("header normalisation", () => {
  it("ignores punctuation that varies between template revisions", () => {
    expect(normalizeHeader("TY vs. 2024 % Change")).toBe("ty vs 2024 % change");
    expect(normalizeHeader("Ref: UID")).toBe("ref uid");
  });

  it("keeps characters that carry meaning", () => {
    // "% Change" must not collapse into "Change".
    expect(normalizeHeader("% Change")).toContain("%");
  });

  it("extracts and strips year tokens", () => {
    expect(yearTokens("2026 OTC Revenue")).toEqual([2026]);
    expect(yearTokens("2026 vs 2024 % Change")).toEqual([2026, 2024]);
    expect(yearTokens("OTC Revenue")).toEqual([]);
    expect(stripYearTokens("2026 OTC Revenue")).toBe("otc revenue");
  });
});

describe("column letters", () => {
  it("round-trips indices and letters", () => {
    expect(columnLetter(1)).toBe("A");
    expect(columnLetter(20)).toBe("T");
    expect(columnLetter(26)).toBe("Z");
    expect(columnLetter(27)).toBe("AA");
    expect(columnLetter(52)).toBe("AZ");
    for (const index of [1, 5, 20, 26, 27, 52, 703]) {
      expect(columnIndex(columnLetter(index))).toBe(index);
    }
  });

  it("always yields letters the schema's source_column check accepts", () => {
    for (let index = 1; index <= 300; index += 1) {
      expect(columnLetter(index)).toMatch(/^[A-Z]{1,3}$/);
    }
  });
});
