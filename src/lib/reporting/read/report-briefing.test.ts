import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE FIVE-FAMILY REPORT BLOCK
 * ============================================================================
 *
 * Two properties are being proved here, and the second is the one that would
 * hurt somebody if it broke.
 *
 * 1. THE RIGHT FAMILIES ARE LOADED, ONCE, IN REASONING ORDER. A question that
 *    routed to two families must not read all five, and must read the two in
 *    the order the model weights.
 *
 * 2. A FAMILY THAT WAS ASKED FOR AND HAS NO DELIVERY IS NAMED. Not merely
 *    absent — named, with the report that would carry it and an instruction to
 *    say so. The dangerous failure is not a missing section; it is a missing
 *    section that looks like an answer. Ask "why is Spa weak?" with no Spa
 *    Wellness delivery ingested and an answer assembled from bed usage and
 *    engagement alone reads as complete while being blind to the equipment.
 *
 * THE LOADERS ARE MOCKED, and only the loaders. Each of the three reads
 * Postgres through the dashboards' own read layer, and those layers have their
 * own suites; what is under test here is the composition — which loaders are
 * called, what the block says about the ones that returned nothing, and that
 * nothing in this path can reach a sample workbook.
 */

const loadSalesTotalsSection = vi.fn();
const loadSalonPerformanceSection = vi.fn();
const loadBedSpaSections = vi.fn();
const loadReportCatalog = vi.fn();

vi.mock("./sales-totals-briefing-source", () => ({
  loadSalesTotalsSection: (...args: unknown[]) => loadSalesTotalsSection(...args),
}));
vi.mock("./salon-performance-briefing-source", () => ({
  loadSalonPerformanceSection: (...args: unknown[]) => loadSalonPerformanceSection(...args),
}));
vi.mock("./bed-spa/briefing-source", () => ({
  loadBedSpaSections: (...args: unknown[]) => loadBedSpaSections(...args),
}));
/*
 * THE CATALOG IS MOCKED TOO, because it is a database read like the loaders.
 * It supplies the PERIODS the composer resolves "last month" and freshness
 * against, so a test that left it real would be testing Supabase's absence.
 */
vi.mock("./report-catalog", () => ({
  loadReportCatalog: (...args: unknown[]) => loadReportCatalog(...args),
}));

const { loadReportBriefing, NO_DATA_RULE, REPORT_DATA_RULES } = await import(
  "./report-briefing"
);
const { SALES_TOTALS_BRIEFING_RULES } = await import("./sales-totals-briefing");
const { SALON_PERFORMANCE_BRIEFING_RULES } = await import("./salon-performance-briefing");

const { REPORT_FAMILIES_BY_ID } = await import("./report-families");

/**
 * A catalog holding one month-to-date period per family, plus whatever extra
 * periods a test asks for.
 *
 * Dates are relative to a fixed anchor only so the fixtures read clearly; no
 * assertion depends on the month, and the future-period suite proves the
 * resolution moves when the data does.
 */
function catalogWith(
  extra: Partial<Record<string, { type: string; start: string; end: string; label: string }[]>> = {},
) {
  const base = (end: string, label: string) => ({
    id: `mtd:${end}`,
    type: "mtd" as const,
    start: `${end.slice(0, 7)}-01`,
    end,
    label,
    ingestedAt: "2026-09-01T06:00:00Z",
    salonCount: 15,
  });

  const families = Object.values(REPORT_FAMILIES_BY_ID).map((family) => {
    const periods = [
      base("2026-08-31", "Aug 2026"),
      ...(extra[family.id] ?? []).map((period) => ({
        id: `${period.type}:${period.end}`,
        ...period,
        type: period.type as "mtd",
        ingestedAt: "2026-09-01T06:00:00Z",
        salonCount: 15,
      })),
    ];
    return {
      family,
      periods,
      latest: periods[0],
      deliveredTypes: ["mtd"],
      lastIngestedAt: "2026-09-01T06:00:00Z",
      company: "JB and Associates",
    };
  });

  return {
    company: "JB and Associates",
    families,
    byFamily: Object.fromEntries(families.map((status) => [status.family.id, status])),
  };
}

/** Every family loads and returns a recognisable section. */
function everythingLoads() {
  loadSalesTotalsSection.mockResolvedValue({
    text: "SALES TOTALS — report date 2026-09-03.",
    reportDate: "2026-09-03",
  });
  loadSalonPerformanceSection.mockResolvedValue({
    text: "SALON PERFORMANCE (Comp Report) — MTD period.",
    periodLabel: "08/30/2026",
  });
  loadBedSpaSections.mockResolvedValue({
    text: "REPORT DATA — JB and Associates\n\nBED USAGE — mtd. SPA WELLNESS — mtd. SPA ENGAGEMENT — mtd.",
    present: ["bed-usage", "spa-wellness", "spa-engagement"],
  });
}

/** Nothing has been ingested at all. */
function nothingLoads() {
  loadSalesTotalsSection.mockResolvedValue(null);
  loadSalonPerformanceSection.mockResolvedValue(null);
  loadBedSpaSections.mockResolvedValue({ text: null, present: [] });
}

beforeEach(() => {
  loadSalesTotalsSection.mockReset();
  loadSalonPerformanceSection.mockReset();
  loadBedSpaSections.mockReset();
  loadReportCatalog.mockReset();
  loadReportCatalog.mockResolvedValue(catalogWith());
});

describe("no families means no block", () => {
  it("returns null, so a policy question is unaffected", () => {
    /*
     * A policy question, a form request or a greeting routes to nothing, and
     * this must be indistinguishable from the pipeline before report grounding
     * existed. In particular it must not load anything.
     */
    return loadReportBriefing({ families: [] }).then((briefing) => {
      expect(briefing).toBeNull();
      expect(loadSalesTotalsSection).not.toHaveBeenCalled();
      expect(loadSalonPerformanceSection).not.toHaveBeenCalled();
      expect(loadBedSpaSections).not.toHaveBeenCalled();
    });
  });
});

describe("only the families the question needed are read", () => {
  it("reads Sales Totals and Salon Performance for a daily question", async () => {
    everythingLoads();
    await loadReportBriefing({ families: ["sales-totals", "salon-performance"] });

    expect(loadSalesTotalsSection).toHaveBeenCalledTimes(1);
    expect(loadSalonPerformanceSection).toHaveBeenCalledTimes(1);
    // The bed and spa read is four database round trips. A daily question must
    // not pay for it.
    expect(loadBedSpaSections).not.toHaveBeenCalled();
  });

  it("reads the bed and spa block once, however many of its three were wanted", async () => {
    everythingLoads();
    await loadReportBriefing({ families: ["bed-usage", "spa-wellness", "spa-engagement"] });

    expect(loadBedSpaSections).toHaveBeenCalledTimes(1);
    expect(loadSalesTotalsSection).not.toHaveBeenCalled();
  });

  it("places the sections in reasoning order, not tab order", async () => {
    everythingLoads();
    const briefing = await loadReportBriefing({
      families: ["spa-engagement", "salon-performance", "sales-totals"],
    });

    const text = briefing!.text;
    expect(text.indexOf("SALES TOTALS —")).toBeLessThan(
      text.indexOf("SALON PERFORMANCE (Comp Report)"),
    );
    expect(text.indexOf("SALON PERFORMANCE (Comp Report)")).toBeLessThan(
      text.indexOf("SPA ENGAGEMENT"),
    );
    expect(briefing!.requested).toEqual([
      "sales-totals",
      "salon-performance",
      "spa-engagement",
    ]);
  });

  it("carries only the rules of the families it loaded", async () => {
    everythingLoads();
    const daily = await loadReportBriefing({ families: ["sales-totals"] });

    expect(daily!.text).toContain(SALES_TOTALS_BRIEFING_RULES);
    // Stating the Comp Report's rules on a turn with no Comp Report figures
    // describes a source that is not there.
    expect(daily!.text).not.toContain(SALON_PERFORMANCE_BRIEFING_RULES);
    // The shared rules are on every block.
    expect(daily!.text).toContain(REPORT_DATA_RULES);
  });
});

describe("the no-data rule", () => {
  it("names a requested family that has no delivery, and the report that carries it", async () => {
    everythingLoads();
    loadBedSpaSections.mockResolvedValue({
      text: "BED USAGE — mtd. SPA ENGAGEMENT — mtd.",
      present: ["bed-usage", "spa-engagement"],
    });

    const briefing = await loadReportBriefing({
      families: ["spa-engagement", "spa-wellness", "bed-usage"],
    });

    expect(briefing!.missing).toEqual(["spa-wellness"]);
    expect(briefing!.present).toEqual(["bed-usage", "spa-engagement"]);
    expect(briefing!.text).toContain("NOT LOADED");
    expect(briefing!.text).toContain("Spa Wellness: no current delivery");
    // Naming what the absent report would have carried is what lets Sunny say
    // which report to go and get.
    expect(briefing!.text).toContain("first and last use dates");
    expect(briefing!.text).toContain(NO_DATA_RULE);
  });

  it("forbids filling the gap from another report or from an example", async () => {
    /*
     * THE SUBSTITUTION ACTUALLY WORTH FORBIDDING. No code path reaches a sample
     * workbook — the loaders read Postgres — but the knowledge base frameworks
     * are full of worked examples with numbers in them, and those arrive in the
     * same prompt looking exactly like measurements.
     */
    expect(NO_DATA_RULE).toContain("Never fill the gap");
    expect(NO_DATA_RULE).toContain("do not infer them from another report");
    expect(NO_DATA_RULE.toLowerCase()).toContain("sample");
    expect(NO_DATA_RULE.toLowerCase()).toContain("historical");
    expect(NO_DATA_RULE).toContain("as though it were current");
  });

  it("gives an example sentence a manager would recognise", async () => {
    expect(NO_DATA_RULE).toContain("I don't have a current Spa Wellness delivery");
  });

  it("still returns a block when NOTHING is ingested, so the absence is stated", async () => {
    /*
     * NOT NULL HERE. Null would drop the report block entirely and leave the
     * "the knowledge base does not cover this" path to answer — which is
     * misleading, because the knowledge base is not the reason. A manager who
     * asked about Spa needs to hear that there is no Spa delivery.
     */
    nothingLoads();
    const briefing = await loadReportBriefing({
      families: ["sales-totals", "spa-wellness"],
    });

    expect(briefing).not.toBeNull();
    expect(briefing!.present).toEqual([]);
    expect(briefing!.missing).toEqual(["sales-totals", "spa-wellness"]);
    expect(briefing!.text).toContain("Sales Totals: no current delivery");
    expect(briefing!.text).toContain("Spa Wellness: no current delivery");
    expect(briefing!.text).toContain(NO_DATA_RULE);
  });

  it("omits the no-data rule when every requested family loaded", async () => {
    everythingLoads();
    const briefing = await loadReportBriefing({
      families: ["sales-totals", "bed-usage"],
    });

    expect(briefing!.missing).toEqual([]);
    expect(briefing!.text).not.toContain(NO_DATA_RULE);
    expect(briefing!.text).not.toContain("NOT LOADED");
  });
});

describe("partial availability answers from what loaded and names what did not", () => {
  /*
   * ============================================================================
   * THE STATE THAT PRODUCES THE MOST CONFIDENT WRONG ANSWER
   * ============================================================================
   *
   * Not "nothing is loaded" — that is obvious to everyone including the model.
   * It is PARTIAL: two of the three spa-relevant reports loaded, the one the
   * manager asked about did not, and an answer assembled from the rest reads as
   * complete. "Spa is weak at these stores" from engagement and traffic alone,
   * with no equipment data, is exactly that answer.
   *
   * So three things have to be simultaneously true, and each is asserted:
   * the available facts ARE used, the missing family IS named, and the absence
   * is never treated as a zero or as bad performance.
   */
  beforeEach(() => {
    everythingLoads();
    loadBedSpaSections.mockResolvedValue({
      text: "BED USAGE — mtd, 48,584 tans. SPA ENGAGEMENT — mtd, 13.2%.",
      present: ["bed-usage", "spa-engagement"],
    });
  });

  const askSpa = () =>
    loadReportBriefing({
      families: ["spa-engagement", "spa-wellness", "bed-usage"],
      question: "Why is Spa weak?",
    });

  it("keeps the figures that DID load", async () => {
    const briefing = await askSpa();

    expect(briefing!.present).toEqual(["bed-usage", "spa-engagement"]);
    expect(briefing!.text).toContain("48,584 tans");
    expect(briefing!.text).toContain("13.2%");
  });

  it("names the family that did not, and the report that would carry it", async () => {
    const briefing = await askSpa();

    expect(briefing!.missing).toEqual(["spa-wellness"]);
    expect(briefing!.text).toContain("Spa Wellness: no current delivery");
    expect(briefing!.text).toContain("STC SPA Wellness Tracking workbook");
  });

  it("never lets the absence read as a zero or as bad performance", async () => {
    const briefing = await askSpa();

    /*
     * The two sentences that matter. Without the first a model fills the gap
     * with an estimate; without the second it reads "no data" as "no usage",
     * which for this family is a business finding it has no grounds for.
     */
    expect(briefing!.text).toContain("Never fill the gap");
    expect(briefing!.text).toContain("Do not estimate the missing figures");
    expect(briefing!.text).toContain("do not infer them from another report");
    expect(briefing!.text).toContain(
      "do not use an example, sample or historical figure",
    );
  });

  it("still carries the rules of the families that loaded", async () => {
    // A partial answer is still a grounded one, so the loaded families' own
    // rules must be in force — the FAST exemption included.
    const briefing = await askSpa();
    expect(briefing!.text).toContain("HOW TO USE THE REPORT DATA");
    expect(briefing!.text).toContain(NO_DATA_RULE);
  });

  it("reports the partial state on the result, not only in the prose", async () => {
    /*
     * So a caller — the prompt builder, a health check, a test — can act on it
     * without parsing English. `hasMissingReports` is derived from this.
     */
    const briefing = await askSpa();
    expect(briefing!.requested).toHaveLength(3);
    expect(briefing!.present).toHaveLength(2);
    expect(briefing!.missing).toHaveLength(1);
  });
});

describe("the report context is handed to the loaders, and only as pointers", () => {
  const context = {
    family: "sales-totals" as const,
    period: "2026-09-03",
    window: "mtd",
    salons: ["0123"],
    districts: [],
    metric: "ppta",
    view: "all_salons",
  };

  it("passes it through so the server re-reads the reader's own view", async () => {
    everythingLoads();
    await loadReportBriefing({ families: ["sales-totals"], context });

    /*
     * The second argument is the period the QUESTION named, and this call
     * carried no question — so it is null and the tab's own pointer stays in
     * charge. `period-resolution.test.ts` proves the other direction: a
     * question saying "last month" overrides the tab.
     */
    expect(loadSalesTotalsSection).toHaveBeenCalledWith(context, null);
  });

  it("says in the block that the screen's numbers were not sent", async () => {
    everythingLoads();
    const briefing = await loadReportBriefing({ families: ["sales-totals"], context });

    expect(briefing!.text).toContain("Sales Totals dashboard");
    expect(briefing!.text).toContain("re-read from the database");
    expect(briefing!.text).toContain("nothing their screen displayed");
  });

  it("does not mention a dashboard when the question did not come from one", async () => {
    everythingLoads();
    const briefing = await loadReportBriefing({ families: ["sales-totals"] });
    expect(briefing!.text).not.toContain("dashboard");
  });
});

describe("the block is scoped to the authorized company", () => {
  it("says so, and takes the company from the read layer rather than a request", async () => {
    everythingLoads();
    const briefing = await loadReportBriefing({ families: ["bed-usage"] });

    expect(briefing!.text).toContain("REPORT DATA — JB and Associates");
    expect(briefing!.text).toContain("No other company's salon figures are available to you");
    /*
     * The loader is called with the authorized company and a per-family period
     * selection — pointers at rows, nothing from a caller's question, history
     * or context. Every selection here is null because this call named no
     * window, so each family reads its own newest.
     */
    expect(loadBedSpaSections).toHaveBeenCalledWith("JB and Associates", {
      "bed-usage": null,
      "spa-wellness": null,
      "spa-engagement": null,
    });
  });
});

describe("the shared rules say the things all five sources need said", () => {
  it("keeps figures out of the citation system", () => {
    expect(REPORT_DATA_RULES).toContain("not company policy");
    expect(REPORT_DATA_RULES).toContain("markers belong to documents only");
  });

  it("bars combining periods and reports the sections did not combine", () => {
    expect(REPORT_DATA_RULES).toContain(
      "NEVER COMBINE OR COMPARE FIGURES FROM TWO DIFFERENT PERIODS",
    );
  });

  it("bars a report from authorising a consequence", () => {
    expect(REPORT_DATA_RULES).toContain("do not authorise equipment purchases");
    expect(REPORT_DATA_RULES).toContain("leave the decision with them");
  });

  it("states that the reports are salon-level, so no employee can be named from them", () => {
    /*
     * The Daily Stats framework describes employee-level productivity at
     * length, and the reports carry none. A model holding both, asked who to
     * coach, will otherwise attribute a salon's number to a person.
     */
    expect(REPORT_DATA_RULES).toContain("SALON-LEVEL");
    expect(REPORT_DATA_RULES).toContain("never name or imply an individual employee");
  });
});
