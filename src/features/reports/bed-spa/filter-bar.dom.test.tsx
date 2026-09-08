// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { BedSpaPeriodOption } from "@/lib/reporting/read/bed-spa/period-token";
import { BedSpaFilterBar } from "./filter-bar";
import {
  EMPTY_BED_SPA_FILTERS,
  parseBedSpaFilters,
  serializeBedSpaFilters,
  type BedSpaFilters,
} from "./filter-state";

/**
 * THE BED USAGE / SPA FILTER BAR, RENDERED AND CLICKED.
 *
 * What only a real render can hold:
 *
 *   the bar offers ONLY the controls the report supports. A District menu on a
 *   report with one district, or an Equipment menu on one with no equipment, is
 *   a control that either does nothing or empties the page — and both teach a
 *   manager to distrust the filters.
 *
 *   choosing a district DROPS a now-impossible salon from the URL, rather than
 *   leaving a filter narrowing every figure on the page with no control showing
 *   it.
 *
 *   the period token carries its GRAIN, so a link cannot name one of three
 *   periods that share a date.
 *
 * Navigation is captured rather than performed, so what each interaction would
 * put in the address bar is asserted directly.
 */

/** jsdom lacks the layout APIs Radix's positioning depends on. */
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  for (const name of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, { value: () => false, writable: true });
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const pushed: { url: string; options?: { scroll?: boolean } }[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string, options?: { scroll?: boolean }) => pushed.push({ url, options }),
    replace: (url: string, options?: { scroll?: boolean }) => pushed.push({ url, options }),
  }),
  usePathname: () => "/reports/bed-usage",
}));

beforeEach(() => {
  pushed.length = 0;
});

afterEach(() => {
  // Explicit: Testing Library registers its own cleanup only with vitest
  // globals enabled, and without this every query finds two of everything.
  cleanup();
});

const BASE = "/reports/bed-usage";

/** Three periods, two of which END ON THE SAME DAY with different grains. */
const PERIODS: BedSpaPeriodOption[] = [
  {
    periodId: "period-mtd",
    grain: "mtd",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    labelRaw: "Invented MTD",
    label: "MTD · Aug 2026",
    ingestedAt: "2026-09-08T10:24:00.000Z",
    salonCount: 3,
  },
  {
    periodId: "period-ytd",
    grain: "ytd",
    periodStart: "2026-01-01",
    periodEnd: "2026-08-31",
    labelRaw: "Invented YTD",
    label: "YTD · Aug 2026",
    ingestedAt: "2026-09-08T10:24:00.000Z",
    salonCount: 3,
  },
  {
    periodId: "period-july",
    grain: "mtd",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    labelRaw: "Invented July",
    label: "MTD · Jul 2026",
    ingestedAt: "2026-08-04T09:00:00.000Z",
    salonCount: 3,
  },
];

const SALONS = [
  { value: "0901", label: "Invented Store One", note: "0901", searchText: "0901" },
  { value: "0902", label: "Invented Store Two", note: "0902", searchText: "0902" },
  { value: "0903", label: "Invented Store Three", note: "0903", searchText: "0903" },
];

const DISTRICTS = [
  { value: "Invented-District, One", label: "Invented-District, One" },
  { value: "Invented-District, Two", label: "Invented-District, Two" },
];

const LEVELS = [
  { value: "FAST", label: "FAST", note: "Capacity only" },
  { value: "FASTER", label: "FASTER" },
  { value: "INSTANT", label: "INSTANT" },
];

function bar(overrides: Partial<Parameters<typeof BedSpaFilterBar>[0]> = {}) {
  const filters: BedSpaFilters = {
    ...EMPTY_BED_SPA_FILTERS,
    period: "mtd:2026-08-31",
    ...(overrides.filters ?? {}),
  };
  // `filters` is applied AFTER the spread on purpose: an override may set only
  // some fields, and the merged set above is the one that must reach the bar.
  return render(
    <BedSpaFilterBar
      base={BASE}
      periods={PERIODS}
      districts={DISTRICTS}
      salons={SALONS}
      levels={LEVELS}
      {...overrides}
      filters={filters}
    />,
  );
}

/** The query string of the last captured navigation. */
function lastQuery(): URLSearchParams {
  const url = pushed[pushed.length - 1]?.url ?? "";
  return new URLSearchParams(url.split("?")[1] ?? "");
}

describe("which controls are offered", () => {
  it("offers the period control always", () => {
    bar();
    expect(screen.getByRole("button", { name: /period/i })).toBeTruthy();
  });

  it("offers a dimension's control only when the report has more than one value", () => {
    /*
     * A menu with one option is a click charged for nothing, and a menu with
     * none is a control that empties the page.
     */
    bar({ regions: [{ value: "Only Region", label: "Only Region" }], equipment: [] });
    expect(screen.queryByRole("button", { name: /region/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^equipment$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /district/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /salon/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /equipment level/i })).toBeTruthy();
  });

  it("offers the performance control only where the report classifies", () => {
    bar({ showPerformance: false });
    expect(screen.queryByRole("button", { name: /performance/i })).toBeNull();
    cleanup();
    bar({ showPerformance: true });
    expect(screen.getByRole("button", { name: /performance/i })).toBeTruthy();
  });

  it("names the FAST level as capacity-only in the menu", async () => {
    const user = userEvent.setup();
    bar();
    await user.click(screen.getByRole("button", { name: /equipment level/i }));
    const panel = await screen.findByRole("dialog");
    // The rule is visible at the point of selection rather than only on the
    // chart it affects.
    expect(within(panel).getByText(/capacity only/i)).toBeTruthy();
  });
});

describe("the period control", () => {
  it("carries the grain in the token, so two periods ending on one day are distinct", async () => {
    const user = userEvent.setup();
    bar();
    await user.click(screen.getByRole("button", { name: /period/i }));
    const panel = await screen.findByRole("dialog");
    // Both August periods are offered and their labels distinguish them.
    expect(within(panel).getByText("MTD · Aug 2026")).toBeTruthy();
    expect(within(panel).getByText("YTD · Aug 2026")).toBeTruthy();

    await user.click(within(panel).getByText("YTD · Aug 2026"));
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
    expect(lastQuery().get("period")).toBe("ytd:2026-08-31");
  });

  it("navigates without scrolling the page back to the header", async () => {
    // These pages are taller than a screen; a filter click halfway down must
    // not throw the reader to the top.
    const user = userEvent.setup();
    bar();
    await user.click(screen.getByRole("button", { name: /period/i }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByText("MTD · Jul 2026"));
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));
    expect(pushed[pushed.length - 1].options?.scroll).toBe(false);
  });
});

describe("cascading selections", () => {
  it("drops a salon selection when a district is chosen", async () => {
    /*
     * A salon chosen before a district was picked may not be in it. Leaving it
     * would narrow every figure on the page with no control showing it, which
     * is the hardest kind of wrong for a manager to spot.
     */
    const user = userEvent.setup();
    bar({ filters: { ...EMPTY_BED_SPA_FILTERS, period: "mtd:2026-08-31", salons: ["0903"] } });
    await user.click(screen.getByRole("button", { name: /district/i }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByText("Invented-District, One"));
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));

    const query = lastQuery();
    expect(query.get("district")).toBe("Invented-District, One");
    expect(query.get("salon")).toBeNull();
  });

  it("drops a bed-type selection when the level changes", async () => {
    const user = userEvent.setup();
    bar({
      filters: {
        ...EMPTY_BED_SPA_FILTERS,
        period: "mtd:2026-08-31",
        bedTypes: ["Invented Model A"],
      },
      bedTypes: [
        { value: "Invented Model A", label: "Invented Model A" },
        { value: "Invented Model B", label: "Invented Model B" },
      ],
    });
    await user.click(screen.getByRole("button", { name: /equipment level/i }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByText("FASTER"));
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));

    expect(lastQuery().get("level")).toBe("FASTER");
    expect(lastQuery().get("bedType")).toBeNull();
  });

  it("keeps the period when everything else is cleared", async () => {
    const user = userEvent.setup();
    bar({
      filters: {
        ...EMPTY_BED_SPA_FILTERS,
        period: "mtd:2026-08-31",
        districts: ["Invented-District, One"],
        salons: ["0901"],
      },
    });
    // The control says what it does; "Reset" would leave a reader guessing
    // whether the period goes too.
    await user.click(screen.getByRole("button", { name: /show all salons/i }));
    await waitFor(() => expect(pushed.length).toBeGreaterThan(0));

    const query = lastQuery();
    expect(query.get("period")).toBe("mtd:2026-08-31");
    expect(query.get("district")).toBeNull();
    expect(query.get("salon")).toBeNull();
  });

  it("hides the clear control when nothing is selected", () => {
    bar();
    expect(screen.queryByRole("button", { name: /show all salons/i })).toBeNull();
  });
});

describe("serializing and parsing the filter state", () => {
  it("omits empty lists, so `everything` is a clean URL", () => {
    const params = serializeBedSpaFilters({
      ...EMPTY_BED_SPA_FILTERS,
      period: "mtd:2026-08-31",
    });
    expect(params.toString()).toBe("period=mtd%3A2026-08-31");
  });

  it("round-trips a full selection", () => {
    const filters: BedSpaFilters = {
      period: "ytd:2026-08-31",
      districts: ["D1", "D2"],
      regions: ["R1"],
      salons: ["0901"],
      levels: ["FASTER"],
      bedTypes: ["Model A"],
      equipment: ["spa_hydromassage"],
      bands: ["below_market"],
      sort: "perBed",
      direction: "asc",
    };
    const params = serializeBedSpaFilters(filters);
    const parsed = parseBedSpaFilters(Object.fromEntries(params.entries()), {
      periods: ["ytd:2026-08-31"],
      districts: ["D1", "D2"],
      regions: ["R1"],
      salons: ["0901"],
      levels: ["FASTER"],
      bedTypes: ["Model A"],
      equipment: ["spa_hydromassage"],
      sortFields: ["perBed"],
    });
    expect(parsed.filters).toEqual(filters);
    expect(parsed.dropped).toEqual([]);
  });

  it("drops a value the period does not hold, and says so", () => {
    /*
     * Applying it would silently return an empty dashboard, which a reader
     * cannot distinguish from "this salon did nothing".
     */
    const parsed = parseBedSpaFilters(
      { period: "mtd:2026-08-31", salon: "0901,9999", level: "FASTER,ULTRA" },
      {
        periods: ["mtd:2026-08-31"],
        salons: ["0901"],
        levels: ["FASTER"],
      },
    );
    expect(parsed.filters.salons).toEqual(["0901"]);
    expect(parsed.filters.levels).toEqual(["FASTER"]);
    expect(parsed.dropped.join(" ")).toContain("1 salon value not in this period");
    expect(parsed.dropped.join(" ")).toContain("1 equipment level value not in this period");
  });

  it("falls back to the newest period for an unknown one", () => {
    const parsed = parseBedSpaFilters(
      { period: "mtd:1999-01-31" },
      { periods: ["mtd:2026-08-31", "mtd:2026-07-31"] },
    );
    expect(parsed.filters.period).toBe("mtd:2026-08-31");
  });

  it("refuses a bare date, which names one of three periods at random", () => {
    const parsed = parseBedSpaFilters(
      { period: "2026-08-31" },
      { periods: ["mtd:2026-08-31", "ytd:2026-08-31"] },
    );
    expect(parsed.filters.period).toBe("mtd:2026-08-31");
  });

  it("drops an unknown performance band rather than filtering on it", () => {
    const parsed = parseBedSpaFilters(
      { period: "mtd:2026-08-31", band: "below_market,invented_band" },
      { periods: ["mtd:2026-08-31"] },
    );
    expect(parsed.filters.bands).toEqual(["below_market"]);
  });

  it("drops an unknown sort field and direction", () => {
    const parsed = parseBedSpaFilters(
      { period: "mtd:2026-08-31", sort: "notAField", dir: "sideways" },
      { periods: ["mtd:2026-08-31"], sortFields: ["perBed"] },
    );
    expect(parsed.filters.sort).toBeNull();
    expect(parsed.filters.direction).toBeNull();
  });
});
