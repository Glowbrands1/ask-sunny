import Link from "next/link";

import { Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import { SectionRule } from "@/components/ui/marquee";
import { cn } from "@/lib/utils/cn";
import { ROLES } from "@/lib/permissions";
import { bucketFor, serializeFilters, type AnalyticsFilters } from "@/lib/analytics/filters";
import type { AnalyticsSnapshot } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/utils/format";
import { BUSINESS_TIMEZONE } from "@/lib/business-date";
import { buildInsights } from "@/lib/analytics/insights";
import type { FeedbackPage, FeedbackSnapshot } from "@/lib/analytics/feedback-queries";
import type { FeedbackFilters } from "@/lib/analytics/feedback-filters";
import { AdoptionGapPanel } from "./adoption-gap";
import { AnalyticsFilterBar } from "./filter-bar";
import { AnalyticsKpiRow } from "./kpi-row";
import { UsageByRoleChart, UsageTrendChart } from "./charts";
import { LeadersTable, LocationsTable } from "./tables";
import { FeatureUsagePanel, UsageTypesPanel } from "./usage-types";
import { ConversationFeedbackSummary } from "./feedback-summary";
import { FeedbackQueue } from "./feedback-queue";
import {
  ExtractionPanel,
  InsightCards,
  SurfacesPanel,
  TopicsPanel,
  WhenPanel,
} from "./usage-shape";

export const ANALYTICS_BASE = "/admin/analytics";

export const ANALYTICS_VIEWS = [
  { key: "overview", label: "Overview" },
  { key: "locations", label: "By Location" },
  { key: "leaders", label: "By Leader" },
  { key: "types", label: "Usage Types" },
  /*
   * FEEDBACK IS ITS OWN TAB, not a panel on Overview, for the same reason the
   * other three are tabs: it is a WORK QUEUE with five filters, a search box, a
   * page control and per-item actions. Sitting under the KPI row it would be
   * the longest thing on the page and the hardest to use. Overview carries the
   * summary — the average, the distribution, the outcome split — and links here
   * for the comments themselves.
   */
  { key: "feedback", label: "Feedback" },
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
/*
 * A NOTE ON SECTION SPACING, because it was wrong in a way that is easy to
 * reintroduce.
 *
 * `SectionHeader` carries its own `mb-4`. A section that wrapped one in
 * `space-y-3` therefore put 16px AND 12px between the heading and its content,
 * which is the "headings too far from content" in the layout report — and it
 * was inconsistent, because the sections headed by `SectionRule` (which owns no
 * bottom margin) need that `space-y-3` and look correct with it.
 *
 * So: `space-y-0` under a `SectionHeader`, `space-y-3` under a `SectionRule`.
 * The component keeps its spacing rather than the screen overriding it, so
 * every other page that uses `SectionHeader` is untouched.
 */
export function AnalyticsScreen({
  view,
  filters,
  snapshot,
  previousCategories,
  feedback,
  queueFilters,
  feedbackPage,
}: {
  view: AnalyticsView;
  filters: AnalyticsFilters;
  snapshot: AnalyticsSnapshot;
  previousCategories: AnalyticsSnapshot["byCategory"];
  feedback: FeedbackSnapshot;
  queueFilters: FeedbackFilters;
  /**
   * One page of comments.
   *
   * ONLY FETCHED FOR THE FEEDBACK TAB, so it is null everywhere else. Loading a
   * page of comments to render the Overview would be a query nobody reads, and
   * the moderation queue is the one panel whose cost grows with the number of
   * complaints.
   */
  feedbackPage: FeedbackPage | null;
}) {
  const { totals, previous, window } = snapshot;

  /*
   * THE INSIGHT SENTENCES, COMPUTED HERE FROM WHAT IS ALREADY ON THE PAGE.
   * Arithmetic, not a model — see `lib/analytics/insights.ts` for why that
   * distinction is load-bearing rather than a preference.
   */
  const insights = buildInsights({
    totals,
    previous,
    trend: snapshot.trend,
    when: feedback.when,
    topics: feedback.topics,
    previousTopics: feedback.previousTopics,
    feedback: feedback.summary,
    periodLabel: window.label,
    previousLabel: `prior ${window.days} days`,
    timezoneLabel: timezoneLabel(),
  });

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
            <section className="space-y-0">
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

            <section className="space-y-0">
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

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <section className="space-y-3">
              <SectionRule label="What leaders ask about" />
              <TopicsPanel
                rows={feedback.topics}
                previousRows={feedback.previousTopics}
              />
            </section>

            <section className="space-y-3">
              <SectionRule label="What the numbers say" />
              <InsightCards insights={insights} />
            </section>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="space-y-3">
              <SectionRule label="When Ask Sunny is used" />
              <WhenPanel rows={feedback.when} timezoneLabel={timezoneLabel()} />
            </section>

            <section className="space-y-3">
              <SectionRule label="Where Ask Sunny is used" />
              <SurfacesPanel rows={feedback.surfaces} />
            </section>
          </div>

          <section className="space-y-0">
            <SectionHeader
              title="Conversation feedback"
              description="Every Ask Sunny answer can be rated by the person who asked for it. This is the summary; the Feedback tab is the queue."
              actions={
                <TabLink view="feedback" filters={filters}>
                  View comments
                </TabLink>
              }
            />
            <ConversationFeedbackSummary
              summary={feedback.summary}
              previous={feedback.previousSummary}
              periodLabel={window.label}
            />
          </section>

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

      {view === "feedback" ? (
        <>
          <section className="space-y-0">
            <SectionHeader
              title="Conversation feedback"
              description={`Ratings left against individual Ask Sunny answers in ${window.label.toLowerCase()}. Each one names the answer it is about, the surface it was asked from and the topic it concerned.`}
            />
            <ConversationFeedbackSummary
              summary={feedback.summary}
              previous={feedback.previousSummary}
              periodLabel={window.label}
            />
          </section>

          <section className="space-y-3">
            <SectionRule label="Suggestions & comments" />
            {feedbackPage ? (
              <FeedbackQueue
                base={`${ANALYTICS_BASE}/feedback`}
                filters={filters}
                queue={queueFilters}
                page={feedbackPage}
                closedCounts={{
                  resolved: feedback.summary.queue.resolved,
                  dismissed: feedback.summary.queue.dismissed,
                }}
              />
            ) : null}
          </section>

          <section className="space-y-3">
            <SectionRule label="Report extraction" />
            <ExtractionPanel rows={feedback.extraction} />
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

          <section className="space-y-0">
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

          <section className="space-y-0">
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
          <section className="space-y-0">
            <SectionHeader
              title="Which parts of Ask Sunny are used"
              description="The five areas of the product, by recorded activity."
            />
            <FeatureUsagePanel rows={snapshot.byFeature} total={totals.events} />
          </section>

          <section className="space-y-0">
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

/**
 * The business timezone, named the way a reader would say it.
 *
 * SHOWN BESIDE EVERY HOUR ON THIS PAGE, because "the 10am–11am hour is busiest"
 * is meaningless without it — Sun Tan City operates across US zones and the
 * server is a container in some region with no opinion worth having. The value
 * comes from the same `business-date.ts` constant every other date decision
 * reads, so the page and the query cannot disagree about which clock they mean.
 *
 * The IANA name is turned into its short form ("Eastern") by asking `Intl` for
 * it rather than by a lookup table that would go stale, and falls back to the
 * raw identifier if the runtime cannot name it — which is ugly and honest,
 * where a hard-coded "Eastern" for a zone somebody changed would be neither.
 */
function timezoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: BUSINESS_TIMEZONE,
      timeZoneName: "long",
    }).formatToParts(new Date());
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    /* "Eastern Daylight Time" -> "Eastern". The rest is noise on a chart label. */
    return name ? name.replace(/\s*(Standard|Daylight)\s+Time$/, "") : BUSINESS_TIMEZONE;
  } catch {
    return BUSINESS_TIMEZONE;
  }
}
