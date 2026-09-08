import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import {
  BED_LEVELS,
  BED_USAGE_MEASURES_BY_CODE,
} from "@/lib/reporting/bed-usage/metric-map";
import {
  FAST_ADVISORY_NOTE,
  isAdvisoryOnlyLevel,
} from "@/lib/reporting/performance/classification";
import {
  detailRows,
  fastMigrationView,
  perBed,
  rankSalons,
  reconcile,
  summarizeLevels,
  summarizeSalons,
  totalsFor,
} from "@/lib/reporting/read/bed-spa/bed-usage-analytics";
import { perBedVersusEstate } from "@/lib/reporting/read/bed-spa/combined";
import {
  listBedUsagePeriods,
  loadBedUsage,
  periodToken,
  resolvePeriod,
} from "@/lib/reporting/read/bed-spa/read";
import { ReportFrame } from "@/features/reports/report-frame";
import { REPORTS } from "@/features/reports/reports-routes";
import { ChartFrame } from "@/features/reports/chart-kit";
import { BedSpaFilterBar } from "@/features/reports/bed-spa/filter-bar";
import {
  parseBedSpaFilters,
  serializeBedSpaFilters,
} from "@/features/reports/bed-spa/filter-state";
import { BedSpaDataTable, orDash } from "@/features/reports/bed-spa/data-table";
import {
  bandLabel,
  bandTone,
  formatCount,
  formatDelta,
  formatPerBed,
  formatRate,
} from "@/features/reports/bed-spa/format";
import { KpiCardRow } from "@/features/reports/bed-spa/kpi-cards";
import {
  CoverageBanner,
  PeriodFallbackNotice,
  ProvenanceLine,
  SourcePanel,
} from "@/features/reports/bed-spa/provenance";
import { RankedBarChart } from "@/features/reports/bed-spa/ranked-bar-chart";

/**
 * ============================================================================
 * BED USAGE — tanning traffic and equipment utilisation
 * ============================================================================
 *
 * The monthly report, narrowed to the authorized company's salons and compared
 * against the chain benchmark the source itself publishes.
 *
 * THREE THINGS ON THIS PAGE ARE NOT WHAT AN OBVIOUS IMPLEMENTATION WOULD DO:
 *
 * PER-BED USAGE IS RECOMPUTED WHEREVER SALONS ARE COMBINED. The estate figure
 * is the sum of tans over the sum of beds, not the mean of fifteen per-bed
 * figures. For this estate the two differ materially, because a 15-bed salon
 * and a 29-bed salon are not equal contributors to how hard the equipment
 * works.
 *
 * THE FAST LEVEL IS PRESENTED AS CAPACITY, NOT PERFORMANCE. Its shortfall
 * against the chain is shown — the arithmetic is the source's — and it is
 * badged as tracked-for-capacity rather than classified as a failure. FAST
 * removals are intentional; treating the consequence as a KPI would make the
 * intended outcome the worst number on the page.
 *
 * THE TABLE HAS NO TOTALS ROW FOR THE DERIVED COLUMNS. Per Bed and v Chain
 * cannot be added and their averages are not the estate's figures; the KPI
 * cards carry the estate roll-up, computed from the parts.
 */

export const metadata: Metadata = { title: "Bed Usage" };

/** Reads live reporting data on every request. */
export const dynamic = "force-dynamic";

const BASE_PATH = "/reports/bed-usage";
const REPORT = REPORTS.find((report) => report.key === "bed-usage")!;

/** Sortable fields on the equipment table. */
const SORT_FIELDS = [
  "salon",
  "level",
  "bedType",
  "qty",
  "clientTans",
  "perBed",
  "vChain",
  "share",
] as const;

export default async function BedUsagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="Supabase is not configured in this runtime">
          This report reads ingested reporting data directly, so it needs the
          server-side Supabase configuration in whichever environment served this
          page. An administrator can add it; there is nothing for a reader to do
          and no other address to try.
        </Notice>
      </ReportFrame>
    );
  }

  const search = await searchParams;
  const periods = await listBedUsagePeriods();

  if (periods.length === 0) {
    return (
      <ReportFrame report={REPORT}>
        <EmptyState
          title="No Bed Usage Report has been ingested yet"
          description="This report arrives monthly and covers every salon in the chain; Ask Sunny keeps the salons this recipient is authorized for. Once a delivery has been ingested, its tans, per-bed usage and v Chain figures appear here."
        />
      </ReportFrame>
    );
  }

  const { period, fellBack } = resolvePeriod(
    typeof search.period === "string" ? search.period : null,
    periods,
  );
  const data = period ? await loadBedUsage(period.periodId) : null;

  if (!period || !data) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="This reporting period has no figures">
          The period exists but reported no salon rows. Try another period.
        </Notice>
      </ReportFrame>
    );
  }

  // ---------------------------------------------------------------- filters ---
  const allSalons = summarizeSalons(data.salons, data.equipment);
  const districtValues = [
    ...new Set(allSalons.map((salon) => salon.districtLabel).filter((value): value is string => value !== null)),
  ].sort();
  const regionValues = [
    ...new Set(allSalons.map((salon) => salon.regionLabel).filter((value): value is string => value !== null)),
  ].sort();
  const salonValues = allSalons
    .map((salon) => salon.salonNumber)
    .filter((value): value is string => value !== null);
  const levelValues = [...new Set(data.equipment.map((row) => row.level))].sort(
    (a, b) => BED_LEVELS.indexOf(a) - BED_LEVELS.indexOf(b),
  );
  const bedTypeValues = [...new Set(data.equipment.map((row) => row.bedType))].sort();

  const { filters, dropped } = parseBedSpaFilters(search, {
    periods: periods.map(periodToken),
    districts: districtValues,
    regions: regionValues,
    salons: salonValues,
    levels: levelValues,
    bedTypes: bedTypeValues,
    sortFields: SORT_FIELDS,
  });

  /*
   * SALON SELECTION IS COMPUTED FROM THE SANITIZED DESCRIPTOR FILTERS, so
   * deselecting a district removes its salons from the selection instead of
   * leaving an invisible contradiction — a filter narrowing the numbers with no
   * control showing it.
   */
  const admitsSalon = (salon: { salonNumber: string | null; districtLabel: string | null; regionLabel: string | null }) => {
    if (filters.districts.length > 0 && (salon.districtLabel === null || !filters.districts.includes(salon.districtLabel))) {
      return false;
    }
    if (filters.regions.length > 0 && (salon.regionLabel === null || !filters.regions.includes(salon.regionLabel))) {
      return false;
    }
    if (filters.salons.length > 0 && (salon.salonNumber === null || !filters.salons.includes(salon.salonNumber))) {
      return false;
    }
    return true;
  };

  const salons = allSalons.filter(admitsSalon);
  const admittedNames = new Set(salons.map((salon) => salon.storeName));
  const equipment = data.equipment.filter(
    (row) =>
      admittedNames.has(row.storeName) &&
      (filters.levels.length === 0 || filters.levels.includes(row.level)) &&
      (filters.bedTypes.length === 0 || filters.bedTypes.includes(row.bedType)),
  );

  // ---------------------------------------------------------------- analysis ---
  const totals = totalsFor(salons);
  const levels = summarizeLevels(equipment, data.benchmarks);
  const fast = fastMigrationView(levels);
  const rows = detailRows(equipment, data.salons, data.benchmarks).filter(
    (row) =>
      filters.bands.length === 0 ||
      (row.versusChain.band !== null && filters.bands.includes(row.versusChain.band)),
  );
  const mismatches = reconcile(data.salons, data.equipment);

  /*
   * THE ESTATE PER-BED FIGURE every salon's comparison is against. Recomputed
   * from the SELECTED salons, so "above this estate" means what it says when a
   * district is filtered.
   */
  const estatePerBed = totals.perBed;

  const sortField = filters.sort ?? "vChain";
  const direction = filters.direction ?? (sortField === "salon" ? "asc" : "desc");
  const sorted = [...rows].sort((a, b) => {
    const compare = (() => {
      switch (sortField) {
        case "salon":
          return a.storeName.localeCompare(b.storeName);
        case "level":
          return BED_LEVELS.indexOf(a.level) - BED_LEVELS.indexOf(b.level);
        case "bedType":
          return a.bedType.localeCompare(b.bedType);
        case "qty":
          return (a.qty ?? -1) - (b.qty ?? -1);
        case "clientTans":
          return (a.clientTans ?? -1) - (b.clientTans ?? -1);
        case "perBed":
          return (a.perBed ?? -1) - (b.perBed ?? -1);
        case "share":
          return (a.shareOfSalonTans ?? -1) - (b.shareOfSalonTans ?? -1);
        default:
          // A row with no comparison sorts last in either direction rather than
          // reading as the worst performer.
          return (
            (a.versusChain.deltaPercent ?? Number.NEGATIVE_INFINITY) -
            (b.versusChain.deltaPercent ?? Number.NEGATIVE_INFINITY)
          );
      }
    })();
    return direction === "asc" ? compare : -compare;
  });

  const sortHref = (field: string) => {
    const flipping = field === sortField;
    const next = flipping ? (direction === "desc" ? "asc" : "desc") : field === "salon" ? "asc" : "desc";
    const params = serializeBedSpaFilters({
      ...filters,
      sort: field,
      direction: next as "asc" | "desc",
    });
    return `${BASE_PATH}?${params.toString()}`;
  };

  const topPerformers = rankSalons(salons, (salon) => salon.perBed, { limit: 5 });
  const bottomPerformers = rankSalons(salons, (salon) => salon.perBed, {
    direction: "asc",
    limit: 5,
  });

  return (
    <PermissionGate permission="view_reports">
      <ReportFrame report={REPORT}>
        <ProvenanceLine provenance={data.provenance} />
        <CoverageBanner provenance={data.provenance} />
        <PeriodFallbackNotice fellBack={fellBack} period={period} />

        {dropped.length > 0 ? (
          <Notice tone="neutral">
            Some filters this link carried were dropped: {dropped.join("; ")}.
          </Notice>
        ) : null}

        <BedSpaFilterBar
          base={BASE_PATH}
          filters={filters}
          periods={periods}
          regions={regionValues.map((value) => ({ value, label: value }))}
          districts={districtValues.map((value) => ({ value, label: value }))}
          salons={allSalons
            .filter((salon) => salon.salonNumber !== null)
            .map((salon) => ({
              value: salon.salonNumber!,
              label: salon.storeName,
              note: salon.salonNumber!,
              searchText: salon.salonNumber!,
            }))}
          levels={levelValues.map((value) => ({
            value,
            label: value,
            note: isAdvisoryOnlyLevel(value) ? "Capacity only" : undefined,
          }))}
          bedTypes={bedTypeValues.map((value) => ({ value, label: value }))}
          showPerformance
        />

        <KpiCardRow
          cards={[
            {
              id: "total-tans",
              label: "Total Tans",
              value: totals.totalTans === null ? null : formatCount(totals.totalTans),
              helper:
                totals.salonsMissingTans > 0
                  ? `Across ${formatCount(totals.salonCount - totals.salonsMissingTans)} salons; ${totals.salonsMissingTans} did not report a figure.`
                  : `${BED_USAGE_MEASURES_BY_CODE.salon_total_tans.label} across ${formatCount(totals.salonCount)} salons, read once per salon.`,
              emphasis: true,
            },
            {
              id: "beds",
              label: "Total Beds",
              value: totals.bedCount === null ? null : formatCount(totals.bedCount),
              helper: "Installed units across every equipment level.",
            },
            {
              id: "per-bed",
              label: "Per Bed Usage",
              value: totals.perBed === null ? null : formatPerBed(totals.perBed),
              helper:
                "Tans divided by installed beds, recomputed from both sums — not an average of the salons' figures.",
            },
            {
              id: "salons",
              label: "Salons Reporting",
              value: formatCount(totals.salonCount),
              helper:
                data.provenance.sourceSalonCount !== null &&
                data.provenance.sourceSalonCount > totals.salonCount
                  ? `Of ${formatCount(data.provenance.sourceSalonCount)} in the delivery. This report is the recipient slice.`
                  : "Every salon in this report.",
            },
          ]}
        />

        {/* ------------------------------------------------ equipment levels --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Versus the chain, by equipment level"
            description="Each level's per-bed usage against the chain's own average for the same level, recomputed from this selection's tans and units."
          />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <BedSpaDataTable
              rows={levels}
              rowKey={(level) => level.level}
              sort={null}
              direction={null}
              sortHref={() => BASE_PATH}
              minWidth={780}
              columns={[
                {
                  key: "level",
                  label: "Level",
                  sortable: false,
                  render: (level) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{level.level}</span>
                      {level.advisoryOnly ? (
                        <Badge tone="outline" size="sm" title={FAST_ADVISORY_NOTE}>
                          Capacity only
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "salons",
                  label: "Salons",
                  align: "right",
                  sortable: false,
                  render: (level) => formatCount(level.salonCount),
                },
                {
                  key: "units",
                  label: "Units",
                  align: "right",
                  sortable: false,
                  render: (level) => orDash(level.units === null ? null : formatCount(level.units)),
                },
                {
                  key: "tans",
                  label: "Tans",
                  align: "right",
                  sortable: false,
                  render: (level) =>
                    orDash(level.clientTans === null ? null : formatCount(level.clientTans)),
                },
                {
                  key: "perBed",
                  label: "Per Bed",
                  align: "right",
                  sortable: false,
                  render: (level) => orDash(level.perBed === null ? null : formatPerBed(level.perBed)),
                },
                {
                  key: "chain",
                  label: "Chain Per Bed",
                  hint: "The source's own benchmark",
                  align: "right",
                  sortable: false,
                  render: (level) =>
                    orDash(level.chainPerBed === null ? null : formatPerBed(level.chainPerBed)),
                },
                {
                  key: "vChain",
                  label: "v Chain",
                  align: "right",
                  sortable: false,
                  render: (level) => (
                    <span
                      title={level.versusChain.unavailableReason ?? undefined}
                      className="tabular-nums"
                    >
                      {formatDelta(level.versusChain.deltaPercent)}
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  align: "center",
                  sortable: false,
                  render: (level) =>
                    /*
                     * A FAST shortfall is shown as a figure and NOT badged as a
                     * finding. The removals are intentional, so the band would
                     * be reporting the intended outcome as the worst result on
                     * the page.
                     */
                    level.versusChain.reportableFinding ? (
                      <Badge tone={bandTone(level.versusChain.band)} size="sm">
                        {bandLabel(level.versusChain.band)}
                      </Badge>
                    ) : (
                      <span
                        className="text-[11px] text-muted-foreground"
                        title={level.advisoryOnly ? FAST_ADVISORY_NOTE : undefined}
                      >
                        {level.advisoryOnly ? "Tracked for capacity" : "No comparison"}
                      </span>
                    ),
                },
              ]}
            />
          </div>

          <div className="rounded-[var(--radius-lg)] border border-border bg-surface-muted p-5">
            <h3 className="text-[15px] font-semibold text-foreground">
              FAST capacity and volume migration
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {FAST_ADVISORY_NOTE}
            </p>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "FAST units",
                  value: fast.fastUnits === null ? "—" : formatCount(fast.fastUnits),
                  note:
                    fast.fastShareOfBeds === null
                      ? `${fast.salonsWithFast} salons still hold FAST`
                      : `${formatRate(fast.fastShareOfBeds)} of installed beds`,
                },
                {
                  label: "FAST tans",
                  value: fast.fastTans === null ? "—" : formatCount(fast.fastTans),
                  note:
                    fast.fastShareOfTans === null
                      ? "Not reported"
                      : `${formatRate(fast.fastShareOfTans)} of this selection's tans`,
                },
                {
                  label: "FAST per bed",
                  value: fast.fastPerBed === null ? "—" : formatPerBed(fast.fastPerBed),
                  note: "Not a performance measure",
                },
                {
                  label: "Premium per bed",
                  value: fast.premiumPerBed === null ? "—" : formatPerBed(fast.premiumPerBed),
                  note:
                    fast.premiumUnits === null
                      ? "FASTER, FASTEST and INSTANT"
                      : `${formatCount(fast.premiumUnits)} FASTER, FASTEST and INSTANT units`,
                },
              ].map((entry) => (
                <div key={entry.label}>
                  <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    {entry.label}
                  </dt>
                  <dd className="mt-1 text-[20px] leading-none font-semibold text-foreground tabular-nums">
                    {entry.value}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">{entry.note}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ------------------------------------------------------- rankings --- */}
        <section className="grid gap-4 lg:grid-cols-2">
          <ChartFrame
            title="Total Tans by salon"
            description="Tanning traffic for the period, read once per salon from the source's own Salon Tans column."
            height={Math.max(200, salons.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(salons, (salon) => salon.totalTans).map((salon) => ({
                key: salon.salonNumber ?? salon.storeName,
                label: salon.storeName,
                value: salon.totalTans,
                detail: [
                  { label: "Beds", value: formatCount(salon.bedCount) },
                  { label: "Per bed", value: formatPerBed(salon.perBed) },
                ],
              }))}
              valueLabel="Total Tans"
              format="count"
            />
          </ChartFrame>

          <ChartFrame
            title="Per Bed usage by salon"
            description="Tans per installed bed, with this selection's own figure as the reference line."
            height={Math.max(200, salons.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(salons, (salon) => salon.perBed).map((salon) => {
                const versus = perBedVersusEstate(salon.perBed, estatePerBed);
                return {
                  key: salon.salonNumber ?? salon.storeName,
                  label: salon.storeName,
                  value: salon.perBed,
                  band: versus.band,
                  detail: [
                    { label: "Tans", value: formatCount(salon.totalTans) },
                    { label: "Beds", value: formatCount(salon.bedCount) },
                    { label: "v this estate", value: formatDelta(versus.deltaPercent) },
                  ],
                };
              })}
              valueLabel="Per Bed"
              format="perBed"
              reference={
                estatePerBed === null
                  ? null
                  : { value: estatePerBed, label: `Estate ${formatPerBed(estatePerBed)}` }
              }
            />
          </ChartFrame>

          <ChartFrame
            title="v Chain by equipment level"
            description="Each level against the chain's average per-bed usage for the same level. FAST is shown and is not classified."
            height={Math.max(200, levels.length * 30 + 48)}
          >
            <RankedBarChart
              rows={levels
                .filter((level) => level.versusChain.deltaPercent !== null)
                .sort(
                  (a, b) =>
                    (b.versusChain.deltaPercent ?? 0) - (a.versusChain.deltaPercent ?? 0),
                )
                .map((level) => ({
                  key: level.level,
                  label: level.advisoryOnly ? `${level.level} (capacity)` : level.level,
                  value: level.versusChain.deltaPercent,
                  band: level.versusChain.reportableFinding ? level.versusChain.band : null,
                  detail: [
                    { label: "Per bed", value: formatPerBed(level.perBed) },
                    { label: "Chain per bed", value: formatPerBed(level.chainPerBed) },
                    { label: "Units", value: formatCount(level.units) },
                  ],
                }))}
              valueLabel="v Chain"
              format="delta"
              emptyMessage="This report carries no chain benchmark for the selected levels."
            />
          </ChartFrame>

          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <h3 className="text-[15px] font-semibold text-foreground">
              Strongest and weakest equipment utilisation
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              By per-bed usage. A salon that reported no figure is absent rather
              than ranked last.
            </p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              {[
                { title: "Top five", rows: topPerformers },
                { title: "Bottom five", rows: bottomPerformers },
              ].map((group) => (
                <div key={group.title}>
                  <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    {group.title}
                  </p>
                  <ol className="mt-2 space-y-1.5">
                    {group.rows.map((salon) => (
                      <li
                        key={salon.salonNumber ?? salon.storeName}
                        className="flex items-baseline justify-between gap-3 text-[13px]"
                      >
                        <span className="truncate text-foreground">{salon.storeName}</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {formatPerBed(salon.perBed)}
                        </span>
                      </li>
                    ))}
                    {group.rows.length === 0 ? (
                      <li className="text-[13px] text-muted-foreground">
                        No salon reported per-bed usage.
                      </li>
                    ) : null}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------- detail table --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Equipment detail"
            description="One row per salon per bed model, as the source reports it. Per Bed and v Chain are not summable, so there is no totals row for them."
          />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <BedSpaDataTable
              rows={sorted}
              rowKey={(row) => `${row.storeName}|${row.level}|${row.bedType}`}
              sort={sortField}
              direction={direction}
              sortHref={sortHref}
              minWidth={980}
              emptyMessage="No equipment row matches the current filters."
              columns={[
                {
                  key: "salon",
                  label: "Salon",
                  render: (row) => (
                    <span className="whitespace-nowrap">
                      <span className="text-foreground">{row.storeName}</span>
                      {row.salonNumber ? (
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          {row.salonNumber}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "level",
                  label: "Level",
                  render: (row) => (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      {row.level}
                      {row.advisoryOnly ? (
                        <Badge tone="outline" size="sm" title={FAST_ADVISORY_NOTE}>
                          Capacity
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                { key: "bedType", label: "Bed Type", render: (row) => row.bedType },
                {
                  key: "qty",
                  label: "Units",
                  align: "right",
                  render: (row) => orDash(row.qty === null ? null : formatCount(row.qty)),
                },
                {
                  key: "clientTans",
                  label: "Tans",
                  align: "right",
                  render: (row) =>
                    orDash(row.clientTans === null ? null : formatCount(row.clientTans)),
                },
                {
                  key: "perBed",
                  label: "Per Bed",
                  align: "right",
                  render: (row) => orDash(row.perBed === null ? null : formatPerBed(row.perBed)),
                },
                {
                  key: "vChain",
                  label: "v Chain",
                  align: "right",
                  render: (row) => (
                    <span title={row.versusChain.unavailableReason ?? undefined}>
                      {formatDelta(row.versusChain.deltaPercent)}
                    </span>
                  ),
                },
                {
                  key: "share",
                  label: "% of Salon Tans",
                  align: "right",
                  render: (row) => orDash(formatRate(row.shareOfSalonTans)),
                },
                {
                  key: "status",
                  label: "Status",
                  align: "center",
                  sortable: false,
                  render: (row) =>
                    row.versusChain.reportableFinding ? (
                      <Badge tone={bandTone(row.versusChain.band)} size="sm">
                        {bandLabel(row.versusChain.band)}
                      </Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {row.advisoryOnly ? "Capacity" : "—"}
                      </span>
                    ),
                },
              ]}
              /*
               * ONLY THE SUMMABLE COLUMNS GET A FOOTER. Units and tans add;
               * Per Bed is recomputed from both; v Chain and % of Salon Tans
               * cannot be combined at all and are left blank rather than
               * showing an average that means nothing.
               */
              footer={{
                salon: `${formatCount(sorted.length)} rows`,
                qty: formatCount(
                  sorted.reduce((total, row) => total + (row.qty ?? 0), 0),
                ),
                clientTans: formatCount(
                  sorted.reduce((total, row) => total + (row.clientTans ?? 0), 0),
                ),
                perBed: formatPerBed(
                  perBed(
                    sorted.reduce((total, row) => total + (row.clientTans ?? 0), 0),
                    sorted.reduce((total, row) => total + (row.qty ?? 0), 0),
                  ),
                ),
              }}
            />
          </div>
        </section>

        <SourcePanel
          provenance={data.provenance}
          extra={[
            {
              label: "Chain benchmark levels",
              value:
                data.benchmarks.length === 0
                  ? "Not carried by this delivery"
                  : data.benchmarks.map((benchmark) => benchmark.level).join(", "),
            },
            {
              label: "Salon totals reconcile with equipment rows",
              value:
                mismatches.length === 0
                  ? "Yes, for every salon"
                  : `No — ${mismatches.map((entry) => entry.storeName).join(", ")}`,
            },
          ]}
        />
      </ReportFrame>
    </PermissionGate>
  );
}
