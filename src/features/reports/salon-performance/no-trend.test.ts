import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * NO TREND MAY BE IMPLIED, IN CODE OR IN COPY.
 *
 * The reporting data holds ONE period. A line or area chart draws a path
 * between points, and a path between one point and nothing is an invention; a
 * caption saying "over time" makes the same claim in words. Both are easy to
 * add later by reflex — a reviewer asks for "a trend line" and it looks
 * harmless — so both are checked here rather than left to memory.
 *
 * This is a lint over the dashboard surface, not a proof about rendered output.
 * It catches the two ways the mistake actually gets made.
 */

const DASHBOARD_DIR = join(process.cwd(), "src", "features", "reports", "salon-performance");
const REPORTS_DIR = join(
  process.cwd(),
  "src",
  "app",
  "(app)",
  "reports",
  "salon-performance",
);
const DASHBOARD_PAGE = join(REPORTS_DIR, "page.tsx");
/**
 * The salon drill-down, which is where this mistake is likeliest.
 *
 * That page puts `Last 3 Months`, `Last 6 Months`, `Last 9 Months` and
 * `Last 12 Months` beside each other, which LOOKS like four points in time and
 * is not: each is a single figure the source calculated over its own span, and
 * the spans overlap. Joining them would be the most convincing wrong chart this
 * data can produce, so the page is scanned like the dashboard.
 */
const SALON_PAGE = join(REPORTS_DIR, "[salon]", "page.tsx");

/**
 * Chart primitives that draw a path through time.
 *
 * Matched as whole identifiers, so an IMPORT is caught and not just JSX usage —
 * an earlier version of this test only looked for `<Line`, which meant adding
 * `Line` to the recharts import list passed silently. Word boundaries keep
 * `ReferenceLine` and `LabelList` out of it: the zero spine is not a series.
 */
const TIME_SERIES_MARKS = [
  /\bLineChart\b/,
  /\bAreaChart\b/,
  /\bComposedChart\b/,
  /\bLine\b/,
  /\bArea\b/,
  /\bSparkline\b/,
];

/** Wording that asserts movement through time. */
const TREND_WORDS = [
  "trend",
  "over time",
  "trajectory",
  "month over month",
  "month-over-month",
  "year over year",
  "growth over",
  "time series",
  "trending",
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * Strips comments and the phrasings that mention a trend in order to deny it.
 *
 * The dashboard explains at length why it has no trend chart; scanning raw text
 * would flag that reasoning rather than a defect.
 */
function visibleCopy(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/not a trend/gi, "")
    .replace(/no trend/gi, "")
    .replace(/fabricated trend/gi, "");
}

describe("the dashboard draws no time series", () => {
  const files = [...sourceFiles(DASHBOARD_DIR), DASHBOARD_PAGE, SALON_PAGE];

  it("scans the dashboard surface", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports no line, area or composed chart primitive", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const code = visibleCopy(text);
      for (const mark of TIME_SERIES_MARKS) {
        // Comments are stripped so the explanation of WHY there is no line
        // chart does not trip the check.
        if (mark.test(code)) offenders.push(`${file}: ${mark.source}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses only categorical bar marks", () => {
    const charts = readFileSync(join(DASHBOARD_DIR, "charts.tsx"), "utf8");
    expect(charts).toContain("BarChart");
    // A zero reference line is the movers chart's spine, not a data series.
    expect(charts).toContain("ReferenceLine");
  });

  it("contains no wording that implies movement through time", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = visibleCopy(readFileSync(file, "utf8")).toLowerCase();
      for (const word of TREND_WORDS) {
        if (text.includes(word)) offenders.push(`${file}: "${word}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("describes the comparison as a baseline, not a progression", () => {
    const page = readFileSync(DASHBOARD_PAGE, "utf8");
    expect(page).toMatch(/baseline/i);
    // The chart section says outright that it is not a trend.
    expect(page).toMatch(/not a trend/i);
  });

  it("says so on the salon page too, where the windows sit side by side", () => {
    const page = readFileSync(SALON_PAGE, "utf8");
    expect(page).toMatch(/not a trend/i);
    // And names the reason the bars are not comparable as a sequence.
    expect(page).toMatch(/overlap/i);
  });
});
