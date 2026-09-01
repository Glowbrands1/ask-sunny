// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTERS, type ReportFilters } from "@/lib/reporting/read/filters";
import type {
  FilterOptions,
  MetricDescriptor,
  PeriodOption,
  SalonPeriodDescriptors,
} from "@/lib/reporting/read/types";
import { eligibleSalons } from "@/lib/reporting/read/canonical";
import { basisYearWindow, currentWindow, rollingWindow } from "@/lib/reporting/read/windows";
import { reportingGrainOptions, type ReportingGrainOption } from "@/lib/reporting/read/views";
import { FilterBar } from "./filter-bar";

/**
 * THE FILTER BAR, RENDERED AND CLICKED.
 *
 * Three things are held here that only a real render can hold:
 *
 *   the bar offers Period, Window, Metric, District, Salon and More, and does
 *   NOT offer View or History — the two controls that asked managers questions
 *   the data could not answer;
 *
 *   the Salon menu contains the selected districts' salons and nobody else's,
 *   with `Select all` and the search box operating on that same set;
 *
 *   choosing a district DROPS a now-impossible salon from the URL, rather than
 *   leaving a filter narrowing every figure on the page with no control showing
 *   it.
 *
 * The navigation is captured rather than performed, so what each interaction
 * would put in the address bar is asserted directly.
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
  usePathname: () => "/reports/salon-performance",
}));

beforeEach(() => {
  pushed.length = 0;
});

afterEach(() => {
  // Explicit: Testing Library registers its own cleanup only with vitest
  // globals enabled, and without this every query finds two of everything.
  cleanup();
});

const BASE = "/reports/salon-performance";

const DISTRICTS: Record<string, string[]> = {
  "Invented-District, One": ["0313", "0314", "0410", "0495"],
  "Invented-District, Two": ["0307", "0309", "0310", "0311", "0312"],
  "Invented-District, Three": ["0306", "0394", "0462", "0463", "0468", "0476"],
};

const ALL_SALONS: SalonPeriodDescriptors[] = Object.entries(DISTRICTS).flatMap(
  ([district, numbers]) =>
    numbers.map((salonNumber) => ({
      salonNumber,
      storeName: `Invented Store ${salonNumber}`,
      districtLabel: district,
      regionLabel: "Invented Region North",
      company: "Invented Company",
      ownershipGroup: "Invented Group A",
      dma: "Invented DMA",
      pricingPlan: null,
      isCompSalon: true,
      quintileGroup: "Top 20%",
      revenueRank: 1,
      salonAgeYears: 10,
      avgClientAge: 30,
      spaPieces: 2,
    })),
);

const OPTIONS: FilterOptions = {
  district: Object.entries(DISTRICTS).map(([value, numbers]) => ({
    value,
    salonCount: numbers.length,
  })),
  // One region only, so the bar must not render a control for it.
  region: [{ value: "Invented Region North", salonCount: 15 }],
  ownership_group: [
    { value: "Invented Group A", salonCount: 9 },
    { value: "Invented Group B", salonCount: 6 },
  ],
};

function measure(code: string, label: string): MetricDescriptor {
  return {
    code,
    label,
    family: "revenue",
    unit: "currency",
    higherIsBetter: true,
    basisYearRequired: true,
    comparisonOfCode: null,
    description: "",
    availableBasisYears: [2024, 2026],
    factCount: 30,
    salonCount: 15,
    sourceSheet: "CompReport(MTD) vs 2024",
  };
}

const METRICS = [measure("total_revenue", "Total Revenue"), measure("total_tans", "Total Tans")];

const PERIODS: PeriodOption[] = [
  {
    periodId: "period-aug",
    grain: "mtd",
    periodEnd: "2026-08-30",
    periodLabel: "MTD 08/30/2026",
    salonCount: 15,
  },
];

const WINDOWS = [
  currentWindow("MTD", "CompReport(MTD) vs 2024"),
  basisYearWindow(2024, "CompReport(MTD) vs 2024"),
  basisYearWindow(2019, "CompReport(MTD) vs 2024"),
  rollingWindow(3, "CompReport(MTD)"),
  rollingWindow(6, "CompReport(MTD)"),
  rollingWindow(9, "CompReport(MTD)"),
  rollingWindow(12, "CompReport(MTD)"),
];

const AVAILABILITY = Object.fromEntries(WINDOWS.map((window) => [window.id, true]));

/**
 * Renders the bar the way the page does: the Salon menu receives the ELIGIBLE
 * salons, computed from the same function the server uses.
 */
/** One period loaded: no grain is available, so no History control. */
const NO_HISTORY: ReportingGrainOption[] = reportingGrainOptions([
  { grain: "mtd", periodEnd: "2026-08-30" },
]);

/** Two periods loaded: monthly becomes available, weekly never does. */
const SOME_HISTORY: ReportingGrainOption[] = reportingGrainOptions([
  { grain: "mtd", periodEnd: "2026-08-30" },
  { grain: "mtd", periodEnd: "2026-07-31" },
]);

function renderBar(
  filters: Partial<ReportFilters> = {},
  grains: ReportingGrainOption[] = NO_HISTORY,
) {
  const merged: ReportFilters = { ...DEFAULT_FILTERS, ...filters };
  const eligible = eligibleSalons(ALL_SALONS, merged);
  render(
    <FilterBar
      base={BASE}
      filters={merged}
      options={OPTIONS}
      metrics={METRICS}
      activeWindowId={merged.window}
      windows={WINDOWS}
      windowAvailability={AVAILABILITY}
      periods={PERIODS}
      grains={grains}
      salons={eligible}
      eligibleOf={ALL_SALONS.length}
    />,
  );
  return { filters: merged, eligible };
}

/** The trigger for a labelled control. Scoped to the bar, never a menu row. */
function trigger(label: string): HTMLElement {
  const match = screen
    .getAllByRole("button")
    .find((el) => el.firstElementChild?.textContent === label);
  if (!match) throw new Error(`no trigger for ${label}`);
  return match;
}

function maybeTrigger(label: string): HTMLElement | undefined {
  return screen
    .getAllByRole("button")
    .find((el) => el.firstElementChild?.textContent === label);
}

/** Opens a control and returns its menu group. */
async function open(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(trigger(label));
  return waitFor(() => screen.getByRole("group", { name: label }));
}

/** The query of the last navigation this interaction caused. */
function lastQuery(): URLSearchParams {
  const last = pushed.at(-1);
  if (!last) throw new Error("no navigation happened");
  const [, search = ""] = last.url.split("?");
  return new URLSearchParams(search);
}

describe("which controls the bar offers", () => {
  it("offers Period, Window, Metric, District, Salon and More", () => {
    renderBar();
    for (const label of ["Period", "Window", "Metric", "District", "Salon", "More"]) {
      expect(maybeTrigger(label)).toBeTruthy();
    }
  });

  it("offers no View control: the comparison chooses the sheet", () => {
    // A manager cannot answer "which tab of the workbook", and does not need to:
    // `vs 2024` is on one sheet, `Last 3 Months` on another, so the Window
    // control already decides it. Two controls able to disagree about the sheet
    // is the shape of the bug this replaced.
    renderBar();
    expect(maybeTrigger("View")).toBeUndefined();
  });

  it("offers no History control while no history exists", () => {
    // Weekly / Monthly / Yearly each need several ingested periods. With one
    // loaded the control could only display an unavailable option as though it
    // were the active selection, which is what it was reported doing.
    renderBar();
    expect(maybeTrigger("History")).toBeUndefined();
    expect(screen.queryByText("Weekly")).toBeNull();
  });

  it("brings History back on its own once a second period is loaded", async () => {
    // Not a hard-coded hide: the same `reportingGrainOptions` that suppresses
    // the control today reveals it when the data supports it.
    const user = userEvent.setup();
    renderBar({}, SOME_HISTORY);
    expect(maybeTrigger("History")).toBeTruthy();

    await open(user, "History");
    const rows = screen.getAllByRole("menuitemradio").map((row) => row.textContent ?? "");
    // Weekly is still listed, still unavailable, and says why — the source is
    // not produced weekly, which is a different gap from "not yet loaded".
    expect(rows.some((row) => row.startsWith("Weekly") && row.includes("not produced weekly"))).toBe(
      true,
    );
    expect(rows.some((row) => row.startsWith("Monthly"))).toBe(true);
  });

  it("hides a facet with only one value", () => {
    // Region has one value in this period, so a control for it could not change
    // anything on the page.
    renderBar();
    expect(maybeTrigger("Region")).toBeUndefined();
  });

  it("shows the RESOLVED window on the trigger, never a dash", async () => {
    // The control used to display the raw URL token, so a token this report does
    // not offer rendered as `—` over a dashboard showing real figures.
    renderBar({ window: "last_6m" });
    expect(trigger("Window").textContent).toContain("Last 6 Months");
    expect(trigger("Window").textContent).not.toContain("—");
  });
});

describe("the Salon menu follows the District selection", () => {
  it("lists every salon when no district is selected", async () => {
    const user = userEvent.setup();
    renderBar();
    const menu = await open(user, "Salon");
    expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(15);
  });

  it("lists only the selected district's salons", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"] });
    const menu = await open(user, "Salon");

    const rows = within(menu).getAllByRole("menuitemcheckbox");
    expect(rows.map((row) => row.textContent?.slice(0, 4))).toEqual([
      "0313",
      "0314",
      "0410",
      "0495",
    ]);
    // Another district's salons are not merely unticked — they are not there.
    expect(within(menu).queryByText(/0468/)).toBeNull();
  });

  it("lists the union when two districts are selected", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One", "Invented-District, Two"] });
    const menu = await open(user, "Salon");
    expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(9);
    expect(within(menu).queryByText(/0476/)).toBeNull();
  });

  it("says how many salons are eligible, and only when that is narrower", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"] });
    await open(user, "Salon");
    expect(screen.getByText(/4 of 15 salons eligible/)).toBeTruthy();

    cleanup();
    renderBar();
    await open(user, "Salon");
    expect(screen.queryByText(/salons eligible/)).toBeNull();
  });

  it("keeps leading zeros on every option", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, Three"] });
    const menu = await open(user, "Salon");
    expect(within(menu).getByText(/^0468 ·/)).toBeTruthy();
  });

  it("searches only the eligible set", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"] });
    await open(user, "Salon");

    const box = screen.getByLabelText("Search salon");
    await user.type(box, "41");
    let menu = screen.getByRole("group", { name: "Salon" });
    expect(within(menu).getAllByRole("menuitemcheckbox")).toHaveLength(1);
    expect(within(menu).getByText(/^0410 ·/)).toBeTruthy();

    // A salon that exists in the report but not in the selected district is
    // unreachable through search, not merely unticked.
    await user.clear(box);
    await user.type(box, "0468");
    menu = screen.getByRole("group", { name: "Salon" });
    expect(within(menu).queryAllByRole("menuitemcheckbox")).toHaveLength(0);
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it("selects all ELIGIBLE salons, not all salons in the report", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"] });
    await open(user, "Salon");

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(lastQuery().get("salon")).toBe("0313,0314,0410,0495");
  });
});

describe("changing a District prunes the Salon selection", () => {
  it("drops a salon the newly selected district does not contain", async () => {
    const user = userEvent.setup();
    renderBar({ salonNumbers: ["0468", "0313"] });

    await open(user, "District");
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Invented-District, One/ }));

    const query = lastQuery();
    expect(query.getAll("district")).toEqual(["Invented-District, One"]);
    // 0468 belongs to district three and is gone; 0313 is in district one and stays.
    expect(query.get("salon")).toBe("0313");
  });

  it("drops every salon when none of them survives the district", async () => {
    const user = userEvent.setup();
    renderBar({ salonNumbers: ["0468", "0476"] });

    await open(user, "District");
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Invented-District, One/ }));

    const query = lastQuery();
    expect(query.getAll("district")).toEqual(["Invented-District, One"]);
    expect(query.get("salon")).toBeNull();
  });

  it("keeps salons that are still inside the districts selected", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"], salonNumbers: ["0313"] });

    await open(user, "District");
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Invented-District, Two/ }));

    const query = lastQuery();
    expect(query.getAll("district")).toEqual(["Invented-District, One", "Invented-District, Two"]);
    expect(query.get("salon")).toBe("0313");
  });

  it("restores the whole salon list when the district is cleared", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"] });

    await open(user, "District");
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(lastQuery().getAll("district")).toEqual([]);
  });

  it("sends a district name containing a comma as one value", async () => {
    // Comma-joined and split on the way back, `Surname, Forename` became two
    // values — `Surname` and `Forename` — and neither matches a row, so choosing
    // a district returned an empty dashboard. Repeated parameters instead.
    //
    // One click per assertion: the bar is driven by its props, and in the real
    // app each click navigates and the server re-renders it. Clicking twice
    // here would just replace the first selection.
    const user = userEvent.setup();
    renderBar();
    await open(user, "District");
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Invented-District, One/ }));

    const query = lastQuery();
    expect(query.getAll("district")).toEqual(["Invented-District, One"]);
    // The comma survives as data. Split, it would be two values matching
    // nothing — which is what an empty dashboard looked like.
    expect(query.getAll("district")[0]).toContain(",");
  });
});

describe("navigation", () => {
  it("never scrolls the page when a filter changes", async () => {
    // The dashboard is taller than a screen; a scrolling navigation throws a
    // reader working through the table back to the header on every tick.
    const user = userEvent.setup();
    renderBar();

    await open(user, "Window");
    await user.click(screen.getByRole("menuitemradio", { name: /Last 3 Months/ }));

    expect(pushed.at(-1)?.options?.scroll).toBe(false);
  });

  it("keeps every other filter when one changes", async () => {
    const user = userEvent.setup();
    renderBar({ districts: ["Invented-District, One"], salonNumbers: ["0313"], sort: "change" });

    await open(user, "Metric");
    await user.click(screen.getByRole("menuitemradio", { name: /Total Tans/ }));

    const query = lastQuery();
    expect(query.get("metric")).toBe("total_tans");
    expect(query.getAll("district")).toEqual(["Invented-District, One"]);
    expect(query.get("salon")).toBe("0313");
    expect(query.get("sort")).toBe("change");
  });
});
