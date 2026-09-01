import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { aggregate } from "./aggregation";
import type { MetricAggregate } from "./types";

/**
 * NOTHING IN THE REPORTING SURFACE MAY CLAIM TO BE COMPANY-WIDE.
 *
 * The workbook is one recipient's filtered copy of a 116-slot template, so
 * every figure describes the salons in that copy and nothing more. The risk is
 * not a deliberate lie — it is a label. "Total Revenue" over fifteen salons,
 * captioned "Company Total", is how a slice becomes a chain number in a board
 * pack, and no amount of correct arithmetic upstream fixes it.
 *
 * Two guards, because one is not enough:
 *
 *   a TYPE guard — `companyWide` is the literal `false` on every aggregate, so
 *   claiming otherwise is a compile error;
 *
 *   a TEXT guard — this suite reads the reporting source and fails on wording
 *   that asserts chain-wide coverage. A comment saying "not company-wide" is
 *   fine; a caption saying "Company Total" is not.
 */

const ROOTS = [
  join(process.cwd(), "src", "lib", "reporting"),
  join(process.cwd(), "src", "features", "reports", "salon-performance"),
];

/** Wording that asserts coverage this data cannot support. */
const FORBIDDEN = [
  "company total",
  "companywide total",
  "chain total",
  "chain-wide total",
  "total for the company",
  "all salons total",
  "entire chain",
  "across the company",
  "company performance",
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    // Tests and fixtures are not shipped to a reader, and their names
    // legitimately describe the thing being forbidden ("does not compute any
    // company total"). Only code that can render copy is a labelling risk.
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (path.includes("__fixtures__")) continue;
    if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

/**
 * Strips comments before scanning.
 *
 * This matters more than it looks. The reporting modules discuss company totals
 * at length precisely in order to forbid them — "does not compute company
 * totals", "totals are not chain totals" — so a naive scan over whole files
 * flags the very reasoning that prevents the defect. Comments are where the
 * prohibition is explained; only what a USER can read is a labelling risk.
 *
 * The remaining negations are few and stable once comments are gone, so they
 * are listed rather than pattern-matched.
 *
 * This is a lint-style heuristic, not a proof: it catches the phrasings we know
 * turn a slice into a chain number. The structural guarantee is the `false`
 * literal on `MetricAggregate.companyWide`.
 */
function visibleCopy(text: string): string {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  return withoutComments
    .replace(/not company-wide/gi, "")
    .replace(/never company-wide/gi, "")
    .replace(/are not chain totals/gi, "")
    .replace(/companyWide/g, "");
}

describe("no company-wide labelling in the reporting surface", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("scans a meaningful number of files", () => {
    // Guard against a vacuous pass if the layout moves.
    expect(files.length).toBeGreaterThan(10);
  });

  it("contains no wording that claims chain-wide coverage", () => {
    const offenders: string[] = [];
    for (const file of files) {
      // The guard must not flag itself.
      if (file.endsWith("no-company-wide.test.ts")) continue;
      const text = visibleCopy(readFileSync(file, "utf8")).toLowerCase();
      for (const phrase of FORBIDDEN) {
        if (text.includes(phrase)) offenders.push(`${file}: "${phrase}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the recipient-slice caveat in the scope banner", () => {
    const banner = readFileSync(
      join(process.cwd(), "src", "features", "reports", "salon-performance", "scope-banner.tsx"),
      "utf8",
    );
    expect(banner).toContain("Recipient slice");
    expect(banner).toContain("not company-wide");
  });
});

describe("aggregates carry their scope structurally", () => {
  it("stamps companyWide false on every aggregate", () => {
    const result = aggregate({
      metricCode: "total_revenue",
      basisYear: 2026,
      unit: "currency",
      values: [1, 2, 3],
      salonCount: 3,
    });
    expect(result.companyWide).toBe(false);
  });

  it("cannot be constructed as company-wide", () => {
    // A compile-time guarantee, asserted here so its intent is recorded: the
    // field's type is the literal `false`, so `companyWide: true` does not
    // type-check anywhere in the codebase.
    const claim: MetricAggregate["companyWide"] = false;
    expect(claim).toBe(false);
  });

  it("always reports the denominator alongside the figure", () => {
    const result = aggregate({
      metricCode: "total_revenue",
      basisYear: 2026,
      unit: "currency",
      values: [10, 20],
      salonCount: 2,
    });
    // A number without its denominator is what invites a chain-wide reading.
    expect(result.salonCount).toBe(2);
    expect(Object.keys(result)).toContain("salonCount");
  });
});
