import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * SEPTEMBER, THEN OCTOBER, THEN NOVEMBER — WITH NOTHING EDITED
 * ============================================================================
 *
 * This suite is the long-term requirement, and it is written to fail if anybody
 * ever reintroduces a frozen date. The scenario runs forwards through the
 * composer:
 *
 *   only August is ingested          -> latest is August
 *   September arrives                -> latest becomes September, on its own
 *   October arrives                  -> latest becomes October, on its own
 *   August and September stay queryable by name and by "last month"
 *
 * NOTHING BETWEEN THOSE STEPS IS A CODE CHANGE. The only thing that differs
 * between them is the rows the catalog returns, which is exactly what an
 * ingestion does.
 *
 * WHY IT GOES THROUGH `loadReportBriefing` RATHER THAN THE RESOLVER. The
 * resolver has its own suite, and it is pure. What this proves is the WIRING:
 * that the composer reads the catalog, resolves the question's window against
 * it, hands the chosen period to the loader, and reports which one it read. Two
 * of those four could be broken while the resolver's tests all passed.
 *
 * The months below are relative to a computed year, and no assertion names one
 * — they are asserted against the fixture that produced them.
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

const YEAR = new Date().getUTCFullYear();

/** A month-to-date period for one month of `YEAR`. */
function month(index: number) {
  const end = new Date(Date.UTC(YEAR, index, 0)).toISOString().slice(0, 10);
  return {
    id: `mtd:${end}`,
    type: "mtd" as const,
    start: `${YEAR}-${String(index).padStart(2, "0")}-01`,
    end,
    label: `${MONTH_LABELS[index - 1]} ${YEAR}`,
    // A delivery lands a day or two after the month it covers.
    ingestedAt: `${end}T06:00:00Z`,
    salonCount: 15,
  };
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const AUGUST = month(8);
const SEPTEMBER = month(9);
const OCTOBER = month(10);

/**
 * A catalog in which BED USAGE holds exactly the periods given.
 *
 * One family is enough to prove the wiring and keeps the assertions readable;
 * the composer treats all five identically, and `report-catalog.test.ts` proves
 * every family is listed through its own source.
 */
function ingested(periods: readonly ReturnType<typeof month>[]) {
  const families = Object.values(REPORT_FAMILIES_BY_ID).map((family) => {
    const mine = family.id === "bed-usage" ? [...periods] : [AUGUST];
    const ordered = [...mine].sort((a, b) => b.end.localeCompare(a.end));
    return {
      family,
      periods: ordered,
      latest: ordered[0] ?? null,
      deliveredTypes: ordered.length > 0 ? ["mtd"] : [],
      lastIngestedAt: ordered[0]?.ingestedAt ?? null,
      company: "JB and Associates",
    };
  });
  return {
    company: "JB and Associates",
    families,
    byFamily: Object.fromEntries(families.map((status) => [status.family.id, status])),
  };
}

function bedSpaLoads() {
  loadBedSpaSections.mockResolvedValue({
    text: "BED USAGE — mtd.",
    present: ["bed-usage"],
  });
}

/** Ask about Bed Usage with a given question and a given set of ingested months. */
async function ask(periods: readonly ReturnType<typeof month>[], question: string) {
  loadReportCatalog.mockResolvedValue(ingested(periods));
  bedSpaLoads();
  return loadReportBriefing({ families: ["bed-usage"], question });
}

/** The period id the bed/spa loader was told to read. */
function selectedPeriodId(): string | null | "skip" {
  const call = loadBedSpaSections.mock.calls.at(-1);
  if (!call) throw new Error("loadBedSpaSections was not called");
  return (call[1] as Record<string, string | null | "skip">)["bed-usage"];
}

beforeEach(() => {
  loadSalesTotalsSection.mockReset();
  loadSalonPerformanceSection.mockReset();
  loadBedSpaSections.mockReset();
  loadReportCatalog.mockReset();
});

/* ============================================== the newest period moves == */

describe("latest follows the data, delivery after delivery", () => {
  it("is August when only August is ingested", async () => {
    const briefing = await ask([AUGUST], "What is our latest bed usage?");
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: AUGUST.end },
    });
  });

  it("becomes September the moment September arrives", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER], "What is our latest bed usage?");
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: SEPTEMBER.end },
    });
    // And the loader is told to read THAT period, not the old one.
    expect(selectedPeriodId()).toBe(SEPTEMBER.id);
  });

  it("becomes October the moment October arrives", async () => {
    const briefing = await ask(
      [AUGUST, SEPTEMBER, OCTOBER],
      "What is our latest bed usage?",
    );
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: OCTOBER.end },
    });
    expect(selectedPeriodId()).toBe(OCTOBER.id);
  });

  it("moves the same way for a question that names no window at all", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER, OCTOBER], "How are our beds doing?");
    /*
     * `fellBackToLatest` and a null selection: the composer leaves the loader to
     * read its own newest, which is the same October. Reported rather than
     * silent, so the briefing can say which period it described.
     */
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      fellBackToLatest: true,
      period: { end: OCTOBER.end },
    });
    expect(selectedPeriodId()).toBeNull();
  });

  it("needs no code, config or fixture change between the three steps", async () => {
    /*
     * THE ASSERTION THAT IS THE WHOLE POINT. One call, three different sets of
     * rows, three different answers — and the only thing that changed is what
     * `loadReportCatalog` returned, which is what an ingestion changes.
     */
    const answers: string[] = [];
    for (const periods of [[AUGUST], [AUGUST, SEPTEMBER], [AUGUST, SEPTEMBER, OCTOBER]]) {
      const briefing = await ask(periods, "latest");
      const resolution = briefing!.periods["bed-usage"];
      answers.push(resolution?.ok ? resolution.period.end : "none");
    }
    expect(answers).toEqual([AUGUST.end, SEPTEMBER.end, OCTOBER.end]);
    expect(new Set(answers).size).toBe(3);
  });
});

/* ============================================== history stays queryable == */

describe("earlier periods stay reachable after a newer one lands", () => {
  it("resolves last month to September once October is the newest", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER, OCTOBER], "How did we do last month?");
    expect(briefing!.periodIntent?.kind).toBe("previous");
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: SEPTEMBER.end },
    });
    expect(selectedPeriodId()).toBe(SEPTEMBER.id);
  });

  it("moves last month forward as the newest moves", async () => {
    const two = await ask([AUGUST, SEPTEMBER], "last month");
    expect(two!.periods["bed-usage"]).toMatchObject({ ok: true, period: { end: AUGUST.end } });

    const three = await ask([AUGUST, SEPTEMBER, OCTOBER], "last month");
    expect(three!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: SEPTEMBER.end },
    });
  });

  it("resolves August by name from three months of history", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER, OCTOBER], "How was August?");
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: AUGUST.end },
    });
    expect(selectedPeriodId()).toBe(AUGUST.id);
  });

  it("resolves September by name too, so nothing is shadowed by the newest", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER, OCTOBER], "What happened in September?");
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: true,
      period: { end: SEPTEMBER.end },
    });
  });

  it("says so, in the block, which period each report could give", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER, OCTOBER], "How was August?");
    expect(briefing!.text).toContain('The manager asked about "August"');
    expect(briefing!.text).toContain(AUGUST.end);
    expect(briefing!.text).toContain("Never substitute a different window's figures");
  });
});

/* ================================================= windows and refusals == */

describe("a window the report does not deliver is refused, not substituted", () => {
  it("refuses year to date for Bed Usage and names what it holds", async () => {
    const briefing = await ask([AUGUST, SEPTEMBER], "What is our YTD bed usage?");

    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: false,
      failure: { reason: "type_not_delivered" },
    });
    expect(briefing!.text).toContain("CANNOT ANSWER THAT WINDOW");
    expect(briefing!.text).toContain("does not deliver year to date");
  });

  it("does not load the family at all in that case", async () => {
    /*
     * Loading the newest month instead would put a month's figures under a
     * year-to-date question — a number a twelfth of the size of the one asked
     * for, under a heading that says otherwise.
     */
    await ask([AUGUST, SEPTEMBER], "What is our YTD bed usage?");
    expect(loadBedSpaSections).toHaveBeenCalledTimes(1);
    expect(selectedPeriodId()).toBe("skip");
  });

  it("refuses last month when only one period exists", async () => {
    const briefing = await ask([AUGUST], "How did we do last month?");
    expect(briefing!.periods["bed-usage"]).toMatchObject({
      ok: false,
      failure: { reason: "no_previous_period" },
    });
  });
});

describe("a catalog that could not be read does not suppress the figures", () => {
  it("still loads the family when the period listing came back empty", async () => {
    /*
     * `loadReportCatalog` swallows its own failures and returns no periods, so
     * an empty catalog and a failed one look identical here. Skipping on that
     * would let a metadata read failure hide figures that would have loaded
     * perfectly — so `no_periods` is the one refusal that does NOT skip, and
     * the loader is left to judge for itself.
     */
    const briefing = await ask([], "How are our beds doing?");
    expect(loadBedSpaSections).toHaveBeenCalledTimes(1);
    expect(selectedPeriodId()).toBeNull();
    expect(briefing!.present).toEqual(["bed-usage"]);
  });
});

/* ==================================================== freshness reporting == */

describe("freshness is measured against the day asked about", () => {
  it("names the as-of date and how far behind it is", async () => {
    loadReportCatalog.mockResolvedValue(ingested([AUGUST, SEPTEMBER]));
    bedSpaLoads();

    // Ten days after September's period end, whatever year this runs in.
    const today = new Date(Date.parse(`${SEPTEMBER.end}T00:00:00Z`) + 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const briefing = await loadReportBriefing({
      families: ["bed-usage"],
      question: "How are we doing today?",
      today,
    });

    const bed = briefing!.freshness.find((entry) => entry.familyId === "bed-usage")!;
    expect(bed.asOf).toBe(SEPTEMBER.end);
    expect(bed.daysBehind).toBe(10);
    expect(bed.level).toBe("days_behind");
    expect(briefing!.text).toContain("DATA FRESHNESS");
    expect(briefing!.text).toContain("NO REPORT HERE COVERS TODAY");
  });

  it("reports current when the newest period ends on the day asked about", async () => {
    loadReportCatalog.mockResolvedValue(ingested([SEPTEMBER]));
    bedSpaLoads();

    const briefing = await loadReportBriefing({
      families: ["bed-usage"],
      question: "How are we doing?",
      today: SEPTEMBER.end,
    });

    const bed = briefing!.freshness.find((entry) => entry.familyId === "bed-usage")!;
    expect(bed.level).toBe("current");
    expect(bed.daysBehind).toBe(0);
    // No staleness instruction when there is no staleness to declare.
    expect(briefing!.text).not.toContain("NO REPORT HERE COVERS TODAY");
    expect(briefing!.text).toContain("Still name the period each figure belongs to");
  });

  it("moves with the data rather than with a constant", async () => {
    /*
     * The same day, two different ingestion states: freshness improves because
     * a newer delivery arrived, not because anything was edited. A frozen
     * anchor would have reported both the same.
     */
    const today = new Date(Date.parse(`${OCTOBER.end}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);

    loadReportCatalog.mockResolvedValue(ingested([AUGUST]));
    bedSpaLoads();
    const stale = await loadReportBriefing({ families: ["bed-usage"], today });

    loadReportCatalog.mockResolvedValue(ingested([AUGUST, SEPTEMBER, OCTOBER]));
    bedSpaLoads();
    const fresh = await loadReportBriefing({ families: ["bed-usage"], today });

    const before = stale!.freshness[0].daysBehind!;
    const after = fresh!.freshness[0].daysBehind!;
    expect(before).toBeGreaterThan(after);
    expect(after).toBe(1);
  });

  it("says a family has no delivery rather than calling it stale", async () => {
    loadReportCatalog.mockResolvedValue({
      company: "JB and Associates",
      families: [
        {
          family: REPORT_FAMILIES_BY_ID["bed-usage"],
          periods: [],
          latest: null,
          deliveredTypes: [],
          lastIngestedAt: null,
          company: "JB and Associates",
        },
      ],
      byFamily: {
        "bed-usage": {
          family: REPORT_FAMILIES_BY_ID["bed-usage"],
          periods: [],
          latest: null,
          deliveredTypes: [],
          lastIngestedAt: null,
          company: "JB and Associates",
        },
      },
    });
    loadBedSpaSections.mockResolvedValue({ text: null, present: [] });

    const briefing = await loadReportBriefing({
      families: ["bed-usage"],
      today: OCTOBER.end,
    });

    expect(briefing!.freshness[0].level).toBe("absent");
    expect(briefing!.freshness[0].sentence).toContain("no delivery ingested");
    // Absent is not stale, so it contributes no freshness block of its own.
    expect(briefing!.text).not.toContain("DATA FRESHNESS");
    // The no-data rule covers it instead.
    expect(briefing!.text).toContain("no current delivery");
  });

  it("omits freshness entirely when no day was supplied", async () => {
    // An operator listing the catalog is not asking "is this current enough to
    // act on today", so there is nothing to compare against.
    const briefing = await ask([AUGUST], "latest");
    expect(briefing!.freshness).toEqual([]);
    expect(briefing!.text).not.toContain("DATA FRESHNESS");
  });
});

/* ================================================== no frozen dates left == */

/**
 * Source with comments removed.
 *
 * These assertions are about CODE, and every one of the modules below explains
 * in prose why it must not reach for a frozen date — naming `DEMO_ANCHOR` in
 * the sentence that forbids it. Scanning the raw file would fail on the
 * documentation of the very rule being checked.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the reporting read path holds no frozen clock", () => {
  it("neither the composer, the catalog nor freshness reads the demo anchor", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "src/lib/reporting/read/report-briefing.ts",
      "src/lib/reporting/read/report-catalog.ts",
      "src/lib/reporting/read/report-freshness.ts",
      "src/lib/reporting/read/period-language.ts",
    ]) {
      const source = codeOf(readFileSync(file, "utf8"));
      /*
       * `DEMO_ANCHOR` is a fixed date the prototype measured everything
       * against. A freshness check that reached for it would report every
       * report as current forever, and a period resolver that did would answer
       * "last month" relative to a month that had already passed.
       */
      expect(source, file).not.toContain("DEMO_ANCHOR");
      expect(source, file).not.toContain("demoNow");
      expect(source, file).not.toContain("utils/date");
    }
  });

  it("no longer exposes a hard-coded current basis year", async () => {
    const { readFileSync } = await import("node:fs");
    const filters = readFileSync("src/lib/reporting/read/filters.ts", "utf8");
    /*
     * It read `export const CURRENT_BASIS_YEAR = 2026` under a comment claiming
     * it came from the data. Every "current" figure is selected by basis year,
     * so it would have started reading the wrong year on the first of January
     * and shown blanks rather than an error.
     */
    expect(filters).not.toMatch(/export const CURRENT_BASIS_YEAR/);
    const windows = readFileSync("src/lib/reporting/read/windows.ts", "utf8");
    expect(windows).toContain("export function currentBasisYear");
  });

  it("the chat route takes the day from the server clock, not the request", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(route).toContain("todayIso: new Date().toISOString().slice(0, 10)");
    // And the browser no longer sends one at all.
    const screen = codeOf(readFileSync("src/features/chat/chat-screen.tsx", "utf8"));
    expect(screen).not.toContain("todayIso");
    expect(screen).not.toContain("DEMO_ANCHOR");
  });
});
