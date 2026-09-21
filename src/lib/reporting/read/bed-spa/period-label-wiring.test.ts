import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ============================================================================
 * WHICH REPORT GETS THE RANGE LABEL
 * ============================================================================
 *
 * `spaEngagementPeriodLabel` is unit-tested next door; what this file pins is
 * WHERE IT IS WIRED, which is the part a reader of the fix has to take on
 * trust otherwise.
 *
 * The three families share one `groupPeriods` helper, and the temptation when
 * fixing the Spa Engagement label was to change the shared `periodLabel` and be
 * done. That would have relabelled Bed Usage and SPA Wellness too, for no
 * reason: Bed Usage delivers one period a month, SPA Wellness three windows
 * that all end on the month's last day, and naming the month is right for both.
 *
 * Asserted against the SOURCE rather than by calling the list functions,
 * because those reach Supabase and standing a database up to prove which
 * formatter a call site passes would be a larger change than the fix. A
 * mis-wiring here is a one-token edit, and a one-token edit is exactly what a
 * source contract catches.
 */

const READ_SOURCE = readFileSync(
  join(process.cwd(), "src/lib/reporting/read/bed-spa/read.ts"),
  "utf8",
);

/** The body of one `list…Periods` function, from its signature to its close. */
function listFunctionBody(name: string): string {
  const start = READ_SOURCE.indexOf(`export async function ${name}(`);
  expect(start, `${name} should exist in read.ts`).toBeGreaterThan(-1);
  const end = READ_SOURCE.indexOf("\n}", start);
  expect(end, `${name} should be a closed function`).toBeGreaterThan(start);
  return READ_SOURCE.slice(start, end);
}

describe("the Spa Engagement range label is wired to Spa Engagement only", () => {
  it("passes the range formatter from listSpaEngagementPeriods", () => {
    expect(listFunctionBody("listSpaEngagementPeriods")).toContain(
      "groupPeriods(data as Record<string, unknown>[], spaEngagementPeriodLabel)",
    );
  });

  it("leaves Bed Usage on the shared month label", () => {
    const body = listFunctionBody("listBedUsagePeriods");
    expect(body).toContain("groupPeriods(data as Record<string, unknown>[])");
    expect(body).not.toContain("spaEngagementPeriodLabel");
  });

  it("leaves SPA Wellness on the shared month label", () => {
    const body = listFunctionBody("listSpaWellnessPeriods");
    expect(body).toContain("groupPeriods(data as Record<string, unknown>[])");
    expect(body).not.toContain("spaEngagementPeriodLabel");
  });

  it("keeps the shared label as the default, so a new family opts in rather than out", () => {
    /*
     * The parameter's default is what makes adding it a no-op for everyone who
     * does not ask for it. If the default were ever flipped to the range
     * formatter, Bed Usage and SPA Wellness would change without their call
     * sites being touched.
     */
    expect(READ_SOURCE).toMatch(
      /formatLabel:\s*\(grain: string, periodStart: string, periodEnd: string\) => string\s*=\s*periodLabel/,
    );
  });

  it("changes no period identity anywhere in the helper", () => {
    /*
     * The label is the ONLY thing the formatter touches. `periodId`, `grain`,
     * `periodStart` and `periodEnd` are read straight off the row, which is
     * what keeps selection and the URL token working exactly as before.
     */
    const helper = READ_SOURCE.slice(
      READ_SOURCE.indexOf("function groupPeriods("),
      READ_SOURCE.indexOf("\n}", READ_SOURCE.indexOf("function groupPeriods(")),
    );
    expect(helper).toContain("label: formatLabel(grain, periodStart, periodEnd)");
    expect(helper).toContain("periodId,");
    expect(helper).toContain("periodStart,");
    expect(helper).toContain("periodEnd,");
    // The formatter is never consulted for anything but the label.
    expect(helper.match(/formatLabel\(/g)).toHaveLength(1);
  });
});
