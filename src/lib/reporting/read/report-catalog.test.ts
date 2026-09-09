import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BED_USAGE_MEASURES } from "../bed-usage/metric-map";
import { COMP_SALES_METRICS } from "../comp-sales/metric-catalogue";
import { SALES_TOTALS_METRIC_CODES } from "../sales-totals/metric-map";
import { PERIOD_SOURCES } from "./report-catalog";
import {
  REPORT_FAMILIES,
  REPORT_FAMILIES_BY_ID,
  REPORT_FAMILY_IDS,
  type ReportFamilyId,
} from "./report-families";

/**
 * ============================================================================
 * ONE CATALOG, AND A SEAM A SIXTH FAMILY FITS THROUGH
 * ============================================================================
 *
 * Two questions this suite answers, and the second is the long-term one.
 *
 * 1. IS THE CAPABILITY MODEL COMPLETE AND HONEST? Every family declares its
 *    windows, measures, dimensions, metric authority and reasoning framework,
 *    and the measures are the ones the maps that already define them actually
 *    hold — not a second list somebody has to remember to update.
 *
 * 2. WHAT DOES ADDING A SIXTH FAMILY COST? The answer has to be "a registry
 *    entry, a period source, a parser and a loader" — not "an edit to the
 *    routing, the composer and the chat orchestration". That is proved
 *    structurally rather than asserted in prose: the modules that would have to
 *    change are read and checked for per-family branching.
 *
 * The database is never touched. `PERIOD_SOURCES` is inspected as a map, not
 * invoked; whether each source returns the right rows is the read layer's own
 * suite, and this is about the seam around them.
 */

/* ================================================= the capability model == */

describe("every family declares a complete capability", () => {
  for (const family of REPORT_FAMILIES) {
    it(`${family.id} declares windows, measures, authority and a framework decision`, () => {
      expect(family.periodTypes.length, "windows").toBeGreaterThan(0);
      expect(family.metrics.length, "measures").toBeGreaterThan(0);
      // `dimensions` may legitimately be EMPTY — see Sales Totals below — so
      // it is checked for presence rather than length.
      expect(Array.isArray(family.dimensions), "dimensions").toBe(true);
      expect(family.metricAuthority.length, "authority").toBeGreaterThan(40);
      /*
       * BOTH AUTHORITIES, ON EVERY FAMILY. They answer different questions —
       * what the number is, and what the manager should do about it — so
       * neither is optional and neither substitutes for the other.
       */
      expect(family.actionFramework, "action framework").toBe(
        "daily_stats_interpretation_framework",
      );
      expect(family.sourceReport.length, "source report").toBeGreaterThan(3);
      expect(family.carries.length, "what it carries").toBeGreaterThan(40);
    });
  }

  it("derives its measures from the maps that already define them", () => {
    /*
     * THE ASSERTION THAT STOPS THE CATALOG DRIFTING FROM THE PARSERS. A second
     * hand-typed list of metric codes is a second thing to forget, and the
     * failure is silent both ways: the catalog advertises a measure the loader
     * has no mapping for, or omits one it can read.
     */
    expect(REPORT_FAMILIES_BY_ID["sales-totals"].metrics).toEqual(
      SALES_TOTALS_METRIC_CODES,
    );
    expect(REPORT_FAMILIES_BY_ID["salon-performance"].metrics).toEqual(
      COMP_SALES_METRICS.map((metric) => metric.code),
    );
    expect(REPORT_FAMILIES_BY_ID["bed-usage"].metrics).toEqual(
      BED_USAGE_MEASURES.map((measure) => measure.code),
    );
  });

  it("names the spa measures directly, because they have no metric map", async () => {
    /*
     * Spa Wellness and Spa Engagement compute their measures with named
     * analytics FUNCTIONS rather than reading named columns, so there is
     * nothing to derive from. Each declared name is pinned to the module that
     * produces it, so renaming a measure in one place breaks this rather than
     * leaving the catalog describing something that no longer exists.
     */
    const engagement = readFileSync(
      "src/lib/reporting/read/bed-spa/spa-engagement-analytics.ts",
      "utf8",
    );
    for (const [metric, producer] of [
      ["spa_sessions_per_bed", "spaSessionsPerBed"],
      ["spa_sessions_per_unique_per_bed", "spaSessionsPerUniquePerBed"],
      ["unique_spa_tanner_percent", "uniqueSpaTannerPercent"],
      ["spa_per_unique_percent", "spaPerUniquePercent"],
    ] as const) {
      expect(
        REPORT_FAMILIES_BY_ID["spa-engagement"].metrics,
        `${metric} must be declared`,
      ).toContain(metric);
      expect(engagement, `${producer} must exist to produce ${metric}`).toContain(
        `export function ${producer}`,
      );
    }

    const wellness = readFileSync(
      "src/lib/reporting/read/bed-spa/spa-wellness-analytics.ts",
      "utf8",
    );
    expect(REPORT_FAMILIES_BY_ID["spa-wellness"].metrics).toContain("peer_average");
    expect(wellness).toContain("export function equipmentPerformance");
  });

  it("records that Sales Totals carries no dimension at all", () => {
    /*
     * A FACT ABOUT THE REPORT, not an unfinished field. It carries a company
     * column and a salon name and nothing else — no district, no region, no
     * ownership group — so a district filter on that family would be a control
     * that cannot work. The catalog says so rather than letting one be built.
     */
    expect(REPORT_FAMILIES_BY_ID["sales-totals"].dimensions).toEqual([]);
    // And the families that DO carry dimensions say which.
    expect(REPORT_FAMILIES_BY_ID["bed-usage"].dimensions).toContain("district");
    expect(REPORT_FAMILIES_BY_ID["spa-wellness"].dimensions).toContain("equipment");
  });
});

/* ============================================== bed and spa authority == */

describe("the bed and spa families keep their own metric authority", () => {
  /*
   * THE SEPARATION IS BY QUESTION, NOT BY FAMILY, and the first revision of
   * this suite had it wrong: it asserted that no reasoning framework applied to
   * the three bed and spa families. That protected their formulas by declaring
   * something untrue — that the manager reasoning model does not apply to Bed
   * Usage — when a manager asking why Spa is weak needs it just as much as one
   * asking about revenue.
   */
  it("applies the SAME action framework to all five", () => {
    for (const id of REPORT_FAMILY_IDS) {
      expect(REPORT_FAMILIES_BY_ID[id].actionFramework, id).toBe(
        "daily_stats_interpretation_framework",
      );
    }
  });

  it("keeps every family's metric authority in CODE, never in a document", () => {
    /*
     * The half that does differ per family, and the half that must never be a
     * knowledge base document: what the number is and what band it falls in.
     */
    for (const id of REPORT_FAMILY_IDS) {
      const authority = REPORT_FAMILIES_BY_ID[id].metricAuthority;
      expect(authority, id).toMatch(/\.ts\b/);
      expect(authority.toLowerCase(), id).not.toContain("framework");
      expect(authority.toLowerCase(), id).not.toContain("knowledge base");
    }
  });

  it("names the approved rule that decides each family's numbers", () => {
    // The FAST capacity exemption.
    expect(REPORT_FAMILIES_BY_ID["bed-usage"].metricAuthority).toContain("FAST");
    expect(REPORT_FAMILIES_BY_ID["bed-usage"].metricAuthority).toContain("never a failure");
    // The equipment-presence rule.
    expect(REPORT_FAMILIES_BY_ID["spa-wellness"].metricAuthority).toContain(
      "NOT INSTALLED",
    );
    expect(REPORT_FAMILIES_BY_ID["spa-wellness"].metricAuthority).toContain("non-zero");
    // The summed conversion, and the two distinct spa ratios.
    expect(REPORT_FAMILIES_BY_ID["spa-engagement"].metricAuthority).toContain(
      "SUM(sessions) / SUM(tans)",
    );
    expect(REPORT_FAMILIES_BY_ID["spa-engagement"].metricAuthority).toContain(
      "never the mean of per-salon rates",
    );
    expect(REPORT_FAMILIES_BY_ID["spa-engagement"].metricAuthority).toContain(
      "different denominators",
    );
  });
});

/* ==================================================== the extension seam == */

describe("a sixth family plugs in without core Chat surgery", () => {
  it("needs a period source, and the type system makes a missing one a build error", () => {
    /*
     * `PERIOD_SOURCES` is a `Record` over `ReportFamilyId`, so adding an id to
     * the registry without adding a source here does not compile. That is the
     * seam: the compiler asks for the one thing a new family must supply,
     * rather than the family silently reporting no periods forever.
     */
    expect(Object.keys(PERIOD_SOURCES).sort()).toEqual([...REPORT_FAMILY_IDS].sort());
    for (const id of REPORT_FAMILY_IDS) {
      expect(typeof PERIOD_SOURCES[id], id).toBe("function");
      // One argument: the company. No family's listing may take anything else,
      // because anything else would be a parameter a request could reach.
      expect(PERIOD_SOURCES[id].length, id).toBeLessThanOrEqual(1);
    }
  });

  it("requires no per-family branch in the routing", () => {
    /*
     * Routing reads `FAMILY_QUESTION_TERMS[id]` and `REPORT_FAMILY_IDS`. A new
     * family gets routed by adding its vocabulary to the registry-keyed record
     * — there is no `if (family === "bed-usage")` to extend.
     */
    const routing = readFileSync("src/lib/reporting/read/family-routing.ts", "utf8");
    expect(routing).toContain("for (const id of REPORT_FAMILY_IDS)");
    expect(routing).not.toMatch(/if \(family === "/);
    expect(routing).not.toMatch(/switch \(family\)/);
  });

  it("requires no edit to the chat orchestration", () => {
    /*
     * `server-ask.ts` must never name a family. It routes, it loads, it hands
     * the block to the model — all through `ReportFamilyId` — so a sixth family
     * reaches Chat without this file being opened.
     */
    const serverAsk = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    for (const id of REPORT_FAMILY_IDS) {
      expect(serverAsk, `server-ask must not name ${id}`).not.toContain(`"${id}"`);
    }
    expect(serverAsk).toContain("routeReportFamilies(request.question)");
    expect(serverAsk).toContain("loadReportBriefing({");
  });

  it("names the four things a new family actually needs", () => {
    /*
     * WRITTEN DOWN WHERE SOMEBODY WILL FIND IT. The composer's own header names
     * the seam, so the next person adding Bonus Viewer or a true Daily Stats
     * feed reads it before touching anything.
     */
    const catalog = readFileSync("src/lib/reporting/read/report-catalog.ts", "utf8");
    expect(catalog).toContain("THE EXTENSION SEAM");
    expect(catalog).toContain("registry entry");
  });

  it("still holds only five families, and Bonus Viewer is not one", () => {
    /*
     * The seam existing is not a reason to walk through it. Bonus Viewer has a
     * knowledge base framework and NO ingested data source, so a family for it
     * would have a loader that could only ever return nothing — and a "no
     * current delivery" message for a report nobody sends.
     */
    expect(REPORT_FAMILY_IDS).toHaveLength(5);
    expect(REPORT_FAMILY_IDS as readonly string[]).not.toContain("bonus-viewer");
    expect(REPORT_FAMILY_IDS as readonly string[]).not.toContain("daily-stats");
    expect(REPORT_FAMILY_IDS as readonly string[]).not.toContain("employee-performance");
  });
});

/* ============================================ the composer stays generic == */

describe("the composer treats families by capability, not by name", () => {
  const composer = readFileSync("src/lib/reporting/read/report-briefing.ts", "utf8");

  it("resolves every requested family's period through one loop", () => {
    expect(composer).toContain("for (const family of requested)");
    expect(composer).toContain("resolvePeriod({");
  });

  it("names a family only where the three loaders genuinely differ", () => {
    /*
     * IT DOES NAME THEM, and pretending otherwise would be dishonest: Sales
     * Totals, the Comp Report and the bed/spa trio have three different loader
     * signatures because they read three different schemas, and the bed/spa
     * block is one rendered unit spanning three families.
     *
     * What is asserted is that the naming is CONFINED to dispatching those
     * three loaders. Everything else — routing, period resolution, freshness,
     * the no-data rule, the header — is driven by the registry.
     */
    const named = (REPORT_FAMILY_IDS as readonly string[]).filter((id) =>
      composer.includes(`"${id}"`),
    );
    expect(named.sort()).toEqual(
      ["bed-usage", "sales-totals", "salon-performance", "spa-engagement", "spa-wellness"].sort(),
    );

    // And the generic paths do not: no family id inside the freshness, no-data
    // or period-reporting sections.
    const genericHalf = composer.slice(composer.indexOf("const freshness"));
    for (const id of REPORT_FAMILY_IDS) {
      expect(genericHalf, `the generic half must not name ${id}`).not.toContain(`"${id}"`);
    }
  });

  it("reads the catalog once for exactly the families it needs", () => {
    expect(composer).toContain("loadReportCatalog({");
    expect(composer).toContain("families: requested");
  });
});

/* ================================================= the catalog's posture == */

describe("the catalog reads metadata only, and never widens the company", () => {
  const catalog = readFileSync("src/lib/reporting/read/report-catalog.ts", "utf8");

  it("takes the company from the read layer, not from a request", () => {
    expect(catalog).toContain("options.company ?? AUTHORIZED_COMPANY");
    // No question, history or context field can reach it.
    expect(catalog).not.toContain("request");
    expect(catalog).not.toContain("ChatReportContext");
  });

  it("never throws, so a period listing failure costs metadata and not an answer", () => {
    expect(catalog).toContain("} catch {");
    expect(catalog).toContain("return empty(family, company)");
  });

  it("gives every family a load time, so freshness can tell stale from stopped", () => {
    /*
     * FOUND IN PREVIEW QA, and asserted on the source because the alternative
     * is a fifth database fixture for a one-line mapping. Salon Performance was
     * the only family whose `CatalogPeriod` carried `ingestedAt: null` — a
     * literal, not a missing column — so it was the only family whose freshness
     * sentence had no "loaded" clause. `FRESHNESS_RULE` distinguishes a
     * finished period that arrived last night from a delivery that has stopped
     * arriving, and for the Comp Report that instruction had no data.
     *
     * `multi-period.test.ts` proves the repository now carries the timestamp
     * out; this proves nothing here throws it away again.
     */
    expect(catalog).toContain("ingestedAt: period.ingestedAt");

    // Scoped to the period sources rather than the whole file: a family whose
    // source genuinely records no load time is allowed to say so one day, but
    // not one whose source has the timestamp and drops it.
    const sources = catalog.slice(
      catalog.indexOf("export const PERIOD_SOURCES"),
      catalog.indexOf("function startOfWindow"),
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).not.toMatch(/ingestedAt: null/);
  });

  it("is server-only, because it reads Postgres", () => {
    expect(catalog.startsWith('import "server-only";')).toBe(true);
  });

  it("reads no figure — only ids, dates, labels, timestamps and counts", () => {
    /*
     * What keeps the catalog cheap enough to build on any turn that mentions a
     * period. Loading figures here would double the cost of every reporting
     * answer and duplicate what the family's own analytics loader does.
     */
    for (const forbidden of ["loadBedUsage(", "loadSpaWellness(", "loadSalesTotals(", "getFactRows"]) {
      expect(catalog, `the catalog must not call ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ============================================ the registry stays aligned == */

describe("the registry, the routes and the tabs agree", () => {
  it("has one entry per family id, with no duplicates", () => {
    expect(REPORT_FAMILIES).toHaveLength(REPORT_FAMILY_IDS.length);
    expect(new Set(REPORT_FAMILIES.map((family) => family.id)).size).toBe(
      REPORT_FAMILIES.length,
    );
  });

  it("points every family at a route that exists", async () => {
    const { REPORTS } = await import("@/features/reports/reports-routes");
    for (const family of REPORT_FAMILIES) {
      const route = REPORTS.find((report) => report.key === (family.id as ReportFamilyId));
      expect(route, family.id).toBeDefined();
      expect(route!.path).toBe(family.path);
    }
  });

  it("stays client-safe, so the report tabs can import it", () => {
    /*
     * COMMENTS STRIPPED, because the registry's own header explains that it
     * must not reach for `server-only` or `process.env` — scanning the raw file
     * would fail on the documentation of the rule being checked.
     */
    const registry = readFileSync("src/lib/reporting/read/report-families.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(registry).not.toContain('import "server-only"');
    expect(registry).not.toContain("process.env");
    expect(registry).not.toContain("getSupabaseAdmin");
    // And it imports nothing from a server-only module.
    expect(registry).not.toContain("/supabase");
  });
});
