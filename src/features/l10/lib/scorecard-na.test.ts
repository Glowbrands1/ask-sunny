import { describe, expect, it } from "vitest";
import { changeParts } from "./changes";
import { isNaCell, parseCell, setCell } from "./doc";
import { metricsSection } from "./report";
import type { MeetingDoc } from "./types";

// The owner, 24 Nov 2026: "should be able to add N/A" in a scorecard cell. Invented data.
const row = { id: "s1", metric: "Sales calls", owner: "Avery Quill", goal: "≥ 5", goalValue: 5, higherIsBetter: true, format: "number", weeks: [4, 6] };
const doc = () => ({ weekEndings: ["11/08/2026", "11/15/2026"], scorecard: [row] }) as unknown as MeetingDoc;

describe("N/A in the scorecard", () => {
  it("parseCell reads N/A, n/a, na and NA as N/A; other text is still not a number", () => {
    for (const t of ["N/A", "n/a", "na", "NA", " n / a "]) expect(parseCell(t)).toEqual({ ok: true, value: null, na: true });
    expect(parseCell("nan")).toEqual({ ok: false });
    expect(parseCell("12x")).toEqual({ ok: false });
  });

  it("setCell keeps N/A beside the numbers: the value is empty and the week is listed; a number clears it", () => {
    const marked = setCell(doc(), "s1", 1, null, true);
    const r = marked.scorecard[0];
    expect(r.weeks).toEqual([4, null]);
    expect(isNaCell(r, 1)).toBe(true);
    expect(isNaCell(r, 0)).toBe(false);
    const cleared = setCell(marked, "s1", 1, 9);
    expect(cleared.scorecard[0].weeks).toEqual([4, 9]);
    expect("na" in cleared.scorecard[0]).toBe(false);
  });

  it("the report prints N/A for that week, uncoloured", () => {
    const m = metricsSection(setCell(doc(), "s1", 1, null, true));
    expect(m.owners[0].rows[0].cells.map((c) => [c.text, c.tone])).toEqual([["4", "bad"], ["N/A", "plain"]]);
  });

  it("History counts marking a week N/A as a changed cell", () => {
    const before = setCell(doc(), "s1", 1, null);
    expect(changeParts(before, setCell(before, "s1", 1, null, true)).join(" ")).toMatch(/1 scorecard/);
  });
});
