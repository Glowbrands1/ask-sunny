import Link from "next/link";

import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { SectionRule } from "@/components/ui/marquee";
import { cn } from "@/lib/utils/cn";
import { ROLES } from "@/lib/permissions";
import { bucketFor, serializeFilters, type AnalyticsFilters } from "@/lib/analytics/filters";
import type { AnalyticsSnapshot } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/utils/format";
import { AdoptionGapPanel } from "./adoption-gap";
import { AnalyticsFilterBar } from "./filter-bar";
import { AnalyticsKpiRow } from "./kpi-row";
import { UsageByRoleChart, UsageTrendChart } from "./charts";
import { LeadersTable, LocationsTable } from "./tables";
import { FeatureUsagePanel, UsageTypesPanel } from "./usage-types";

export const ANALYTICS_BASE = "/admin/analytics";

export const ANALYTICS_VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "locations", label: "By Location" },
  { key: "leaders", label: "By Leader" },
  { key: "types", label: "Usage Types" },
] as const;

export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number]["key"];

export function isAnalyticsView(value: unknown): value is AnalyticsView {
  return ANALYTICS_VIEWS.some((view) => view.key === value);
}

/**
 * ADOPTION ANALYTICS.
 *
 * FOUR VIEWS RATHER THAN ONE LONG PAGE, which is the structural decision this
 * screen is built around. The dashboard it was specified against is a single
 * continuous column — KPIs, trend, day-of-week, answer rate, topic table,
 * repeated questions, leaders, request types, feedback, extraction accuracy —
 * and reading it means scrolling past nine panels to reach the tenth. Overview
 * answers the five questions management opens with; the depth lives behind three
 * tabs that carry the same filters.
 *
 * SERVER-RENDERED. Every aggregate is computed in Postgres and arrives as a
 * handful of small rows, so no event data reaches the browser and the page does
 * not get slower as the history grows.
 */
export function AnalyticsScreen({
  view,
  filters,
  snapshot,
  previousCategories,
}: {
  view: AnalyticsView;
  filters: AnalyticsFilters;
  snapshot: AnalyticsSnapshot;
  previousCategories: AnalyticsSnapshot["byCategory"];
}) {
  const { totals, previous, window } = snapshot;

  const inactiveLocations = snapshot.locations.filter((row) => row.events === 0);
  const inactiveLeaders = snapshot.leaders.filter((row) => row.events === 0);

  /*
   * PageShell sets the page gutters and nothing else — vertical rhythm is the
   * screen's own job. Without it every panel butted against the one above and
   * the section headings read as captions on the wrong block.
   */
  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Who is using Ask Sunny, from which salon, how often, and what for."
      />

      <div className="space-y-4">
        <AnalyticsFilterBar
          base={`${ANALYTICS_BASE}${view === "overview" ? "" : `/${view}`}`}
          filters={filters}
          districts={snapshot.districts}
          salons={snapshot.salons}
          roles={[...ROLES]}
        />

        <ViewTabs view={view} filters={filters} />
      </div>

      {/*
        THE ONE THING THIS PAGE MUST SAY ABOUT ITSELF.

        Chat was never recorded before this release — `/api/chat` answered and
        forgot — so the assistant half of these figures begins at zero on the day
        it shipped and fills from there, while forms, documents and report
        ingestions carry their real history because those rows already existed.
        Without this line a reader would take a low "Questions" column as low
        adoption rather than as a young measurement, which is the opposite
        conclusion. It is shown until there is a window's worth of chat to
        report and then it stops being true.
      */}
      {totals.chatEvents === 0 ? (
        <Notice tone="neutral" title="Assistant activity starts from this release">
          Forms, documents and report ingestions are counted from their own
          records and show real history. Questions asked in Ask Sunny were not
          recorded anywhere before now, so that column fills from the day this
          shipped rather than being backfilled.
        </Notice>
      ) : null}

      {view === "overview" ? (
        <>
          <AnalyticsKpiRow
            totals={totals}
            previous={previous}
            periodLabel={window.label}
          />

          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <UsageTrendChart
              points={snapshot.trend}
              bucket={bucketFor(window.days)}
            />
            <UsageByRoleChart rows={snapshot.byRole} />
          </div>

          {/*
            THE ADOPTION GAP, ABOVE THE RANKINGS.

            "Which salons have not started" is more actionable than "which are
            busiest", so it is stated as a sentence before either table rather
            than left to be inferred from rows of zeros further down.
          */}
          <AdoptionGap
            inactiveLocations={inactiveLocations.length}
            totalLocations={snapshot.locations.length}
            inactiveLeaders={inactiveLeaders.length}
            totalLeaders={snapshot.leaders.length}
            filters={filters}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="space-y-3">
              <SectionHeader
                title="Most active locations"
                actions={
                  <TabLink view="locations" filters={filters}>
                    View all
                  </TabLink>
                }
              />
              <LocationsTable
                rows={snapshot.locations}
                filters={filters}
                base={`${ANALYTICS_BASE}/locations`}
                limit={6}
                compact
              />
            </section>

            <section className="space-y-3">
              <SectionHeader
                title="Most active leaders"
                actions={
                  <TabLink view="leaders" filters={filters}>
                    View all
                  </TabLink>
                }
              />
              <LeadersTable
                rows={snapshot.leaders}
                filters={filters}
                base={`${ANALYTICS_BASE}/leaders`}
                limit={6}
                compact
              />
            </section>
          </div>

          <section className="space-y-3">
            <SectionRule label="What Ask Sunny is used for" />
            <UsageTypesPanel
              rows={snapshot.byCategory}
              previousRows={previousCategories}
              total={totals.events}
            />
          </section>
        </>
      ) : null}

      {view === "locations" ? (
        <>
          <AdoptionGapPanel
            noun="location"
            pluralNoun="locations"
            total={snapshot.locations.length}
            inactive={inactiveLocations.length}
            filters={filters}
            base={`${ANALYTICS_BASE}/locations`}
          />

          <section className="space-y-3">
            <SectionHeader
              title={filters.inactiveOnly ? "Inactive locations" : "Every location"}
              description={
                filters.inactiveOnly
                  ? `Locations with no recorded activity in ${window.label.toLowerCase()}.`
                  : `Every location on the roster, including those with no activity in ${window.label.toLowerCase()}.`
              }
            />
            <LocationsTable
              rows={filters.inactiveOnly ? inactiveLocations : snapshot.locations}
              filters={filters}
              base={`${ANALYTICS_BASE}/locations`}
            />
          </section>
        </>
      ) : null}

      {view === "leaders" ? (
        <>
          <AdoptionGapPanel
            noun="leader"
            pluralNoun="leaders"
            total={snapshot.leaders.length}
            inactive={inactiveLeaders.length}
            filters={filters}
            base={`${ANALYTICS_BASE}/leaders`}
          />

          <section className="space-y-3">
            <SectionHeader
              title={filters.inactiveOnly ? "Inactive leaders" : "Every leader"}
              description={
                filters.inactiveOnly
                  ? `Leaders with no recorded activity in ${window.label.toLowerCase()}.`
                  : `Every leader on the roster, including those with no activity in ${window.label.toLowerCase()}.`
              }
            />
            <LeadersTable
              rows={filters.inactiveOnly ? inactiveLeaders : snapshot.leaders}
              filters={filters}
              base={`${ANALYTICS_BASE}/leaders`}
            />
          </section>
        </>
      ) : null}

      {view === "types" ? (
        <>
          <section className="space-y-3">
            <SectionHeader
              title="Which parts of Ask Sunny are used"
              description="The five areas of the product, by recorded activity."
            />
            <FeatureUsagePanel rows={snapshot.byFeature} total={totals.events} />
          </section>

          <section className="space-y-3">
            <SectionHeader
              title="What people are doing"
              description="Request types in the product's own vocabulary, with share of total and change against the prior period."
            />
            <UsageTypesPanel
              rows={snapshot.byCategory}
              previousRows={previousCategories}
              total={totals.events}
            />
          </section>
        </>
      ) : null}
    </PageShell>
  );
}

/**
 * The four views, as links carrying the current filters.
 *
 * Links rather than a client tab component, so each view is a server render with
 * its own URL — shareable, bookmarkable, and back-button correct.
 */
function ViewTabs({
  view,
  filters,
}: {
  view: AnalyticsView;
  filters: AnalyticsFilters;
}) {
  return (
    <nav aria-label="Analytics views" className="flex flex-wrap gap-1">
      {ANALYTICS_VIEWS.map((entry) => {
        const active = entry.key === view;
        return (
          <Link
            key={entry.key}
            href={hrefFor(entry.key, filters)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-selected text-selected-foreground"
                : "text-muted-foreground hover:bg-hover-surface hover:text-foreground",
            )}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}

function TabLink({
  view,
  filters,
  children,
}: {
  view: AnalyticsView;
  filters: AnalyticsFilters;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={hrefFor(view, filters)}
      className="text-[11.5px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      {children}
    </Link>
  );
}

function hrefFor(view: AnalyticsView, filters: AnalyticsFilters): string {
  const path = view === "overview" ? ANALYTICS_BASE : `${ANALYTICS_BASE}/${view}`;
  const query = serializeFilters(filters);
  return query ? `${path}?${query}` : path;
}

/**
 * The adoption gap, as a sentence rather than a chart.
 *
 * Two numbers and two links. A bar chart of "active vs inactive" would take six
 * times the height to say the same thing, and what the reader wants next is not
 * a picture — it is the list.
 */
function AdoptionGap({
  inactiveLocations,
  totalLocations,
  inactiveLeaders,
  totalLeaders,
  filters,
}: {
  inactiveLocations: number;
  totalLocations: number;
  inactiveLeaders: number;
  totalLeaders: number;
  filters: AnalyticsFilters;
}) {
  if (totalLocations === 0 && totalLeaders === 0) return null;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-4 shadow-soft">
      <p className="eyebrow">Adoption gap</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-body-foreground">
        <strong className="font-semibold text-foreground">
          {formatNumber(totalLocations - inactiveLocations)} of{" "}
          {formatNumber(totalLocations)}
        </strong>{" "}
        locations and{" "}
        <strong className="font-semibold text-foreground">
          {formatNumber(totalLeaders - inactiveLeaders)} of{" "}
          {formatNumber(totalLeaders)}
        </strong>{" "}
        leaders recorded activity in this period.{" "}
        {inactiveLocations > 0 || inactiveLeaders > 0 ? (
          <>
            <TabLink view="locations" filters={filters}>
              {formatNumber(inactiveLocations)}{" "}
              {inactiveLocations === 1 ? "location" : "locations"}
            </TabLink>{" "}
            and{" "}
            <TabLink view="leaders" filters={filters}>
              {formatNumber(inactiveLeaders)}{" "}
              {inactiveLeaders === 1 ? "leader" : "leaders"}
            </TabLink>{" "}
            have not started.
          </>
        ) : (
          "Everybody on the roster has used it at least once."
        )}
      </p>
    </div>
  );
}
