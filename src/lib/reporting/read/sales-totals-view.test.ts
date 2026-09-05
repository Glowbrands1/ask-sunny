import { describe, expect, it } from "vitest";

import { resolveSalesTotalsSelection } from "./sales-totals-view";
import type { SalesTotalsSnapshot, SalesTotalsSubject } from "./sales-totals-read";

/**
 * ============================================================================
 * A FILTER MUST NEVER BROADEN ITSELF
 * ============================================================================
 *
 * The resolver decides which salons a set of filters means, and the dashboard
 * and the Ask Sunny analyser both call it — so whatever it decides, they agree
 * about.
 *
 * THE DEFECT THESE TESTS PIN. "All salons" used to be derived from
 * `selectedKeys.length === 0`, which is true in two completely different
 * situations: nobody asked for a filter, and somebody asked for salons that are
 * not in this delivery. Under that rule a link naming salon 9999 — a typo, a
 * store that moved district, a report the reader does not receive — silently
 * turned into "every salon in the delivery" and answered a far broader question
 * than the URL asked. Dropping an unknown identifier is right; widening the
 * view because of it is not.
 */

function figure(code: string, value: number | null) {
  return {
    metricCode: code,
    metricLabel: code,
    unit: "currency" as const,
    aggregation: "sum" as const,
    summaryIsAverage: true,
    note: "",
    value,
  };
}

function salon(key: string, label: string): SalesTotalsSubject {
  return {
    kind: "salon",
    key,
    label,
    salonNumber: key,
    salonCount: null,
    figures: [figure("grand_total", 100)],
  };
}

const SNAPSHOT: SalesTotalsSnapshot = {
  reportDate: "2026-09-02",
  reportDateRaw: "09-02-2026",
  monthStart: "2026-09-01",
  window: "daily",
  windowLabel: "Previous Day",
  windowDescription: "The single day the report covers.",
  summaries: [
    {
      kind: "summary",
      key: "all_salons",
      label: "All Salons",
      salonNumber: null,
      salonCount: 249,
      figures: [figure("grand_total", 818.45)],
    },
  ],
  salons: [salon("1001", "Aurora"), salon("1002", "Bayside"), salon("1003", "Cedar")],
  lineage: { parserKey: "sales_totals_v1", parserVersion: 1, ingestedAt: null },
};

const labels = (view: { selectedSalons: readonly SalesTotalsSubject[] }) =>
  view.selectedSalons.map((entry) => entry.label);

describe("the four states an explicit salon selection can be in", () => {
  it("[] means every salon in this delivery", () => {
    const view = resolveSalesTotalsSelection(SNAPSHOT, { salonIds: [] });

    expect(labels(view)).toEqual(["Aurora", "Bayside", "Cedar"]);
    expect(view.isAllSalons).toBe(true);
    expect(view.selectionInvalid).toBe(false);
  });

  it("a missing salon filter also means every salon in this delivery", () => {
    const view = resolveSalesTotalsSelection(SNAPSHOT, {});

    expect(labels(view)).toEqual(["Aurora", "Bayside", "Cedar"]);
    expect(view.isAllSalons).toBe(true);
    expect(view.selectionInvalid).toBe(false);
  });

  it('["1001"] means exactly that salon', () => {
    const view = resolveSalesTotalsSelection(SNAPSHOT, { salonIds: ["1001"] });

    expect(labels(view)).toEqual(["Aurora"]);
    expect(view.isAllSalons).toBe(false);
    expect(view.selectionInvalid).toBe(false);
    expect(view.unknownSalonIds).toEqual([]);
  });

  it('["1001", "unknown"] keeps the valid salon and drops the other', () => {
    // A stale shared link should still open on the salons that do exist.
    const view = resolveSalesTotalsSelection(SNAPSHOT, { salonIds: ["1001", "unknown"] });

    expect(labels(view)).toEqual(["Aurora"]);
    expect(view.isAllSalons).toBe(false);
    expect(view.selectionInvalid).toBe(false);
    expect(view.unknownSalonIds).toEqual(["unknown"]);
  });

  it('["unknown"] selects NOTHING, and specifically not everything', () => {
    const view = resolveSalesTotalsSelection(SNAPSHOT, { salonIds: ["unknown"] });

    expect(labels(view)).toEqual([]);
    expect(view.isAllSalons).toBe(false);
    expect(view.selectionInvalid).toBe(true);
    expect(view.unknownSalonIds).toEqual(["unknown"]);
  });

  it("several unknown salons are still an empty selection, not the whole delivery", () => {
    const view = resolveSalesTotalsSelection(SNAPSHOT, {
      salonIds: ["9998", "9999", "does-not-exist"],
    });

    expect(view.selectedSalons).toEqual([]);
    expect(view.selectionInvalid).toBe(true);
    expect(view.isAllSalons).toBe(false);
  });

  it("blank and whitespace entries are not an explicit selection", () => {
    // The dashboard builds this list by splitting a query parameter, so an
    // absent one arrives as [""]. That is "no filter", not "a filter that
    // matched nothing" — a URL with no salons must still show them all.
    const view = resolveSalesTotalsSelection(SNAPSHOT, { salonIds: ["", "   "] });

    expect(labels(view)).toEqual(["Aurora", "Bayside", "Cedar"]);
    expect(view.isAllSalons).toBe(true);
    expect(view.selectionInvalid).toBe(false);
  });
});
