import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { requirePagePermission } from "@/lib/auth/page";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { rankSalons } from "@/lib/reporting/read/bed-spa/bed-usage-analytics";
import {
  daysSinceFirstUse,
  equipmentPerformance,
  firstUsedWithinPeriod,
  spaWellnessTotals,
  summarizeSpaSalons,
} from "@/lib/reporting/read/bed-spa/spa-wellness-analytics";
import {
  formatBedSpaDate,
  periodToken,
  resolvePeriod,
} from "@/lib/reporting/read/bed-spa/period-token";
import { listSpaWellnessPeriods, loadSpaWellness } from "@/lib/reporting/read/bed-spa/read";
import { BandStatusChip } from "@/features/reports/bed-spa/status-chip";
import { ReportFrame } from "@/features/reports/report-frame";
import { AskSunnyAboutReport } from "@/features/reports/ask-sunny-about-report";
import { REPORTS } from "@/features/reports/reports-routes";
import { ChartFrame } from "@/features/reports/chart-kit";
import { BedSpaFilterBar } from "@/features/reports/bed-spa/filter-bar";
import {
  admitsSalon,
  parseBedSpaFilters,
  serializeBedSpaFilters,
  type SalonFacets,
} from "@/features/reports/bed-spa/filter-state";
import { BedSpaDataTable, orDash } from "@/features/reports/bed-spa/data-table";
import {
  formatCount,
  formatDelta,
  formatPerBed,
} from "@/features/reports/bed-spa/format";
import { KpiCardRow, trendFor } from "@/features/reports/bed-spa/kpi-cards";
import {
  PeriodFallbackNotice,
  BedSpaProvenanceChips,
  SourcePanel,
} from "@/features/reports/bed-spa/provenance";
import { DeltaFigure } from "@/features/reports/bed-spa/delta-figure";
import { RankedBarChart } from "@/features/reports/bed-spa/ranked-bar-chart";

/**
 * ============================================================================
 * SPA WELLNESS — sessions by equipment, against installed peers
 * ============================================================================
 *
 * THE RULE THIS PAGE IS BUILT AROUND: a zero or blank equipment cell means the
 * equipment is NOT INSTALLED. Not idle, not underperforming — absent. In the
 * August 2026 workbook 86% of the equipment cells are blank, so the rule
 * governs most of the data, and getting it wrong turns a well-run estate into a
 * failing one.
 *
 * What that means on screen:
 *
 *   NO ZERO BARS. A chart shows the equipment a salon HAS. There is no row for
 *   a machine it does not have, so nothing can be read as a machine taking no
 *   sessions.
 *
 *   THE PEER AVERAGE IS OVER INSTALLED PEERS ON BOTH SIDES, and the salon
 *   counts are shown beside it. "JB's 15 Hydromassage salons against 197 peer
 *   salons" is a claim a reader can check; "-21%" on its own is not.
 *
 *   THE `Other` BUCKET IS COUNTED AND NOT COMPARED. It aggregates whatever did
 *   not map to a named type, so one salon's "Other" and another's are different
 *   machines.
 *
 * AND NO RAMP RULE IS INVENTED. No approved definition of "new equipment"
 * exists, so this page shows first-use dates and an age in days as of the
 * period's own end, flags the units first used INSIDE the period as a fact
 * about the window, and leaves the judgement to the reader.
 */

export const metadata: Metadata = { title: "Spa Wellness" };

export const dynamic = "force-dynamic";

const BASE_PATH = "/reports/spa-wellness";
const REPORT = REPORTS.find((report) => report.key === "spa-wellness")!;

const SORT_FIELDS = [
  "salon",
  "equipment",
  "sessions",
  "peer",
  "delta",
  "firstUse",
  "lastUse",
] as const;

export default async function SpaWellnessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * THE SERVER-SIDE GATE, FIRST — before the configuration check and before any
   * query. The `PermissionGate` further down is a client-side courtesy that
   * hides the page's chrome; it is not a gate, because a reader who types the
   * URL has already been served whatever ran before it.
   */
  await requirePagePermission("view_reports");

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
  const periods = await listSpaWellnessPeriods();

  if (periods.length === 0) {
    return (
      <ReportFrame report={REPORT}>
        <EmptyState
          title="No SPA Wellness Tracking report has been ingested yet"
          description="This report carries three windows in one file — month to date, year to date and last twelve months — and each becomes its own reporting period. Once a delivery has been ingested, its sessions by equipment and its peer comparisons appear here."
        />
      </ReportFrame>
    );
  }

  const { period, fellBack } = resolvePeriod(
    typeof search.period === "string" ? search.period : null,
    periods,
  );
  const data = period ? await loadSpaWellness(period.periodId) : null;

  if (!period || !data) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="This reporting period has no figures">
          The period exists but reported no salon rows. Try another window or
          another period.
        </Notice>
      </ReportFrame>
    );
  }

  // ---------------------------------------------------------------- filters ---
  const districtValues = [
    ...new Set(
      data.salons.map((salon) => salon.districtLabel).filter((value): value is string => value !== null),
    ),
  ].sort();
  const regionValues = [
    ...new Set(
      data.salons.map((salon) => salon.regionLabel).filter((value): value is string => value !== null),
    ),
  ].sort();
  const salonValues = data.salons
    .map((salon) => salon.salonNumber)
    .filter((value): value is string => value !== null);
  const equipmentValues = data.equipmentTypes.map((type) => type.code);

  const { filters, dropped } = parseBedSpaFilters(search, {
    periods: periods.map(periodToken),
    districts: districtValues,
    regions: regionValues,
    salons: salonValues,
    equipment: equipmentValues,
    sortFields: SORT_FIELDS,
  });

  /*
   * THE SHARED PREDICATE. This was a local copy in each of the three
   * pages — the same three conditions written out three times, which is
   * three places for the district filter to drift and no single place to
   * test it. See `admitsSalon` in `filter-state.ts`.
   */
  const admits = (salon: SalonFacets) => admitsSalon(filters, salon);

  const salons = data.salons.filter(admits);
  const admittedNames = new Set(salons.map((salon) => salon.storeName));
  const use = data.equipmentUse.filter(
    (row) =>
      admittedNames.has(row.storeName) &&
      (filters.equipment.length === 0 || filters.equipment.includes(row.equipmentCode)),
  );

  // ---------------------------------------------------------------- analysis ---
  const performance = equipmentPerformance(data.equipmentTypes, use, data.benchmarks).filter(
    (entry) =>
      filters.bands.length === 0 ||
      (entry.versusPeers.band !== null && filters.bands.includes(entry.versusPeers.band)),
  );
  const salonSummaries = summarizeSpaSalons(salons, use);
  const totals = spaWellnessTotals(salons, performance);
  const typeByCode = new Map(data.equipmentTypes.map((type) => [type.code, type]));

  /*
   * EQUIPMENT FIRST USED INSIDE THE PERIOD. A fact about the window, not a
   * judgement: these units have not been installed for the whole span they are
   * being measured over, so their session counts cover less time than their
   * peers'. No ramp allowance is applied, because none is approved.
   */
  const midPeriod = firstUsedWithinPeriod(use, data.period);

  const sortField = filters.sort ?? "delta";
  const direction = filters.direction ?? (sortField === "salon" || sortField === "equipment" ? "asc" : "desc");

  /** The detail table's grain: one row per salon per installed equipment type. */
  const detail = use.map((row) => {
    const entry = performance.find((candidate) => candidate.equipmentCode === row.equipmentCode);
    const type = typeByCode.get(row.equipmentCode);
    const benchmark = data.benchmarks.find(
      (candidate) => candidate.equipmentCode === row.equipmentCode,
    );
    return {
      ...row,
      equipmentLabel: type?.label ?? row.equipmentCode,
      equipmentShortLabel: type?.shortLabel ?? row.equipmentCode,
      comparable: type?.isComparable ?? true,
      peerAverage: benchmark?.peerAverageSessions ?? null,
      peerSalonCount: benchmark?.peerSalonCount ?? 0,
      /*
       * THIS SALON'S OWN DELTA against the peer average, not the estate-wide
       * one on the equipment card above. The two answer different questions:
       * "is this unit busy compared with other people's" versus "is our estate
       * busy compared with other people's".
       */
      delta:
        type?.isComparable !== false &&
        benchmark?.peerAverageSessions !== null &&
        benchmark?.peerAverageSessions !== undefined &&
        benchmark.peerAverageSessions !== 0
          ? (row.sessions / benchmark.peerAverageSessions - 1) * 100
          : null,
      band: entry?.versusPeers.band ?? null,
      ageDays: daysSinceFirstUse(row.firstUseDate, data.period.periodEnd),
      firstUsedInPeriod: midPeriod.some(
        (candidate) =>
          candidate.storeName === row.storeName && candidate.equipmentCode === row.equipmentCode,
      ),
    };
  });

  const sorted = [...detail].sort((a, b) => {
    const compare = (() => {
      switch (sortField) {
        case "salon":
          return a.storeName.localeCompare(b.storeName);
        case "equipment":
          return a.equipmentShortLabel.localeCompare(b.equipmentShortLabel);
        case "peer":
          return (a.peerAverage ?? -1) - (b.peerAverage ?? -1);
        case "firstUse":
          return (a.firstUseDate ?? "").localeCompare(b.firstUseDate ?? "");
        case "lastUse":
          return (a.lastUseDate ?? "").localeCompare(b.lastUseDate ?? "");
        case "sessions":
          return a.sessions - b.sessions;
        default:
          // A row with no comparison sorts last either way, rather than reading
          // as the worst performer.
          return (
            (a.delta ?? Number.NEGATIVE_INFINITY) - (b.delta ?? Number.NEGATIVE_INFINITY)
          );
      }
    })();
    return direction === "asc" ? compare : -compare;
  });

  const sortHref = (field: string) => {
    const flipping = field === sortField;
    const next = flipping
      ? direction === "desc"
        ? "asc"
        : "desc"
      : field === "salon" || field === "equipment"
        ? "asc"
        : "desc";
    return `${BASE_PATH}?${serializeBedSpaFilters({
      ...filters,
      sort: field,
      direction: next as "asc" | "desc",
    }).toString()}`;
  };

  const comparable = performance.filter(
    (entry) => entry.comparable && entry.versusPeers.deltaPercent !== null,
  );

  return (
    <PermissionGate permission="view_reports">
      <ReportFrame
        report={REPORT}
        action={
          /*
            POINTERS AT THE VIEW, NOT THE VIEW'S NUMBERS. The period token and
            the district, salon and equipment selections are what the server
            needs to re-read exactly these rows; nothing this page computed
            travels with them.
          */
          <AskSunnyAboutReport
            context={{
              family: "spa-wellness",
              period: period ? periodToken(period) : null,
              window: null,
              salons: filters.salons,
              districts: filters.districts,
              metric: filters.sort,
              view: filters.equipment[0] ?? null,
            }}
          />
        }
        /*
          THE FOUR PROVENANCE CHIPS, IN THE BAND. Same stored facts the
          provenance line and coverage banner carried — period, salon count
          against the delivery's own population, recipient slice, and the stored
          ingestion instant — read beside the title where a reader meets them
          before the first figure rather than after it. The full lineage is
          still one click away in the source panel below.
        */
        provenance={<BedSpaProvenanceChips provenance={data.provenance} />}
        filters={
          <BedSpaFilterBar
            base={BASE_PATH}
            filters={filters}
            periods={periods}
            regions={regionValues.map((value) => ({ value, label: value }))}
            districts={districtValues.map((value) => ({ value, label: value }))}
            salons={data.salons
              .filter((salon) => salon.salonNumber !== null)
              .map((salon) => ({
                value: salon.salonNumber!,
                label: salon.storeName,
                note: salon.salonNumber!,
                searchText: salon.salonNumber!,
              }))}
            equipment={data.equipmentTypes.map((type) => ({
              value: type.code,
              label: type.shortLabel,
              note: type.isComparable ? undefined : "Not peer-comparable",
            }))}
            equipmentLabel="Equipment"
            showPerformance
          />
        }
      >
        <PeriodFallbackNotice fellBack={fellBack} period={period} />

        {dropped.length > 0 ? (
          <Notice tone="neutral">
            Some filters this link carried were dropped: {dropped.join("; ")}.
          </Notice>
        ) : null}

        <Notice tone="neutral" title="A zero means the equipment is not installed">
          This source reports a session count only where a piece of spa equipment
          exists and was used. A blank is an absence, not an idle machine, so
          every figure below counts and compares installed equipment only — on
          both sides of a peer comparison.
        </Notice>


        <KpiCardRow
          cards={[
            {
              id: "sessions",
              label: "Total Spa Sessions",
              value: totals.totalSessions === null ? null : formatCount(totals.totalSessions),
              helper: `Across ${formatCount(totals.salonCount)} salons, from the source's own active-beds total.`,
              emphasis: true,
            },
            {
              id: "pieces",
              label: "Active Spa Equipment",
              value: totals.equipmentPieces === null ? null : formatCount(totals.equipmentPieces),
              helper:
                "Installed UNITS. Larger than the number of types wherever a salon has two of something.",
            },
            {
              id: "types",
              label: "Equipment Types",
              value: formatCount(totals.equipmentTypes),
              helper: `Distinct types in use. This delivery listed ${formatCount(data.equipmentTypes.length)} columns in total.`,
            },
            {
              id: "peer-delta",
              label: "vs Peer Average",
              value:
                totals.weightedPeerDeltaPercent === null
                  ? null
                  : formatDelta(totals.weightedPeerDeltaPercent),
              helper:
                totals.comparedTypeCount === 0
                  ? "No equipment in view has a peer average, so there is nothing to compare against."
                  : `Session-weighted across ${formatCount(totals.comparedTypeCount)} comparable types. An unweighted mean would let a two-salon type cancel a fifteen-salon one.`,
              changeLabel:
                totals.weightedPeerDeltaPercent === null
                  ? undefined
                  : `${formatDelta(totals.weightedPeerDeltaPercent)} against installed peers`,
              trend: trendFor(totals.weightedPeerDeltaPercent),
            },
          ]}
        />

        {/* ---------------------------------------------- equipment vs peers --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Each equipment type against the peers who have it"
            description="Our average sessions per installed salon against the average across salons OUTSIDE this company that used the same equipment in the same period. Like-for-like on both sides."
          />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <BedSpaDataTable
              rows={performance}
              rowKey={(entry) => entry.equipmentCode}
              sort={null}
              direction={null}
              sortHref={() => BASE_PATH}
              minWidth={900}
              emptyMessage="No equipment matches the current filters."
              columns={[
                {
                  key: "equipment",
                  label: "Equipment",
                  sortable: false,
                  render: (entry) => (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-foreground">{entry.shortLabel}</span>
                      {entry.comparable ? null : (
                        <Badge
                          tone="outline"
                          size="sm"
                          title="This bucket aggregates equipment that did not map to a named type, so one salon's is not the same machine as another's."
                        >
                          Not comparable
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: "ourSalons",
                  label: "Our salons",
                  hint: "That have it installed",
                  align: "right",
                  sortable: false,
                  render: (entry) => formatCount(entry.ourSalonCount),
                },
                {
                  key: "sessions",
                  label: "Sessions",
                  align: "right",
                  sortable: false,
                  render: (entry) => formatCount(entry.ourSessions),
                },
                {
                  key: "ourAverage",
                  label: "Our average",
                  align: "right",
                  sortable: false,
                  render: (entry) => formatPerBed(entry.ourAverageSessions),
                },
                {
                  key: "peerSalons",
                  label: "Peer salons",
                  align: "right",
                  sortable: false,
                  render: (entry) =>
                    entry.peerSalonCount === 0 ? orDash(null) : formatCount(entry.peerSalonCount),
                },
                {
                  key: "peerAverage",
                  label: "Peer average",
                  align: "right",
                  sortable: false,
                  render: (entry) =>
                    orDash(
                      entry.peerAverageSessions === null
                        ? null
                        : formatPerBed(entry.peerAverageSessions),
                    ),
                },
                {
                  key: "delta",
                  label: "vs Peers",
                  align: "right",
                  sortable: false,
                  render: (entry) => (
                    <DeltaFigure
                      delta={entry.versusPeers.deltaPercent}
                      band={entry.versusPeers.band}
                      reason={entry.versusPeers.unavailableReason}
                    />
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  align: "center",
                  sortable: false,
                  render: (entry) =>
                    entry.versusPeers.band === null ? (
                      <span
                        className="text-[11px] text-muted-foreground"
                        title={entry.versusPeers.unavailableReason ?? undefined}
                      >
                        No comparison
                      </span>
                    ) : (
                      <BandStatusChip band={entry.versusPeers.band} reportable />
                    ),
                },
              ]}
            />
          </div>
        </section>

        {/* ------------------------------------------------------- rankings --- */}
        <section className="grid gap-4 lg:grid-cols-2">
          <ChartFrame
            title="Spa Sessions by salon"
            description="Total sessions across every installed unit, for the selected period."
            height={Math.max(200, salons.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(salonSummaries, (salon) => salon.totalSessions).map((salon) => ({
                key: salon.salonNumber ?? salon.storeName,
                label: salon.storeName,
                value: salon.totalSessions,
                detail: [
                  { label: "Installed units", value: formatCount(salon.equipmentPieces) },
                  { label: "Types in use", value: formatCount(salon.equipmentTypesUsed) },
                  { label: "Per unit", value: formatPerBed(salon.sessionsPerPiece) },
                ],
              }))}
              valueLabel="Spa Sessions"
              format="count"
            />
          </ChartFrame>

          <ChartFrame
            title="Spa Sessions by equipment type"
            description="Only the equipment this selection actually has. There is no bar for a machine a salon does not own."
            height={Math.max(200, performance.length * 28 + 48)}
          >
            <RankedBarChart
              rows={[...performance]
                .sort((a, b) => b.ourSessions - a.ourSessions)
                .map((entry) => ({
                  key: entry.equipmentCode,
                  label: entry.shortLabel,
                  value: entry.ourSessions,
                  detail: [
                    { label: "Salons with it", value: formatCount(entry.ourSalonCount) },
                    { label: "Our average", value: formatPerBed(entry.ourAverageSessions) },
                    {
                      label: "Peer average",
                      value:
                        entry.peerAverageSessions === null
                          ? "No peers"
                          : formatPerBed(entry.peerAverageSessions),
                    },
                  ],
                }))}
              valueLabel="Sessions"
              format="count"
            />
          </ChartFrame>

          <ChartFrame
            title="Ours against the installed peer average"
            description="Per equipment type. Types nobody outside this company uses have no bar, because there is no peer to compare with."
            height={Math.max(200, comparable.length * 30 + 48)}
          >
            <RankedBarChart
              rows={[...comparable]
                .sort(
                  (a, b) => (b.versusPeers.deltaPercent ?? 0) - (a.versusPeers.deltaPercent ?? 0),
                )
                .map((entry) => ({
                  key: entry.equipmentCode,
                  label: entry.shortLabel,
                  value: entry.versusPeers.deltaPercent,
                  band: entry.versusPeers.band,
                  detail: [
                    { label: "Our average", value: formatPerBed(entry.ourAverageSessions) },
                    { label: "Peer average", value: formatPerBed(entry.peerAverageSessions) },
                    {
                      label: "Salons compared",
                      value: `${formatCount(entry.ourSalonCount)} ours · ${formatCount(entry.peerSalonCount)} peers`,
                    },
                  ],
                }))}
              valueLabel="vs Peer Average"
              format="delta"
              emptyMessage="No equipment in view has a peer average for this period."
            />
          </ChartFrame>

          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <h3 className="text-[15px] font-semibold text-foreground">
              Recently deployed equipment
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              First and most recent use, as the source reports them, with an age
              measured to this period&rsquo;s own end rather than to today. No
              ramp allowance is applied — there is no approved definition of
              &ldquo;new&rdquo;, so the dates are shown and the judgement is
              yours.
            </p>
            {midPeriod.length > 0 ? (
              <p className="mt-3 rounded-[var(--radius-sm)] bg-surface-muted px-3 py-2 text-[13px] text-foreground">
                <span className="font-medium">
                  {formatCount(midPeriod.length)}{" "}
                  {midPeriod.length === 1 ? "unit was" : "units were"} first used inside
                  this period.
                </span>{" "}
                Their sessions cover less of the window than their peers&rsquo;.
              </p>
            ) : null}
            <ol className="mt-4 space-y-2">
              {[...detail]
                .filter((row) => row.firstUseDate !== null)
                .sort((a, b) => (b.firstUseDate ?? "").localeCompare(a.firstUseDate ?? ""))
                .slice(0, 8)
                .map((row) => (
                  <li
                    key={`${row.storeName}|${row.equipmentCode}`}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]"
                  >
                    <span className="min-w-0 truncate text-foreground">
                      {row.storeName} · {row.equipmentShortLabel}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                      <span className="tabular-nums">
                        {formatBedSpaDate(row.firstUseDate!)}
                      </span>
                      {row.ageDays === null ? null : (
                        <span className="tabular-nums">{formatCount(row.ageDays)}d</span>
                      )}
                      {row.firstUsedInPeriod ? (
                        <Badge tone="accent" size="sm">
                          In period
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              {detail.every((row) => row.firstUseDate === null) ? (
                <li className="text-[13px] text-muted-foreground">
                  This delivery carried no per-equipment first-use dates.
                </li>
              ) : null}
            </ol>
          </div>
        </section>

        {/* --------------------------------------------------- detail table --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Sessions by salon and equipment"
            description="One row per installed, used unit. Nothing here is a zero standing in for a machine a salon does not have."
          />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <BedSpaDataTable
              rows={sorted}
              rowKey={(row) => `${row.storeName}|${row.equipmentCode}`}
              sort={sortField}
              direction={direction}
              sortHref={sortHref}
              minWidth={1000}
              emptyMessage="No installed equipment matches the current filters."
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
                  key: "equipment",
                  label: "Equipment",
                  render: (row) => (
                    <span className="flex items-center gap-1.5">
                      {row.equipmentShortLabel}
                      {row.firstUsedInPeriod ? (
                        <Badge
                          tone="accent"
                          size="sm"
                          title="First used inside this reporting period, so its sessions cover less of the window than its peers'."
                        >
                          In period
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "sessions",
                  label: "Sessions",
                  align: "right",
                  render: (row) => formatCount(row.sessions),
                },
                {
                  key: "peer",
                  label: "Peer average",
                  hint: "Installed peers only",
                  align: "right",
                  render: (row) =>
                    orDash(row.peerAverage === null ? null : formatPerBed(row.peerAverage)),
                },
                {
                  key: "delta",
                  label: "vs Peers",
                  align: "right",
                  render: (row) => (
                    <DeltaFigure
                      delta={row.delta}
                      band={row.band}
                      /* Same gate the Status cell below uses, so the figure and
                         the badge cannot disagree about this row. */
                      reportable={row.comparable && row.peerAverage !== null}
                    />
                  ),
                },
                {
                  key: "firstUse",
                  label: "First use",
                  align: "right",
                  render: (row) =>
                    orDash(row.firstUseDate === null ? null : formatBedSpaDate(row.firstUseDate)),
                },
                {
                  key: "lastUse",
                  label: "Most recent use",
                  align: "right",
                  render: (row) =>
                    orDash(row.lastUseDate === null ? null : formatBedSpaDate(row.lastUseDate)),
                },
                {
                  key: "status",
                  label: "Status",
                  align: "center",
                  sortable: false,
                  render: (row) =>
                    row.comparable && row.peerAverage !== null ? (
                      <BandStatusChip band={row.band} reportable />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No comparison</span>
                    ),
                },
              ]}
              /*
               * SESSIONS SUM ACROSS ROWS and nothing else here does: a peer
               * average is an average, a delta cannot be combined, and a date
               * has no total.
               */
              footer={{
                salon: `${formatCount(sorted.length)} installed units`,
                sessions: formatCount(sorted.reduce((total, row) => total + row.sessions, 0)),
              }}
            />
          </div>
        </section>

        <SourcePanel
          provenance={data.provenance}
          extra={[
            { label: "Window", value: data.windowCode.toUpperCase() },
            {
              label: "Equipment columns in the delivery",
              value: formatCount(data.equipmentTypes.length),
            },
            {
              label: "Equipment cells recorded as not installed",
              value:
                data.notInstalledCells === null
                  ? "Not recorded"
                  : `${formatCount(data.notInstalledCells)} — blank or zero, so no fact was written`,
            },
            {
              label: "Types with a peer average",
              value: `${formatCount(comparable.length)} of ${formatCount(performance.length)} in view`,
            },
          ]}
        />
      </ReportFrame>
    </PermissionGate>
  );
}
