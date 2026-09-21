import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * "THERE IS NO REPORT FOR TODAY" — THE ANSWER THAT SHOULD NEVER HAPPEN AGAIN
 * ============================================================================
 *
 * The homepage led with "What should I focus on in today's Daily Stats?" and,
 * every time a manager clicked it, the answer opened by saying there was no
 * report for today. There never is one. The Sales Totals email arrives
 * overnight and covers yesterday, on every healthy day this company has ever
 * had, so the product's own lead question was guaranteed to open by reporting
 * a fault that did not exist.
 *
 * THE DATA LAYER WAS NEVER THE PROBLEM, and this suite is written to keep it
 * that way. `period-language.ts` has always excluded `today` and `yesterday`
 * from its period vocabulary, so a question naming today produces no period
 * intent and resolves to the newest period actually ingested. What was wrong
 * was the SENTENCE the composer handed the model, and what this asserts is
 * that the sentence now names the delivery being used before it names the gap.
 *
 * WHY EVERY GAP IS TESTED SEPARATELY. The tempting fix for all of this is
 * `today - 1`, and it is wrong four different ways: Monday is three days after
 * Friday's delivery, a holiday makes it four, a late upload makes it anything,
 * and a monthly report is weeks behind by design. Nothing here computes a lag
 * to look for a delivery — it reads what the catalog holds — so each of those
 * is the same code path with different rows, and each is asserted.
 *
 * MOCKED AT THE CATALOG, like `future-periods.test.ts`, because what is under
 * test is the composer's wiring and its wording. The resolver has its own pure
 * suite and the loaders have theirs.
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
vi.mock("./report-catalog", () => ({
  loadReportCatalog: (...args: unknown[]) => loadReportCatalog(...args),
}));

const { loadReportBriefing } = await import("./report-briefing");
const { REPORT_FAMILIES_BY_ID } = await import("./report-families");

const COMPANY = "JB and Associates";

/**
 * One period as the catalog carries it.
 *
 * Widened to the catalog's own window vocabulary rather than inferred from the
 * helpers below: one Sales Totals delivery produces a `daily` row AND an `mtd`
 * row, and a type inferred from the Comp Report helper would pin `type` to
 * `"mtd"` and reject the pair.
 */
interface Period {
  id: string;
  type: "daily" | "mtd" | "ytd" | "ltm";
  start: string;
  end: string;
  label: string;
  ingestedAt: string | null;
  salonCount: number | null;
}

/** One Sales Totals delivery: a single day, plus the month through that day. */
function salesTotalsDelivery(reportDate: string): Period[] {
  return [
    {
      id: `${reportDate}:daily`,
      type: "daily",
      start: reportDate,
      end: reportDate,
      label: reportDate,
      ingestedAt: `${reportDate}T06:05:00Z`,
      salonCount: 15,
    },
    {
      id: `${reportDate}:mtd`,
      type: "mtd",
      start: `${reportDate.slice(0, 7)}-01`,
      end: reportDate,
      label: `${reportDate} month to date`,
      ingestedAt: `${reportDate}T06:05:00Z`,
      salonCount: 15,
    },
  ];
}

/** One Comp Report month-to-date period. */
function compPeriod(periodEnd: string): Period {
  return {
    id: `mtd:${periodEnd}`,
    type: "mtd",
    start: `${periodEnd.slice(0, 7)}-01`,
    end: periodEnd,
    label: `MTD ${periodEnd}`,
    ingestedAt: `${periodEnd}T07:00:00Z`,
    salonCount: 15,
  };
}

/**
 * A catalog holding the given periods for Sales Totals and Salon Performance.
 *
 * The two families a Daily Stats question routes to — the daily signal and the
 * month-to-date trend it sits inside.
 */
function catalog(input: {
  salesTotals: readonly Period[];
  salonPerformance: readonly Period[];
}) {
  const byId: Record<string, readonly Period[]> = {
    "sales-totals": input.salesTotals,
    "salon-performance": input.salonPerformance,
  };

  const families = Object.values(REPORT_FAMILIES_BY_ID).map((family) => {
    const ordered = [...(byId[family.id] ?? [])].sort((a, b) =>
      b.end.localeCompare(a.end),
    );
    return {
      family,
      periods: ordered,
      latest: ordered[0] ?? null,
      deliveredTypes: [...new Set(ordered.map((period) => period.type))],
      lastIngestedAt: ordered[0]?.ingestedAt ?? null,
      company: COMPANY,
    };
  });

  return {
    company: COMPANY,
    families,
    byFamily: Object.fromEntries(families.map((status) => [status.family.id, status])),
  };
}

/** Ask a Daily Stats question on a given day against a given ingestion state. */
async function ask(input: {
  question: string;
  today: string;
  salesTotals: readonly Period[];
  salonPerformance?: readonly Period[];
}) {
  loadReportCatalog.mockResolvedValue(
    catalog({
      salesTotals: input.salesTotals,
      salonPerformance: input.salonPerformance ?? [compPeriod("2026-09-20")],
    }),
  );
  loadSalesTotalsSection.mockResolvedValue({
    text: "SALES TOTALS — figures.",
    reportDate: input.salesTotals.at(0)?.end ?? "",
  });
  loadSalonPerformanceSection.mockResolvedValue({ text: "SALON PERFORMANCE — figures." });

  return loadReportBriefing({
    families: ["sales-totals", "salon-performance"],
    question: input.question,
    today: input.today,
  });
}

/** The Sales Totals freshness entry from a briefing. */
function salesFreshness(briefing: Awaited<ReturnType<typeof loadReportBriefing>>) {
  return briefing!.freshness.find((entry) => entry.familyId === "sales-totals")!;
}

beforeEach(() => {
  loadSalesTotalsSection.mockReset();
  loadSalonPerformanceSection.mockReset();
  loadBedSpaSections.mockReset();
  loadReportCatalog.mockReset();
});

/* ============================================ the gap, however wide it is == */

describe("the newest ingested delivery is used, whatever the gap", () => {
  /**
   * EACH ROW IS A REAL WAY THE GAP OPENS. Nothing in the composer knows which
   * of them it is looking at, which is the property being asserted: the same
   * code path reads the same catalog and picks the same newest row.
   */
  it.each([
    ["the ordinary overnight lag", "2026-09-20", "2026-09-21", 1],
    ["a Monday after a weekend", "2026-09-18", "2026-09-21", 3],
    ["a Monday after a holiday weekend", "2026-09-17", "2026-09-21", 4],
    ["an upload that has not arrived for a week", "2026-09-13", "2026-09-21", 8],
    ["a delivery three weeks back", "2026-08-31", "2026-09-21", 21],
  ])("%s", async (_label, reportDate, today, expectedDaysBehind) => {
    const briefing = await ask({
      question: "What should I focus on today?",
      today,
      salesTotals: salesTotalsDelivery(reportDate),
    });

    const sales = salesFreshness(briefing);
    expect(sales.asOf).toBe(reportDate);
    expect(sales.daysBehind).toBe(expectedDaysBehind);
    expect(sales.level).not.toBe("absent");

    // The family loaded. It is never counted as missing merely for being behind.
    expect(briefing!.missing).toEqual([]);
    expect(briefing!.present).toContain("sales-totals");
  });

  /**
   * AND IT IS NOT ARITHMETIC ON TODAY'S DATE.
   *
   * Asked on the same day against two different ingestion states, the answer
   * moves with the ROWS. A `today - 1` implementation would have looked for
   * the 20th in both and found nothing in the second.
   */
  it("follows the rows rather than the clock", async () => {
    const fresh = await ask({
      question: "Which salons need my attention today?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-09-20"),
    });
    const stale = await ask({
      question: "Which salons need my attention today?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-09-16"),
    });

    expect(salesFreshness(fresh).asOf).toBe("2026-09-20");
    expect(salesFreshness(stale).asOf).toBe("2026-09-16");
  });
});

/* ======================================================= what the text says = */

describe("the briefing names the date it is using", () => {
  it("states the actual Daily Stats date, on Sep 21 with Sep 20 data", async () => {
    const briefing = await ask({
      question: "What should I focus on in today's Daily Stats?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-09-20"),
    });

    expect(briefing!.text).toContain("Sales Totals: newest figures cover");
    expect(briefing!.text).toContain("2026-09-20");
    expect(salesFreshness(briefing).sentence).toContain(
      "the most recent delivery available, one day before the day being asked about",
    );
  });

  it("names the month-to-date Comp Report beside it", async () => {
    const briefing = await ask({
      question: "What should I focus on in today's Daily Stats?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-09-20"),
      salonPerformance: [compPeriod("2026-09-19")],
    });

    expect(briefing!.requested).toEqual(["sales-totals", "salon-performance"]);
    expect(briefing!.text).toContain("Salon Performance: newest figures cover");
    expect(briefing!.text).toContain("2026-09-19");
  });

  /**
   * THE INSTRUCTION LEADS WITH THE DELIVERY, NOT THE ABSENCE.
   *
   * This is the assertion that would have caught the reported behaviour. The
   * rule used to open "NO REPORT HERE COVERS TODAY" and told the model to say
   * so first; it now says to answer from the newest delivery and open with its
   * date.
   */
  it("instructs the model to answer from the newest delivery and name its date", async () => {
    const briefing = await ask({
      question: "What should I focus on in today's Daily Stats?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-09-20"),
    });

    expect(briefing!.text).toContain("ANSWER FROM THE MOST RECENT DELIVERY LISTED ABOVE");
    expect(briefing!.text).toContain("A DELIVERY THAT IS NOT DATED TODAY IS THE NORMAL STATE");
    // The honesty rule survives the reframing.
    expect(briefing!.text).toContain("STILL NEVER CALL IT TODAY");
  });

  /**
   * AND NOTHING IN THE FIGURES OR THE HEADER CALLS THE DELIVERY MISSING.
   *
   * Scoped to the parts of the block that DESCRIBE the data. The rule itself
   * legitimately contains the forbidden phrasing, because it is the rule that
   * forbids it.
   */
  it("never describes a loaded delivery as missing", async () => {
    const briefing = await ask({
      question: "What should I focus on in today's Daily Stats?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-09-20"),
    });

    for (const entry of briefing!.freshness) {
      expect(entry.sentence).not.toMatch(/no report|missing|unavailable|not available/i);
    }
    expect(briefing!.text).not.toContain("NOT LOADED");
    expect(briefing!.text).not.toContain("no current delivery");
  });
});

/* ======================================== the one case that IS unavailable = */

describe("genuinely nothing ingested is still reported as nothing ingested", () => {
  it("says so when no Daily Stats delivery exists at all", async () => {
    loadReportCatalog.mockResolvedValue(
      catalog({ salesTotals: [], salonPerformance: [compPeriod("2026-09-20")] }),
    );
    loadSalesTotalsSection.mockResolvedValue(null);
    loadSalonPerformanceSection.mockResolvedValue({ text: "SALON PERFORMANCE — figures." });

    const briefing = await loadReportBriefing({
      families: ["sales-totals", "salon-performance"],
      question: "What should I focus on today?",
      today: "2026-09-21",
    });

    expect(briefing!.missing).toEqual(["sales-totals"]);
    expect(briefing!.text).toContain("Sales Totals: no current delivery");
    expect(salesFreshness(briefing).level).toBe("absent");
  });

  /**
   * AND ONLY THEN. The distinction this whole change turns on: a report that
   * is behind is answerable, a report that does not exist is not, and the old
   * wording made the first look like the second.
   */
  it("does not report a delivery three weeks old as missing", async () => {
    const briefing = await ask({
      question: "What should I focus on today?",
      today: "2026-09-21",
      salesTotals: salesTotalsDelivery("2026-08-31"),
    });

    expect(briefing!.missing).toEqual([]);
    expect(salesFreshness(briefing).level).not.toBe("absent");
  });
});
