import "server-only";

import type { ChatReportContext } from "./chat-report-context";
import {
  buildKpiCards,
  buildMovers,
  buildSalonRows,
  changeMetricCodeFor,
  sortSalonRows,
} from "./dashboard";
import { loadReportContext } from "./report-context";
import { buildSalonPerformanceBriefing } from "./salon-performance-briefing";
import { CURRENT_BASIS_YEAR } from "./filters";
import type { FactRow } from "./dashboard";

/**
 * ============================================================================
 * LOADING THE SALON PERFORMANCE SECTION
 * ============================================================================
 *
 * The server-only half of `salon-performance-briefing.ts`, and the shortest
 * module in this feature for one reason: it resolves the view through
 * `loadReportContext`, the same function the dashboard and the salon
 * drill-down resolve through.
 *
 * THAT SHARING IS THE WHOLE POINT. `report-context.ts` opens by saying why it
 * exists — the alternative is two copies, and the divergence shows up as the
 * bug hardest to see: a page that resolves the same link to a different sheet
 * and shows figures that disagree with the row that was clicked, both
 * internally consistent. Chat asking the same question is a third caller, so it
 * resolves period, window, sheet, measures and salons through the same six
 * steps in the same dependency order. There is no chat-specific idea of "which
 * period" anywhere in this file.
 *
 * The figures themselves come from `buildKpiCards`, `buildSalonRows` and
 * `buildMovers` — the dashboard's own builders. No total is re-summed and no
 * median recalculated.
 *
 * WHAT IT DOES NOT DO:
 *
 *   IT NEVER THROWS. Every failure, including "nothing ingested" and "this
 *   period holds no comparisons", returns null and the pipeline continues.
 *
 *   IT ACCEPTS NO FIGURE FROM THE CALLER. The context carries a period token, a
 *   window token, district labels, salon numbers and a metric code. All
 *   pointers. Every number below was read inside this function.
 */

/** How many salons a chat briefing's ranking may cover. Above the delivery's fifteen. */
const MAX_RANKED_SALONS = 60;

export interface SalonPerformanceSection {
  readonly text: string;
  /** The period actually read, for the composer's provenance line. */
  readonly periodLabel: string;
}

export async function loadSalonPerformanceSection(
  context: ChatReportContext | null,
): Promise<SalonPerformanceSection | null> {
  try {
    const mine = context?.family === "salon-performance" ? context : null;

    /*
     * THE DASHBOARD'S URL, REBUILT FROM POINTERS.
     *
     * `loadReportContext` takes raw search params because that is what the
     * pages hand it, and it sanitizes every one of them — dropping values this
     * period does not recognise and reporting what it dropped. Handing it the
     * chat context in the same shape means the chat turn goes through exactly
     * the same sanitisation rather than a parallel one that could be laxer.
     */
    const params: Record<string, string | string[] | undefined> = {};
    if (mine?.period) {
      // `grain:date` from the tab, or a bare ISO date from an older link. The
      // grain matters: `report_periods` is keyed on (grain, period_end), so two
      // periods can share an end date and cover one month or eight.
      const [grain, end] = mine.period.includes(":")
        ? mine.period.split(":", 2)
        : [null, mine.period];
      if (end) params.period = end;
      if (grain) params.grain = grain;
    }
    if (mine?.window) params.window = mine.window;
    if (mine?.view) params.view = mine.view;
    if (mine?.metric) params.metric = mine.metric;
    if (mine && mine.districts.length > 0) params.district = [...mine.districts];
    if (mine && mine.salons.length > 0) params.salon = [...mine.salons];

    const loaded = await loadReportContext(params);
    if (loaded.status !== "ready") return null;

    const {
      repository,
      scope,
      filters,
      activeWindow,
      activeSheet,
      sheetCatalogue,
      measureCodes,
      selectedMetric,
      allSalons,
    } = loaded.context;

    const salons = await repository.listSalons(scope.periodId, filters);

    /*
     * THE FACTS THE KPI ROW AND THE RANKING NEED, in one read.
     *
     * The change metric is requested alongside each measure because the source
     * publishes its own % change columns and a reported change is the weaker,
     * truer claim than one derived here — `buildSalonRows` prefers it and says
     * which it used.
     */
    const wanted = new Set<string>();
    for (const code of measureCodes) {
      wanted.add(code);
      wanted.add(changeMetricCodeFor(code));
    }
    if (selectedMetric) {
      wanted.add(selectedMetric.code);
      wanted.add(changeMetricCodeFor(selectedMetric.code));
    }

    const facts: FactRow[] = await repository.getFactRows({
      periodId: scope.periodId,
      metricCodes: [...wanted],
      salonNumbers: salons.map((salon) => salon.salonNumber),
      // Scoped to the sheet the selected comparison is a column of. The
      // month-to-date and year-to-date sheets describe different periods, so a
      // figure from the wrong one under this heading would be another period's.
      sourceSheet: activeSheet,
    });

    const kpis = buildKpiCards({
      metricCodes: measureCodes,
      catalogue: sheetCatalogue,
      facts,
      window: activeWindow,
      currentYear: CURRENT_BASIS_YEAR,
    });

    const rows = selectedMetric
      ? sortSalonRows(
          buildSalonRows({
            metricCode: selectedMetric.code,
            window: activeWindow,
            currentYear: CURRENT_BASIS_YEAR,
            salons,
            facts,
          }),
          filters.sort,
          filters.direction,
        ).slice(0, MAX_RANKED_SALONS)
      : [];

    const selectionLabel = describeSelection(filters.districts, filters.salonNumbers);

    const text = buildSalonPerformanceBriefing({
      scope,
      window: activeWindow,
      kpis,
      selectedMetric,
      rows,
      movers: buildMovers([...rows]),
      periodSalonCount: allSalons.length,
      selectionLabel,
      /*
       * `loadReportContext` reports what it had to adjust in `dropped`, phrased
       * for a manager. A period it did not recognise is exactly that case, so
       * the fallback is detected from the filters it actually resolved rather
       * than re-derived here.
       */
      fellBackToNewest: Boolean(
        mine?.period && !mine.period.endsWith(scope.periodEnd),
      ),
    });

    return text ? { text, periodLabel: scope.periodLabel } : null;
  } catch {
    // Deliberately silent and deliberately not rethrown — see above.
    return null;
  }
}

/** How the narrowed population should be described, or null when it is not narrowed. */
function describeSelection(
  districts: readonly string[],
  salonNumbers: readonly string[],
): string | null {
  const parts: string[] = [];
  if (districts.length > 0) {
    parts.push(`district ${districts.length === 1 ? districts[0] : districts.join(", ")}`);
  }
  if (salonNumbers.length > 0) {
    parts.push(`${salonNumbers.length} salon(s) named in the filter`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}
