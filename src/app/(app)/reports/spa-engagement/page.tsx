import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { requirePagePermission } from "@/lib/auth/page";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import { SUPABASE_URL_ENV, supabaseSecretKeyConfigured } from "@/lib/config/server-env";
import { SPA_ENGAGEMENT_MEASURES_BY_CODE } from "@/lib/reporting/spa-engagement/metric-map";
import { rankSalons, summarizeSalons } from "@/lib/reporting/read/bed-spa/bed-usage-analytics";
import {
  buildCombinedView,
  SALON_STATUS_TEXT,
  worstPeerBandBySalon,
} from "@/lib/reporting/read/bed-spa/combined";
import {
  engagementTotals,
  summarizeEngagement,
  UNIQUE_TANNER_SUM_NOTE,
} from "@/lib/reporting/read/bed-spa/spa-engagement-analytics";
import {
  equipmentPerformance,
  firstUsedWithinPeriod,
  summarizeSpaSalons,
} from "@/lib/reporting/read/bed-spa/spa-wellness-analytics";
import {
  newestSharedPeriod,
  periodToken,
  resolvePeriod,
} from "@/lib/reporting/read/bed-spa/period-token";
import {
  listBedUsagePeriods,
  listSpaEngagementPeriods,
  listSpaWellnessPeriods,
  loadBedUsage,
  loadSpaEngagement,
  loadSpaWellness,
} from "@/lib/reporting/read/bed-spa/read";
import { ReportFrame } from "@/features/reports/report-frame";
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
  bandLabel,
  bandTone,
  formatCount,
  formatRank,
  formatRate,
  formatRatio,
  formatSmallRatio,
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
 * SPA ENGAGEMENT — and the combined operational view
 * ============================================================================
 *
 * THE PAGE IS BUILT AROUND KEEPING TWO METRICS APART:
 *
 *   Spa Per Unique %                            sessions / unique tanners
 *   Spa Sessions per Unique Tanner per Spa Bed  sessions / unique / beds
 *
 * The first is the store-execution measure; the second is the workbook's own
 * bed-normalized productivity figure and what the file is named after. For a
 * four-bed salon they differ by a factor of four. They have separate cards,
 * separate charts, separate columns and their formulas printed beside them,
 * because a shared label would change an approved business definition.
 *
 * THE RANKS ARE THE SOURCE'S OWN, OVER THE WHOLE CHAIN. "Rank 7 of 248" is
 * what a manager is measured on, so it is shown with its population rather than
 * recomputed over the fifteen salons in view — which would produce a flattering
 * 1-to-15 that means nothing.
 *
 * THE COMBINED VIEW joins this report's engagement figures with Bed Usage
 * traffic and SPA Wellness sessions, and it REFUSES rather than guessing. Spa
 * Conversion Rate needs the same period on both sides; in the supplied material
 * the Bed Usage report covers August and this report covers 1 September, so the
 * refusal is the live case and the banner says which periods are loaded. That is
 * DECISION SUPPORT: it classifies a salon into a plainly-named reading and
 * stops there. Nothing here computes an expansion recommendation or a capital
 * score.
 */

export const metadata: Metadata = { title: "Spa Engagement" };

export const dynamic = "force-dynamic";

const BASE_PATH = "/reports/spa-engagement";
const REPORT = REPORTS.find((report) => report.key === "spa-engagement")!;

const SORT_FIELDS = [
  "salon",
  "sessions",
  "unique",
  "spaUnique",
  "beds",
  "perUnique",
  "perBed",
  "perUniquePerBed",
  "uniquePct",
  "rank",
] as const;

export default async function SpaEngagementPage({
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
  const periods = await listSpaEngagementPeriods();

  if (periods.length === 0) {
    return (
      <ReportFrame report={REPORT}>
        <EmptyState
          title="No Spa Engagement report has been ingested yet"
          description="This report ranks every salon in the chain on how much of its tanning customer base uses spa services. Once a delivery has been ingested, its figures and the ranks it published appear here."
        />
      </ReportFrame>
    );
  }

  const { period, fellBack } = resolvePeriod(
    typeof search.period === "string" ? search.period : null,
    periods,
  );
  const data = period ? await loadSpaEngagement(period.periodId) : null;

  if (!period || !data) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="This reporting period has no figures">
          The period exists but reported no salon rows. Try another period.
        </Notice>
      </ReportFrame>
    );
  }

  /*
   * THE COMBINED VIEW RESOLVES ITS OWN PERIOD, and this is the decision that
   * makes the section useful rather than permanently empty.
   *
   * Spa Conversion Rate needs Bed Usage traffic and SPA Wellness sessions over
   * the SAME window, and the three reports arrive on their own schedules — in
   * the supplied deliveries this one covers a single day in September while the
   * other two cover August. Keyed to this tab's period the conversion column
   * would be N/A forever, correctly and uselessly.
   *
   * So it takes the newest window BOTH halves of the metric cover, says which
   * one that is, and fills the engagement columns only where this report
   * covers it too. The refusal is still there — it just applies to the join
   * that is genuinely impossible rather than to the whole section.
   */
  const [bedPeriods, spaPeriods] = await Promise.all([
    listBedUsagePeriods(),
    listSpaWellnessPeriods(),
  ]);
  const shared = newestSharedPeriod(bedPeriods, spaPeriods);
  const [bedData, spaData] = await Promise.all([
    shared ? loadBedUsage(shared.left.periodId) : Promise.resolve(null),
    shared ? loadSpaWellness(shared.right.periodId) : Promise.resolve(null),
  ]);
  /**
   * Whether this report's own period is the one the combined view is using.
   *
   * When it is not, the engagement columns describe a different window from
   * the traffic and sessions beside them — so they are withheld rather than
   * placed on the same row, which would read as one period's figures.
   */
  const engagementCoversShared =
    shared !== null &&
    shared.left.grain === data.period.grain &&
    shared.left.periodStart === data.period.periodStart &&
    shared.left.periodEnd === data.period.periodEnd;

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

  const { filters, dropped } = parseBedSpaFilters(search, {
    periods: periods.map(periodToken),
    districts: districtValues,
    regions: regionValues,
    salons: salonValues,
    sortFields: SORT_FIELDS,
  });

  /*
   * THE SHARED PREDICATE. This was a local copy in each of the three
   * pages — the same three conditions written out three times, which is
   * three places for the district filter to drift and no single place to
   * test it. See `admitsSalon` in `filter-state.ts`.
   */
  const admits = (salon: SalonFacets) => admitsSalon(filters, salon);

  // ---------------------------------------------------------------- analysis ---
  const summaries = summarizeEngagement(data.salons.filter(admits));
  const totals = engagementTotals(summaries);
  const admittedNumbers = new Set(
    summaries.map((salon) => salon.salonNumber).filter((value): value is string => value !== null),
  );

  /*
   * THE WORST PEER BAND PER SALON, from the equipment comparison. The worst
   * rather than an average: a single unit far below its peers is the finding,
   * and averaging it against three healthy ones hides what the comparison is
   * for.
   */
  const peerBandBySalon = spaData
    ? worstPeerBandBySalon(
        equipmentPerformance(
          spaData.equipmentTypes,
          spaData.equipmentUse,
          spaData.benchmarks,
        ).flatMap((entry) =>
          spaData.equipmentUse
            .filter((use) => use.equipmentCode === entry.equipmentCode)
            .map((use) => ({
              storeName: use.storeName,
              band: entry.versusPeers.band,
              reportableFinding: entry.versusPeers.reportableFinding,
            })),
        ),
      )
    : {};

  const combined = buildCombinedView({
    bedUsage: bedData
      ? summarizeSalons(bedData.salons, bedData.equipment).filter(
          (salon) => admittedNumbers.size === 0 || (salon.salonNumber !== null && admittedNumbers.has(salon.salonNumber)),
        )
      : [],
    bedUsagePeriod: bedData?.period ?? null,
    spaWellness: spaData
      ? summarizeSpaSalons(spaData.salons, spaData.equipmentUse).filter(
          (salon) => admittedNumbers.size === 0 || (salon.salonNumber !== null && admittedNumbers.has(salon.salonNumber)),
        )
      : [],
    spaWellnessPeriod: spaData?.period ?? null,
    // Withheld when this report covers a different window from the traffic —
    // see `engagementCoversShared`.
    spaEngagement: engagementCoversShared ? summaries : [],
    spaEngagementPeriod: engagementCoversShared ? data.period : null,
    peerBandBySalon,
    partialPeriodSalons: spaData
      ? [
          ...new Set(
            firstUsedWithinPeriod(spaData.equipmentUse, spaData.period).map(
              (row) => row.storeName,
            ),
          ),
        ]
      : [],
  });

  const sortField = filters.sort ?? "rank";
  const direction = filters.direction ?? (sortField === "salon" || sortField === "rank" ? "asc" : "desc");
  const sorted = [...summaries].sort((a, b) => {
    const compare = (() => {
      switch (sortField) {
        case "salon":
          return a.storeName.localeCompare(b.storeName);
        case "sessions":
          return (a.spaSessions ?? -1) - (b.spaSessions ?? -1);
        case "unique":
          return (a.totalUniqueTanners ?? -1) - (b.totalUniqueTanners ?? -1);
        case "spaUnique":
          return (a.uniqueSpaTanners ?? -1) - (b.uniqueSpaTanners ?? -1);
        case "beds":
          return (a.spaBeds ?? -1) - (b.spaBeds ?? -1);
        case "perUnique":
          return (a.spaPerUniquePercent ?? -1) - (b.spaPerUniquePercent ?? -1);
        case "perBed":
          return (a.spaSessionsPerBed ?? -1) - (b.spaSessionsPerBed ?? -1);
        case "perUniquePerBed":
          return (a.spaSessionsPerUniquePerBed ?? -1) - (b.spaSessionsPerUniquePerBed ?? -1);
        case "uniquePct":
          return (a.uniqueSpaTannerPercent ?? -1) - (b.uniqueSpaTannerPercent ?? -1);
        default:
          // An unranked salon sorts last in either direction: rank 1 is best,
          // so a missing rank must not read as the best.
          return (a.overallRank ?? Number.MAX_SAFE_INTEGER) - (b.overallRank ?? Number.MAX_SAFE_INTEGER);
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
      : field === "salon" || field === "rank"
        ? "asc"
        : "desc";
    return `${BASE_PATH}?${serializeBedSpaFilters({
      ...filters,
      sort: field,
      direction: next as "asc" | "desc",
    }).toString()}`;
  };

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
          salons={data.salons
            .filter((salon) => salon.salonNumber !== null)
            .map((salon) => ({
              value: salon.salonNumber!,
              label: salon.storeName,
              note: salon.salonNumber!,
              searchText: salon.salonNumber!,
            }))}
        />

        <KpiCardRow
          cards={[
            {
              id: "sessions",
              label: "Spa Sessions",
              value: totals.spaSessions === null ? null : formatCount(totals.spaSessions),
              helper: `Across ${formatCount(totals.salonCount)} salons for this period.`,
              emphasis: true,
            },
            {
              id: "unique",
              label: "Total Unique Tanners",
              value:
                totals.totalUniqueTanners === null ? null : formatCount(totals.totalUniqueTanners),
              helper: UNIQUE_TANNER_SUM_NOTE,
            },
            {
              id: "spa-unique",
              label: "Unique Spa Tanners",
              value:
                totals.uniqueSpaTanners === null ? null : formatCount(totals.uniqueSpaTanners),
              helper: "Distinct customers who took at least one spa session.",
            },
            {
              id: "beds",
              label: "Spa Beds",
              value: totals.spaBeds === null ? null : formatCount(totals.spaBeds),
              helper: "Installed spa units across the salons in view.",
            },
            {
              id: "per-unique",
              label: "Spa Per Unique %",
              value: formatRate(totals.spaPerUniquePercent),
              /*
               * THE FORMULA IS ON THE CARD. Two metrics on this page have
               * similar names and different meanings, and the formula is the
               * shortest way to say which one a reader is looking at.
               */
              helper: `${SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_per_unique_pct.formula} — recomputed from the sums, not averaged across salons.`,
            },
            {
              id: "unique-pct",
              label: "Unique Spa Tanner %",
              value: formatRate(totals.uniqueSpaTannerPercent),
              helper: `${SPA_ENGAGEMENT_MEASURES_BY_CODE.unique_spa_tanner_pct.formula} — reach, where Spa Per Unique % is frequency.`,
            },
            {
              id: "per-bed",
              label: "Spa Sessions per Bed",
              value: formatRatio(totals.spaSessionsPerBed),
              helper: SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_sessions_per_bed.formula,
            },
            {
              id: "per-unique-per-bed",
              label: "Sessions per Unique per Bed",
              value: formatSmallRatio(totals.spaSessionsPerUniquePerBed),
              helper: `${SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_sessions_per_unique_per_bed.formula} — the workbook's bed-normalized figure. NOT Spa Per Unique %.`,
            },
          ]}
        />

        <Notice tone="neutral" title="Two measures that look alike and are not">
          <span className="font-medium">Spa Per Unique %</span> is{" "}
          {SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_per_unique_pct.formula.toLowerCase()} — how
          often the tanning customer base uses spa services.{" "}
          <span className="font-medium">Spa Sessions per Unique Tanner per Spa Bed</span> divides
          that again by the bed count, so it measures how hard each installed bed
          works per customer. A store that adds a bed can see the second fall
          while the first rises. They are shown separately throughout.
        </Notice>

        {/* ------------------------------------------------------- rankings --- */}
        <section className="grid gap-4 lg:grid-cols-2">
          <ChartFrame
            title="Spa Per Unique % by salon"
            description={`${SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_per_unique_pct.formula}. Store execution, not adjusted for bed count.`}
            height={Math.max(200, summaries.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(summaries, (salon) => salon.spaPerUniquePercent).map((salon) => ({
                key: salon.salonNumber ?? salon.storeName,
                label: salon.storeName,
                value: salon.spaPerUniquePercent,
                detail: [
                  { label: "Spa sessions", value: formatCount(salon.spaSessions) },
                  { label: "Unique tanners", value: formatCount(salon.totalUniqueTanners) },
                  { label: "Spa beds", value: formatCount(salon.spaBeds) },
                ],
              }))}
              valueLabel="Spa Per Unique %"
              format="rate"
              reference={
                totals.spaPerUniquePercent === null
                  ? null
                  : {
                      value: totals.spaPerUniquePercent,
                      label: `Estate ${formatRate(totals.spaPerUniquePercent)}`,
                    }
              }
            />
          </ChartFrame>

          <ChartFrame
            title="Spa Sessions per Bed by salon"
            description={`${SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_sessions_per_bed.formula}. Raw throughput per installed unit.`}
            height={Math.max(200, summaries.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(summaries, (salon) => salon.spaSessionsPerBed).map((salon) => ({
                key: salon.salonNumber ?? salon.storeName,
                label: salon.storeName,
                value: salon.spaSessionsPerBed,
                detail: [
                  { label: "Spa sessions", value: formatCount(salon.spaSessions) },
                  { label: "Spa beds", value: formatCount(salon.spaBeds) },
                ],
              }))}
              valueLabel="Sessions per Bed"
              format="ratio"
              reference={
                totals.spaSessionsPerBed === null
                  ? null
                  : {
                      value: totals.spaSessionsPerBed,
                      label: `Estate ${formatRatio(totals.spaSessionsPerBed)}`,
                    }
              }
            />
          </ChartFrame>

          <ChartFrame
            title="Spa Sessions per Unique Tanner per Spa Bed"
            description={`${SPA_ENGAGEMENT_MEASURES_BY_CODE.spa_sessions_per_unique_per_bed.formula}. The workbook's own title measure — bed-normalized, and NOT Spa Per Unique %.`}
            height={Math.max(200, summaries.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(summaries, (salon) => salon.spaSessionsPerUniquePerBed).map(
                (salon) => ({
                  key: salon.salonNumber ?? salon.storeName,
                  label: salon.storeName,
                  value: salon.spaSessionsPerUniquePerBed,
                  detail: [
                    { label: "Spa Per Unique %", value: formatRate(salon.spaPerUniquePercent) },
                    { label: "Spa beds", value: formatCount(salon.spaBeds) },
                    {
                      label: "Chain rank",
                      value: formatRank(
                        salon.ranks.rank_spa_sessions_per_unique_per_bed ?? null,
                        data.rankPopulation,
                      ),
                    },
                  ],
                }),
              )}
              valueLabel="Sessions per Unique per Bed"
              format="smallRatio"
            />
          </ChartFrame>

          <ChartFrame
            title="Unique Spa Tanner % by salon"
            description={`${SPA_ENGAGEMENT_MEASURES_BY_CODE.unique_spa_tanner_pct.formula}. What share of the customer base touched spa at all.`}
            height={Math.max(200, summaries.length * 28 + 48)}
          >
            <RankedBarChart
              rows={rankSalons(summaries, (salon) => salon.uniqueSpaTannerPercent).map((salon) => ({
                key: salon.salonNumber ?? salon.storeName,
                label: salon.storeName,
                value: salon.uniqueSpaTannerPercent,
                detail: [
                  { label: "Unique spa tanners", value: formatCount(salon.uniqueSpaTanners) },
                  { label: "Unique tanners", value: formatCount(salon.totalUniqueTanners) },
                ],
              }))}
              valueLabel="Unique Spa Tanner %"
              format="rate"
              reference={
                totals.uniqueSpaTannerPercent === null
                  ? null
                  : {
                      value: totals.uniqueSpaTannerPercent,
                      label: `Estate ${formatRate(totals.uniqueSpaTannerPercent)}`,
                    }
              }
            />
          </ChartFrame>
        </section>

        {/* ---------------------------------------------- the workbook's rank --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Overall Rank, as the source published it"
            description={
              data.rankPopulation
                ? `Each salon's position among all ${formatCount(data.rankPopulation)} salons in the chain. Reproduced from the report's own weights, not recomputed over the salons in view.`
                : "Each salon's position as the report published it."
            }
          />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <p className="mb-4 text-[13px] text-muted-foreground">
              The source weights three ranked measures and ranks the weighted
              score:{" "}
              {Object.entries(data.rankWeights).length === 0
                ? "this delivery carried no weights."
                : Object.entries(data.rankWeights)
                    .map(
                      ([code, weight]) =>
                        `${
                          SPA_ENGAGEMENT_MEASURES_BY_CODE[
                            code.replace(/^rank_/, "")
                          ]?.label ?? code
                        } × ${weight}`,
                    )
                    .join(", ")}
            </p>
            <RankedBarChart
              rows={rankSalons(summaries, (salon) =>
                // Inverted so a better rank draws a longer bar: rank 1 is best,
                // and a chart where the best performer has the shortest bar
                // reads backwards.
                salon.overallRank === null || !data.rankPopulation
                  ? null
                  : data.rankPopulation - salon.overallRank + 1,
              ).map((salon) => ({
                key: salon.salonNumber ?? salon.storeName,
                label: salon.storeName,
                value:
                  salon.overallRank === null || !data.rankPopulation
                    ? null
                    : data.rankPopulation - salon.overallRank + 1,
                detail: [
                  {
                    label: "Overall rank",
                    value: formatRank(salon.overallRank, data.rankPopulation),
                  },
                  { label: "Spa Per Unique %", value: formatRate(salon.spaPerUniquePercent) },
                  {
                    label: "Unique Spa Tanner %",
                    value: formatRate(salon.uniqueSpaTannerPercent),
                  },
                ],
              }))}
              valueLabel="Better than"
              format="rankOf"
              rankPopulation={data.rankPopulation}
              emptyMessage="This delivery published no Overall Rank."
            />
          </div>
        </section>

        {/* ------------------------------------------------- engagement table --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Engagement detail"
            description="The four raw counts and the four derived figures, side by side and separately named."
          />
          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <BedSpaDataTable
              rows={sorted}
              rowKey={(salon) => salon.salonNumber ?? salon.storeName}
              sort={sortField}
              direction={direction}
              sortHref={sortHref}
              minWidth={1100}
              columns={[
                {
                  key: "salon",
                  label: "Salon",
                  render: (salon) => (
                    <span className="whitespace-nowrap">
                      <span className="text-foreground">{salon.storeName}</span>
                      {salon.salonNumber ? (
                        <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                          {salon.salonNumber}
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "sessions",
                  label: "Spa Sessions",
                  align: "right",
                  render: (salon) => orDash(formatCount(salon.spaSessions)),
                },
                {
                  key: "unique",
                  label: "Unique Tanners",
                  align: "right",
                  render: (salon) => orDash(formatCount(salon.totalUniqueTanners)),
                },
                {
                  key: "spaUnique",
                  label: "Unique Spa Tanners",
                  align: "right",
                  render: (salon) => orDash(formatCount(salon.uniqueSpaTanners)),
                },
                {
                  key: "beds",
                  label: "Spa Beds",
                  align: "right",
                  render: (salon) => orDash(formatCount(salon.spaBeds)),
                },
                {
                  key: "perUnique",
                  label: "Spa Per Unique %",
                  hint: "Sessions ÷ unique",
                  align: "right",
                  render: (salon) => formatRate(salon.spaPerUniquePercent),
                },
                {
                  key: "perBed",
                  label: "Sessions per Bed",
                  hint: "Sessions ÷ beds",
                  align: "right",
                  render: (salon) => orDash(formatRatio(salon.spaSessionsPerBed)),
                },
                {
                  key: "perUniquePerBed",
                  label: "Per Unique per Bed",
                  hint: "Sessions ÷ unique ÷ beds",
                  align: "right",
                  render: (salon) => orDash(formatSmallRatio(salon.spaSessionsPerUniquePerBed)),
                },
                {
                  key: "uniquePct",
                  label: "Unique Spa Tanner %",
                  hint: "Spa unique ÷ unique",
                  align: "right",
                  render: (salon) => formatRate(salon.uniqueSpaTannerPercent),
                },
                {
                  key: "rank",
                  label: "Overall Rank",
                  hint: data.rankPopulation ? `of ${formatCount(data.rankPopulation)}` : undefined,
                  align: "right",
                  render: (salon) => orDash(formatRank(salon.overallRank, data.rankPopulation)),
                },
              ]}
              /*
               * THE COUNTS SUM AND THE RATIOS ARE RECOMPUTED FROM THOSE SUMS.
               * A rank has no total, so its footer cell is left blank rather
               * than averaged into a number that means nothing.
               */
              footer={{
                salon: `${formatCount(sorted.length)} salons`,
                sessions: formatCount(totals.spaSessions),
                unique: formatCount(totals.totalUniqueTanners),
                spaUnique: formatCount(totals.uniqueSpaTanners),
                beds: formatCount(totals.spaBeds),
                perUnique: formatRate(totals.spaPerUniquePercent),
                perBed: formatRatio(totals.spaSessionsPerBed),
                perUniquePerBed: formatSmallRatio(totals.spaSessionsPerUniquePerBed),
                uniquePct: formatRate(totals.uniqueSpaTannerPercent),
              }}
            />
          </div>
        </section>

        {/* ------------------------------------------------- combined view --- */}
        <section className="space-y-3">
          <SectionHeader
            title="Combined operational view"
            description="Tanning traffic, spa sessions and spa engagement on one row per salon, with Spa Conversion Rate where the periods allow it."
          />

          {shared !== null ? (
            <Notice tone="neutral" title={`Combined over ${shared.left.label}`}>
              The most recent window both halves of Spa Conversion Rate cover.
              {engagementCoversShared
                ? " This report covers it too, so the engagement columns are for the same window."
                : ` This report covers ${period.label}, a different window, so its engagement columns are withheld rather than placed beside another period's figures.`}
            </Notice>
          ) : null}

          {combined.conversionAvailable ? null : (
            <Notice tone="attention" title="Spa Conversion Rate is not available">
              Spa Conversion Rate is spa sessions divided by Total Tans over the
              same window.{" "}
              {shared === null
                ? "No period is loaded for both the Bed Usage and the SPA Wellness report, so there is nothing to divide. Ingest a matching pair and this column will populate."
                : combined.periodMismatchNote}
            </Notice>
          )}

          {/*
            LISTED ONLY WHEN THE MATCHING PERIODS ARE ACTUALLY LOADED. With no
            matching Bed Usage period every salon is "missing from Bed Usage",
            which is true and useless: it names fifteen salons for one
            period-level cause the notice above has already explained, and it
            implies a per-salon data problem that does not exist.
          */}
          {shared !== null &&
          (combined.unjoined.missingFromBedUsage.length > 0 ||
            combined.unjoined.missingFromSpaWellness.length > 0) ? (
            <Notice tone="neutral" title="Some salons appear in one report and not another">
              {combined.unjoined.missingFromBedUsage.length > 0 ? (
                <>
                  No Bed Usage row:{" "}
                  {combined.unjoined.missingFromBedUsage.join(", ")}.{" "}
                </>
              ) : null}
              {combined.unjoined.missingFromSpaWellness.length > 0 ? (
                <>No SPA Wellness row: {combined.unjoined.missingFromSpaWellness.join(", ")}.</>
              ) : null}{" "}
              Their rows are kept with the figures that did load, rather than
              being dropped.
            </Notice>
          ) : null}

          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
            <BedSpaDataTable
              rows={[...combined.rows].sort((a, b) => {
                // Conversion descending, with unavailable rows last so a
                // refusal does not read as the worst converter.
                const left = a.conversion.available ? a.conversion.rate : -1;
                const right = b.conversion.available ? b.conversion.rate : -1;
                return right - left;
              })}
              rowKey={(row) => row.salonNumber ?? row.storeName}
              sort={null}
              direction={null}
              sortHref={() => BASE_PATH}
              minWidth={1160}
              emptyMessage="No salon joined across the loaded reports."
              columns={[
                {
                  key: "salon",
                  label: "Salon",
                  sortable: false,
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
                  key: "tans",
                  label: "Total Tans",
                  align: "right",
                  sortable: false,
                  render: (row) => orDash(formatCount(row.totalTans)),
                },
                {
                  key: "sessions",
                  label: "Spa Sessions",
                  align: "right",
                  sortable: false,
                  render: (row) => orDash(formatCount(row.spaSessions)),
                },
                {
                  key: "conversion",
                  label: "Spa Conversion",
                  hint: "Sessions ÷ Total Tans",
                  align: "right",
                  sortable: false,
                  render: (row) =>
                    row.conversion.available ? (
                      <span className="font-medium text-foreground">
                        {formatRate(row.conversion.rate)}
                      </span>
                    ) : (
                      /*
                       * `N/A` PLUS THE REASON, never a blank and never a zero.
                       * A blank reads as "nobody has looked"; a zero reads as
                       * "this salon converts nothing", which is a finding
                       * somebody would act on.
                       */
                      <span
                        className="cursor-help text-muted-foreground underline decoration-dotted"
                        title={row.conversion.reasonText}
                      >
                        N/A
                      </span>
                    ),
                },
                {
                  key: "equipment",
                  label: "Spa Equipment",
                  align: "right",
                  sortable: false,
                  render: (row) => orDash(formatCount(row.spaEquipmentPieces)),
                },
                {
                  key: "peer",
                  label: "Peer Performance",
                  hint: "Weakest installed unit",
                  align: "center",
                  sortable: false,
                  render: (row) =>
                    row.peerPerformance === null ? (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    ) : (
                      <Badge tone={bandTone(row.peerPerformance)} size="sm">
                        {bandLabel(row.peerPerformance)}
                      </Badge>
                    ),
                },
                {
                  key: "perBedUsage",
                  label: "Per Bed Usage",
                  hint: "Tanning beds",
                  align: "right",
                  sortable: false,
                  render: (row) => orDash(formatRatio(row.perBedUsage)),
                },
                {
                  key: "perUnique",
                  label: "Spa Per Unique %",
                  align: "right",
                  sortable: false,
                  render: (row) => formatRate(row.spaPerUniquePercent),
                },
                {
                  key: "uniquePct",
                  label: "Unique Spa Tanner %",
                  align: "right",
                  sortable: false,
                  render: (row) => formatRate(row.uniqueSpaTannerPercent),
                },
                {
                  key: "status",
                  label: "Status",
                  sortable: false,
                  render: (row) => (
                    <span
                      className="cursor-help text-[12px] text-foreground underline decoration-dotted"
                      title={SALON_STATUS_TEXT[row.status].note}
                    >
                      {SALON_STATUS_TEXT[row.status].label}
                    </span>
                  ),
                },
              ]}
              footer={{
                salon: `${formatCount(combined.rows.length)} salons`,
                tans: formatCount(combined.totals.totalTans),
                sessions: formatCount(combined.totals.spaSessions),
                conversion: combined.totals.conversion.available
                  ? formatRate(combined.totals.conversion.rate)
                  : "N/A",
                perBedUsage: formatRatio(combined.totals.perBedUsage),
              }}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Status is a reading of what the reports say, not a recommendation.
              Nothing here computes an expansion threshold or a capital score —
              those are decisions the approved rules describe in words and
              deliberately do not quantify.
            </p>
          </div>
        </section>

        <SourcePanel
          provenance={data.provenance}
          extra={[
            {
              label: "Ranking population",
              value:
                data.rankPopulation === null
                  ? "Not recorded"
                  : `${formatCount(data.rankPopulation)} salons chain-wide`,
            },
            {
              label: "Ranking weights",
              value:
                Object.entries(data.rankWeights).length === 0
                  ? "Not carried by this delivery"
                  : Object.entries(data.rankWeights)
                      .map(([code, weight]) => `${code} ${weight}`)
                      .join(", "),
            },
            {
              label: "Period the combined view is over",
              value: shared
                ? shared.left.label
                : "No period is loaded for both Bed Usage and SPA Wellness",
            },
            {
              label: "This report's engagement columns apply to it",
              value: engagementCoversShared
                ? "Yes"
                : `No — this report covers ${period.label}, so they are withheld`,
            },
          ]}
        />
      </ReportFrame>
    </PermissionGate>
  );
}
