import Link from "next/link";
import { Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import {
  ProvenanceChip,
  ProvenanceChips,
  SectionRule,
} from "@/components/ui/marquee";
import { ReportBand } from "@/features/reports/report-frame";
import { formatReviewsInstant } from "@/lib/reviews/display-time";
import {
  reviewSetupHref,
  reviewsHref,
  WEEK_CURRENT,
  WEEK_MONTH,
  type ReviewFilters,
  type ReviewsTab,
} from "@/lib/reviews/filters";
import {
  districtGoalRollups,
  formatGoalMonth,
  formatMonthToDate,
  goalSummary,
  type DistrictGoalRollup,
  type ReviewGoalContext,
} from "@/lib/reviews/goal";
import { formatWeekRange } from "@/lib/reviews/reporting-week";
import type { ReviewTimeline } from "@/lib/reviews/timeline";
import type {
  DashboardReview,
  LocationRollup,
  RatingDistribution,
} from "@/lib/reviews/types";
import type { ReviewFeed as ReviewFeedData, ReviewsSnapshot } from "@/lib/reviews/queries";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { ReviewDetail } from "./review-detail";
import { ReviewFeed } from "./review-feed";
import { ReviewsAskBar } from "./reviews-ask-bar";
import {
  ReviewsFilterBar,
  type ReviewFilterControl,
} from "./reviews-filter-bar";
import { WindowTag } from "./review-goal-parts";
import { ReviewGoalTable } from "./reviews-goal-table";
import { ReviewsLeaderboard } from "./reviews-leaderboard";
import { ReviewsTabs } from "./reviews-tabs";
import { ReviewsTimeline } from "./reviews-timeline";
import { Stars } from "./review-stars";

/**
 * ============================================================================
 * GOOGLE REVIEWS — REAL REVIEWS, AND EVERY NUMBER LINKS TO THE ONES BEHIND IT
 * ============================================================================
 *
 * This screen reads persisted Google reviews from Supabase. There is no seeded
 * content in this file and no import from `data/demo`.
 *
 * ============================================================================
 * FOUR VIEWS, ONE PAGE, ONE SET OF FIGURES
 * ============================================================================
 *
 * Everything that used to be stacked on one very long scroll is still here —
 * the weekly measures, the response queue, the salon leaderboard, the
 * districts, the holdings and every review record — arranged as four views
 * instead of six screens of scrolling:
 *
 *   OVERVIEW            the month's goal, every salon's progress toward it,
 *                       and how many reviews are arriving
 *   GOOGLE REVIEWS      the records, filtered
 *   NEEDS RESPONSE      the work, and only the work
 *   SALON LEADERBOARD   the salons ranked against the monthly goal
 *
 * ALL FOUR READ THE SAME SERVER-RENDERED SNAPSHOT. Switching views costs a
 * render, not a query, so the leaderboard and the feed cannot end up describing
 * different moments — and no figure moved between them, because none of them is
 * computed here.
 *
 * ============================================================================
 * THE ONE RULE THE WHOLE PAGE IS ARRANGED AROUND
 * ============================================================================
 *
 * ONLY 3-, 4- AND 5-STAR REVIEWS COUNT TOWARD THE OFFICIAL WEEKLY TOTAL. The
 * 1s and 2s are stored, shown, and worked in the response queue — and they
 * never raise that number. So the page carries BOTH figures, side by side and
 * separately labelled, rather than one figure whose definition a reader has to
 * remember. `eligible_for_weekly_count` is generated in the database from the
 * rating, so nothing here can disagree with it.
 *
 * ============================================================================
 * EVERY FIGURE IS A LINK, AND THAT IS THE DRILL-DOWN
 * ============================================================================
 *
 * "Qualifying this week = 37" is an anchor carrying `?week=current&qualifying=yes`,
 * and the feed it opens is rendered by the same filters. There is no second
 * query written to resemble the first — the number and the list come from one
 * predicate, so they cannot disagree. A drill-down now also names the VIEW it
 * lands on, so a figure on the Overview opens the records in Google Reviews
 * rather than filtering the page underneath the reader.
 *
 * ============================================================================
 * "THIS WEEK" MEANS A REPORTING PERIOD, NOT A WEEK WE HAPPENED TO IMPORT IN
 * ============================================================================
 *
 * Every weekly figure reads `reporting_period_id`. A review is in a period only
 * where it was proven to sit above its listing's anchor; an imported backlog is
 * historical and appears in NONE of them. That is not a filter applied here —
 * the rollup view joins the periods table, so a historical review is absent
 * from the input rather than excluded from the output.
 *
 * THE BACKLOG IS STILL ON THE PAGE, under its own heading, with its own
 * drill-down. Hiding it would be its own kind of dishonesty: those are real
 * customers, some of them are waiting for a reply, and the response queue
 * counts them for exactly that reason.
 *
 * ============================================================================
 * WHERE THE UNANCHORED-LISTING NOTICE WENT
 * ============================================================================
 *
 * It used to be the first thing on the page: a full-width attention block
 * naming fifteen salons and explaining baselines in four sentences, above every
 * figure, on every visit. The FACT it carries has not changed and is not
 * hidden — a listing with no baseline still says "No anchor — counting nothing"
 * in its own row on the leaderboard, still links an administrator straight to
 * its setup, and the leaderboard still leads with a line naming how many
 * listings are in that state. What changed is that a permanent, expected
 * configuration state no longer occupies the top of the dashboard every day.
 *
 * NOTHING ABOUT BASELINES, COUNTING OR HISTORICAL CLASSIFICATION MOVED. This is
 * a change of where a sentence is drawn.
 *
 * ============================================================================
 * THE TWELVE-WEEK REPORTING CHART IS NOT DRAWN HERE ANY MORE
 * ============================================================================
 *
 * "Reviews by week, twelve weeks" read `google_review_location_periods`, so it
 * could only draw what had been COUNTED — and a salon with no baseline counts
 * nothing, by design. On this estate that made it twelve empty columns taking
 * up a screen, and the question it was there to answer is now answered
 * properly: GOOGLE REVIEWS OVER TIME counts the review records, weekly or
 * monthly, and is true the moment a review is stored.
 *
 * THE CALCULATION BEHIND IT IS UNTOUCHED. `weeklyTrend()` still runs in
 * `aggregate.ts`, `loadReviewsSnapshot` still returns `snapshot.trend`, and
 * both still have their own tests. Nothing about what counts toward a week
 * changed; a chart stopped being drawn.
 *
 * ============================================================================
 * THE MONTHLY GOAL, AND WHAT LEFT THE REPORTING TABLES TO MAKE ROOM FOR IT
 * ============================================================================
 *
 * TEN QUALIFYING REVIEWS PER SALON PER MONTH, set by the business (Madeline
 * Patterson, October 2026). Until then this page deliberately drew no goal,
 * because none had been agreed; now one has, and `lib/reviews/goal.ts` holds it
 * as one app-wide default. Every goal figure is measured over the salons that
 * have a baseline — a salon with none is shown as "Not counting", never ranked
 * and never summed.
 *
 * REMOVED FROM THE REPORTING VIEWS at the same request: Unanswered, the
 * "Replies waiting" status, All this week and Last week. The Needs Response
 * view, its count on the tab and the reply workflow are untouched.
 *
 * ============================================================================
 * WHAT IS NOT ON THIS PAGE, AND WHY
 * ============================================================================
 *
 * GOOGLE'S LIFETIME REVIEW COUNT. The Business Profile page does not expose a
 * per-listing lifetime total in a form this parser can read, so "Total" here
 * means reviews ASK SUNNY HOLDS and is labelled that way. Printing a number
 * captioned "total reviews" that is not Google's total would be worse than not
 * printing one.
 */

/**
 * WHICH FILTERS EACH VIEW LEADS WITH.
 *
 * Location and rating everywhere, because those are the two questions somebody
 * brings to this page. Response status on the records, where "show me the
 * answered ones" is a real thing to ask. NOTHING IS TAKEN AWAY — the rest are
 * one press behind "More filters", and any filter actually in force appears in
 * the bar whatever view is open. The leaderboard carries its own search and
 * sort instead, because a fifteen-row table is found by name rather than by URL.
 */
const CONTROLS_BY_TAB: Record<ReviewsTab, ReviewFilterControl[]> = {
  overview: ["location", "rating"],
  reviews: ["location", "rating", "status", "search"],
  /*
   * THE LEADERBOARD LEADS WITH LOCATION AND NOTHING ELSE, and the omission is
   * deliberate. Its table carries its own search, district and status controls,
   * which REORDER AND NARROW THE ROWS ALREADY ON SCREEN — a different job from
   * the toolbar's filters, which decide what was read. Two "District" pills
   * doing two different things a hand's width apart is worse than one of each
   * in its own place. Everything else is one press behind "More filters", and
   * any filter in force still appears in the bar.
   */
  leaderboard: ["location"],
};

export function ReviewsScreen({
  filters,
  snapshot,
  feed,
  timeline,
  ratingDistribution,
  openReview,
  canManageAnchors = false,
}: {
  filters: ReviewFilters;
  snapshot: ReviewsSnapshot;
  feed: ReviewFeedData;
  /**
   * The over-time series, built from the review records rather than from the
   * reporting periods. See `lib/reviews/timeline.ts` for why the two are
   * separate and why neither can stand in for the other.
   */
  timeline: ReviewTimeline & { truncated: boolean };
  /**
   * The star breakdown of the review RECORDS, for the rating card.
   *
   * Separate from `snapshot.summary` for the same reason `timeline` is separate
   * from `snapshot.trend`: the summary is summed from the reporting periods, and
   * a distribution of what customers gave must not depend on whether a listing
   * has a baseline. See `lib/reviews/queries.ts`.
   */
  ratingDistribution: RatingDistribution;
  openReview: DashboardReview | null;
  /**
   * Whether to draw the anchor markers as links to the baseline setup screen.
   *
   * THE FACT IS SHOWN TO EVERYBODY; THE LINK IS NOT. Anybody reading this
   * dashboard needs to know a listing is counting nothing, because that is what
   * its zero means. Only an administrator can do anything about it, and the
   * setup screen refuses everybody else — so for a District Manager the marker
   * is plain text rather than a link into a page that would bounce them.
   */
  canManageAnchors?: boolean;
}) {
  const { locations, districts } = snapshot;

  const scoped =
    filters.district !== null || filters.storeCode !== null
      ? filters.storeCode
        ? (locations[0]?.locationName ?? `Store ${filters.storeCode}`)
        : filters.district
      : null;

  /* The review the ask bar offers to draft a reply to: the top of the queue. */
  const oldestOpen = feed.reviews.find(
    (review) => review.responseStatus === "needs_response",
  );

  /* The recorded sync instant, read in the salons' own zone rather than the
     container's. Null covers both "never synced" and an unparseable stamp. */
  const lastSync = formatReviewsInstant(snapshot.lastSyncAt);

  return (
    <div className="min-w-0">
      <ReportBand
        title="Google Reviews"
        description={
          scoped
            ? `Qualifying reviews and the ${snapshot.goal.target}-a-month goal for ${scoped}`
            : `Qualifying reviews and the ${snapshot.goal.target}-a-month goal across every salon you cover`
        }
        provenance={
          <ProvenanceChips>
            <ProvenanceChip emphasis>
              Week of {formatWeekRange(snapshot.currentWeek)}
            </ProvenanceChip>
            <ProvenanceChip emphasis>
              Month to date {formatMonthToDate(snapshot.goal)}
            </ProvenanceChip>
            <ProvenanceChip>
              {locations.length} {locations.length === 1 ? "salon" : "salons"}
            </ProvenanceChip>
            <ProvenanceChip>
              {districts.length} {districts.length === 1 ? "district" : "districts"}
            </ProvenanceChip>
            {/*
              THE CONNECTION CHIP IS READ, NEVER ASSERTED. The seeded screen
              carried the words "Not connected to Google" as a constant; on a
              deployment that IS syncing, a hard-coded chip would be the page
              stating the opposite of what it is showing. So the chip reports
              the last sync this deployment actually recorded, and says only
              that when there is none.

              AND IT READS IT IN CENTRAL. `toLocaleString()` with no zone
              formats in the HOST's zone, and this is a server component on a
              UTC container, so the chip printed 12:25 PM for a sync that had
              run at 7:25 in the morning — a timestamp from the future to
              everyone reading it. The instant is unchanged and still stored in
              UTC; only the rendering moved.
            */}
            <ProvenanceChip>
              {lastSync ? `Last sync ${lastSync}` : "No sync recorded yet"}
            </ProvenanceChip>
          </ProvenanceChips>
        }
        action={
          <ReviewsAskBar
            oldestOpen={
              oldestOpen
                ? {
                    locationName: oldestOpen.locationName,
                    rating: oldestOpen.rating,
                    reviewerName: oldestOpen.reviewerName,
                  }
                : null
            }
          />
        }
      />

      <ReviewsTabs filters={filters} />

      <ReviewsFilterBar
        filters={filters}
        districts={snapshot.districtOptions}
        locations={snapshot.locationOptions}
        weekStarts={snapshot.weekStarts}
        controls={CONTROLS_BY_TAB[filters.tab]}
      />

      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 pb-7 sm:px-6">
        {snapshot.empty ? <NothingSyncedYet /> : null}

        {filters.tab === "overview" ? (
          <OverviewView
            filters={filters}
            snapshot={snapshot}
            timeline={timeline}
            ratingDistribution={ratingDistribution}
            scoped={scoped}
            canManageAnchors={canManageAnchors}
          />
        ) : null}

        {filters.tab === "reviews" ? (
          <RecordsView filters={filters} feed={feed} openReview={openReview} />
        ) : null}

        {filters.tab === "leaderboard" ? (
          <LeaderboardView
            filters={filters}
            snapshot={snapshot}
            canManageAnchors={canManageAnchors}
          />
        ) : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- the views --- */

/**
 * THE DEFAULT VIEW: the month's goal, every salon's progress toward it, then
 * how many reviews are arriving and what ASK Sunny holds.
 *
 * The goal section is what Madeline Patterson asked for: qualifying reviews
 * this week and month to date, against ten per salon. The over-time chart, the
 * holdings and the rating breakdown below it are unchanged.
 */
function OverviewView({
  filters,
  snapshot,
  timeline,
  ratingDistribution,
  scoped,
  canManageAnchors,
}: {
  filters: ReviewFilters;
  snapshot: ReviewsSnapshot;
  timeline: ReviewTimeline & { truncated: boolean };
  ratingDistribution: RatingDistribution;
  scoped: string | null;
  canManageAnchors: boolean;
}) {
  const { summary, locations, goal } = snapshot;
  const month = formatGoalMonth(goal);

  return (
    <>
      {/* -------------------------------------------------- the month goal -- */}
      <SectionRule
        label={`${month} review goal`}
        className="mt-1"
        action={
          canManageAnchors
            ? {
                label: "Google review sources",
                href: "/admin/integrations/google-reviews",
              }
            : undefined
        }
      />
      <p className="-mt-2 text-[11.5px] text-muted-foreground">
        Every salon&rsquo;s target is {goal.target} qualifying Google reviews a month.
        Weekly figures cover {formatWeekRange(snapshot.currentWeek)}; monthly figures
        cover {formatMonthToDate(goal)}.
      </p>

      <GoalTiles filters={filters} snapshot={snapshot} />

      {/*
        NO BASELINE BANNER HERE, deliberately — see "WHERE THE UNANCHORED-LISTING
        NOTICE WENT" above. Each unanchored row says "No anchor — counting
        nothing" itself, and the leaderboard carries the one-line count.
      */}
      <ReviewGoalTable
        locations={locations}
        filters={filters}
        goal={goal}
        currentWeek={snapshot.currentWeek}
        canManageAnchors={canManageAnchors}
      />

      {(() => {
        const districts = districtGoalRollups(locations, goal);
        return districts.length > 1 ? (
          <DistrictGoalTable districts={districts} filters={filters} goal={goal} />
        ) : null;
      })()}

      {/*
        ---------------------------------------------------------- over time --

        NO SECTION RULE ABOVE IT. The chart card carries its own title, and
        "Over time" sitting a centimetre above "Google Reviews Over Time" is the
        page saying the same thing twice in two type sizes.
      */}
      <ReviewsTimeline timeline={timeline} scope={scoped} className="mt-1" />

      {/*
        ------------------------------------- everything ASK Sunny holds --

        NO ACTION LINK ON THIS RULE, and its absence is deliberate twice over.
        The tiles under it each link into the records already, so another link
        saying the same thing is noise — and `SectionRule` lays its action out
        `whitespace-nowrap` beside the heading, which at 390px pushed this
        particular pair 32px past the viewport and gave the page a horizontal
        scrollbar. Found by measuring the real page in a browser at phone width.

        THREE TILES WHERE THERE WERE FOUR, AND THE AVERAGE MOVED HERE. The old
        "Month to date" tile summed every review in the weeks that began this
        month; the goal section above now carries the real month-to-date figure,
        and two different "month to date" numbers on one page would be one too
        many. "1–2 star, needing attention" counted unanswered reviews, which
        left the reporting view with the Unanswered column; the Needs Response
        view still counts and lists them.
      */}
      <SectionRule label="Everything ASK Sunny holds" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MeasureTile
          label="All imported reviews"
          value={formatNumber(summary.totalReviews)}
          detail="Every Google review ASK Sunny holds — counted and historical alike. All of them are in the Google Reviews view, whatever week they count in."
          href={reviewsHref({ ...filters, tab: "reviews", week: "all", assignment: "all" })}
        />

        <MeasureTile
          label="Historical — not yet counted"
          value={formatNumber(summary.historicalReviews)}
          detail={
            summary.historicalReviews === 0
              ? "Every review held is assigned to a reporting period"
              : "Imported before the location had a baseline, or their place in the feed could not be proven. Stored, visible and searchable — and in no weekly total."
          }
          href={reviewsHref({
            ...filters,
            tab: "reviews",
            week: "all",
            assignment: "historical",
          })}
        />

        <MeasureTile
          label="Average rating"
          value={summary.averageRating === null ? "—" : summary.averageRating.toFixed(2)}
          detail={`Across all ${formatNumber(summary.totalReviews)} ${
            summary.totalReviews === 1 ? "review" : "reviews"
          } held, counted and historical alike`}
          adornment={
            summary.averageRating === null ? null : (
              <Stars rating={summary.averageRating} showNumber={false} />
            )
          }
        />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-[18px] shadow-raised">
        {/*
          THE HEADING CARRIES THE TOTAL THE FIVE BARS ADD UP TO, and it is the
          `total` the distribution derived from its own buckets rather than a
          second figure read from somewhere else — so the heading and the rows
          cannot disagree about how many reviews are being described.
        */}
        <p className="eyebrow">
          Reviews by rating · {formatNumber(ratingDistribution.total)}{" "}
          {ratingDistribution.total === 1 ? "review" : "reviews"}
        </p>
        <RatingBreakdown distribution={ratingDistribution} filters={filters} />
      </div>
    </>
  );
}

/** The records themselves, filtered — the view every drill-down lands on. */
function RecordsView({
  filters,
  feed,
  openReview,
}: {
  filters: ReviewFilters;
  feed: ReviewFeedData;
  openReview: DashboardReview | null;
}) {
  return (
    <>
      <SectionRule label="Google reviews" className="mt-1" />
      <p className="-mt-2 text-[11.5px] text-muted-foreground">
        The actual review records behind every number on this page. Unanswered first,
        then the lowest rating, then the longest waiting.
      </p>

      {openReview ? <ReviewDetail review={openReview} filters={filters} /> : null}

      <div id="review-feed" className="scroll-mt-4">
        <ReviewFeed
          reviews={feed.reviews}
          total={feed.total}
          truncated={feed.truncated}
          filters={filters}
        />
      </div>

      <Notice tone="neutral" icon={<Info />} title="Where this data comes from">
        {/*
          TWO TRANSPORTS, ONE SET OF RECORDS. This notice described only the
          Brave extension, which stopped being the whole truth when the
          server-side Apify sync landed. Which one carried a given review is
          recorded per review and reconciled on the admin screen; it changes
          nothing about how the review is counted, because Google's own review
          id is the deduplication key either way.
        */}
        <p>
          Reviews reach ASK Sunny two ways: a server-side sync that reads each
          salon&rsquo;s public Google listing on a schedule, and the ASK Sunny Review
          Sync extension, which reads the Google Business Profile Reviews page in an
          authorized user&rsquo;s own signed-in Brave session. Nothing here handles a
          Google credential. Google&rsquo;s own review id is the deduplication key, so
          the same review arriving by both routes is one record, not two. A review
          counts toward a week only where it sat above that salon&rsquo;s last-counted
          review, so an imported backlog never raises this week&rsquo;s number.
        </p>
      </Notice>
    </>
  );
}

/** The salons ranked against the monthly goal. */
function LeaderboardView({
  filters,
  snapshot,
  canManageAnchors,
}: {
  filters: ReviewFilters;
  snapshot: ReviewsSnapshot;
  canManageAnchors: boolean;
}) {
  const { locations, goal } = snapshot;

  return (
    <>
      <SectionRule
        label="Salon leaderboard"
        className="mt-1"
        action={
          canManageAnchors
            ? { label: "Review baselines", href: reviewSetupHref() }
            : undefined
        }
      />
      <p className="-mt-2 text-[11.5px] text-muted-foreground">
        Ranked by qualifying reviews this month. The goal is {goal.target} per salon in{" "}
        {formatGoalMonth(goal)}; salons on the same count share a rank.
      </p>

      {snapshot.awaitingAnchor.length > 0 ? (
        <AwaitingAnchorLine
          listings={snapshot.awaitingAnchor}
          canManageAnchors={canManageAnchors}
        />
      ) : null}

      <ReviewsLeaderboard
        locations={locations}
        filters={filters}
        goal={goal}
        canManageAnchors={canManageAnchors}
      />

      {snapshot.verificationRequired.length > 0 ? (
        <Notice tone="attention" icon={<Info />} title="Google verification on two listings">
          <p>
            Google currently shows a verification problem on{" "}
            {snapshot.verificationRequired
              .map((entry) => `${entry.label} (${entry.storeCode})`)
              .join(" and ")}
            . Both salons are trading and stay in the roster and in every total here —
            but Google may not be serving new reviews for those profiles until the
            verification is cleared, so a quiet week at either one may be Google
            rather than the salon.
          </p>
        </Notice>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- parts -- */

/** How many of the waiting reviews the queue section shows before the feed. */
function describeDelta(current: number, previous: number): string {
  const delta = current - previous;
  if (delta === 0) return "level with last week";
  return `${delta > 0 ? "+" : ""}${delta} versus last week`;
}

/**
 * ============================================================================
 * ONE LINE WHERE A FULL-WIDTH BANNER USED TO BE
 * ============================================================================
 *
 * A listing with no reporting anchor is not being counted, and the page still
 * says so — in the row of the salon it concerns, where the zero it explains is,
 * and once at the top of the table it explains. What it no longer does is open
 * the dashboard with a four-sentence attention block naming fifteen salons,
 * every day, for a state that is expected and that only an administrator can
 * act on.
 *
 * THE FACTS ARE UNCHANGED AND SO IS THE ROUTE OUT. The count is read from the
 * same `awaitingAnchor` listing, the reviews it refers to are still in the
 * Google Reviews view, and for somebody who can act on it the sentence is still
 * a link straight to the baseline setup screen.
 */
function AwaitingAnchorLine({
  listings,
  canManageAnchors,
}: {
  listings: { storeCode: string; label: string; historical: number }[];
  canManageAnchors: boolean;
}) {
  const held = listings.reduce((total, entry) => total + entry.historical, 0);

  return (
    <p className="-mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3.5 py-2 text-[11.5px] text-muted-foreground">
      <span>
        <strong className="font-bold text-foreground">
          {listings.length} {listings.length === 1 ? "salon has" : "salons have"} no
          baseline yet
        </strong>
        , so weekly counting has not started for{" "}
        {listings.length === 1 ? "it" : "them"}
        {held > 0 ? (
          <>
            {" "}
            and the {formatNumber(held)} {held === 1 ? "review" : "reviews"} synced so far{" "}
            {held === 1 ? "is" : "are"} held as historical
          </>
        ) : null}
        . The rows below name which.
      </span>
      {canManageAnchors ? (
        <Link
          href={reviewSetupHref()}
          className="font-bold text-accent-foreground hover:underline"
        >
          Set review baselines →
        </Link>
      ) : null}
    </p>
  );
}

function NothingSyncedYet() {
  return (
    <Notice
      tone="accent"
      icon={<Info />}
      title="No Google reviews have been synced into this deployment yet"
    >
      <p>
        Load the ASK Sunny Review Sync extension in Brave, point it at this
        deployment&rsquo;s URL in its Options page, open{" "}
        <span className="font-mono text-[12px]">business.google.com/reviews</span>, and
        press <strong>Sync Sun Tan City Reviews</strong>. Every figure on this page is
        computed from the reviews that arrive — until then they are all honestly zero.
      </p>
    </Notice>
  );
}

/**
 * ============================================================================
 * THE MONTH'S GOAL IN FOUR FIGURES
 * ============================================================================
 *
 * The week, the month, how many salons are at goal, and what is still needed.
 * Every figure is summed over the salons IN VIEW THAT HAVE A BASELINE: a salon
 * counting nothing has no week and no month, and adding its zero to a target
 * would make the estate look further behind than anything measured says.
 *
 * THE WEEKLY COMPARISON IS LIKE FOR LIKE. "+3 vs last week" compares qualifying
 * reviews counted into this reporting period with those counted into the last
 * one, over the same salons.
 *
 * ONE YELLOW TILE. The direction allows brand yellow two filled blocks a
 * screen; this is the one the page spends, on the figure the goal is about.
 */
function GoalTiles({
  filters,
  snapshot,
}: {
  filters: ReviewFilters;
  snapshot: ReviewsSnapshot;
}) {
  const { goal, locations } = snapshot;
  const summary = goalSummary(locations, goal);
  const single = locations.length === 1;
  const only = single ? locations[0] : null;
  const daysLeft = goal.daysInMonth - goal.dayOfMonth;
  const month = formatGoalMonth(goal);
  const atGoalShare =
    single && only
      ? Math.min(100, (only.qualifyingMonthToDate / goal.target) * 100)
      : summary.counting === 0
        ? 0
        : (summary.atGoal / summary.counting) * 100;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <GoalTile
        tag={<WindowTag window="week">This week · {formatWeekRange(snapshot.currentWeek)}</WindowTag>}
        label="Qualifying reviews"
        value={formatNumber(summary.qualifyingThisWeek)}
        detail={`3–5★ reviews counted this week · ${describeDelta(
          summary.qualifyingThisWeek,
          summary.qualifyingLastWeek,
        )}`}
        href={reviewsHref({
          ...filters,
          tab: "reviews",
          week: WEEK_CURRENT,
          qualifying: "yes",
          assignment: "counted",
        })}
      />

      <GoalTile
        tag={<WindowTag window="month">Month to date · {formatMonthToDate(goal)}</WindowTag>}
        label="Qualifying reviews"
        value={formatNumber(summary.qualifyingMonthToDate)}
        suffix={`/ ${formatNumber(summary.combinedTarget)}`}
        detail={
          summary.counting === 0
            ? "No salon in view has a baseline yet, so nothing is being counted"
            : summary.counting === 1
              ? `Against a target of ${goal.target} this month`
              : `Against a target of ${goal.target} per salon × ${summary.counting} counting`
        }
        href={reviewsHref({
          ...filters,
          tab: "reviews",
          week: WEEK_MONTH,
          qualifying: "yes",
        })}
      />

      <GoalTile
        yellow
        tag={<WindowTag window="month">Month to date</WindowTag>}
        label={single ? "Monthly goal" : "Salons at goal"}
        value={
          single && only
            ? formatNumber(only.anchorReviewId === null ? 0 : only.qualifyingMonthToDate)
            : formatNumber(summary.atGoal)
        }
        suffix={single ? `/ ${goal.target}` : `of ${formatNumber(summary.counting)}`}
        meter={atGoalShare}
        detail={
          daysLeft === 0
            ? `Last day of ${month}`
            : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in ${month}`
        }
        href={reviewsHref({ ...filters, tab: "leaderboard" })}
      />

      <GoalTile
        tag={<WindowTag window="month">Month to date</WindowTag>}
        label="Reviews still needed"
        value={formatNumber(summary.stillNeeded)}
        detail={
          summary.counting === 0
            ? "Nothing is being counted yet"
            : summary.stillNeeded === 0
              ? `Every salon in view has reached ${goal.target}`
              : single
                ? `To reach ${goal.target} this month`
                : `To bring every salon in view to ${goal.target}. One salon's overage doesn't cover another's shortfall.`
        }
      />
    </div>
  );
}

function GoalTile({
  tag,
  label,
  value,
  suffix,
  detail,
  href,
  yellow,
  meter,
}: {
  tag: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  href?: string;
  yellow?: boolean;
  /** 0–100. Drawn only on the yellow tile, in its own ink. */
  meter?: number;
}) {
  const body = (
    <>
      {tag}
      <p className={cn("eyebrow mt-2", yellow && "text-brand-yellow-soft-foreground")}>{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span
          className={cn(
            "display-figure text-[36px]",
            yellow ? "text-brand-yellow-foreground" : "text-foreground",
          )}
        >
          {value}
        </span>
        {suffix ? (
          <span
            className={cn(
              "display-figure text-[19px]",
              yellow ? "text-brand-yellow-soft-foreground" : "text-muted-foreground",
            )}
          >
            {suffix}
          </span>
        ) : null}
      </p>
      {typeof meter === "number" ? (
        <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-[4px] bg-[var(--meter-track-on-yellow)]">
          <span
            className="block h-full bg-brand-yellow-foreground"
            style={{ width: `${Math.max(0, Math.min(100, meter))}%` }}
          />
        </span>
      ) : null}
      <p
        className={cn(
          "mt-1.5 text-[10.5px] leading-snug",
          yellow ? "text-brand-yellow-soft-foreground" : "text-muted-foreground",
        )}
      >
        {detail}
      </p>
      {href ? (
        <p
          className={cn(
            "mt-2.5 text-[10px] font-black tracking-[0.07em] uppercase",
            yellow ? "text-brand-yellow-foreground" : "text-accent-foreground",
          )}
        >
          {yellow ? "Open the leaderboard →" : "See these reviews →"}
        </p>
      ) : null}
    </>
  );

  const className = cn(
    "block rounded-[var(--radius-lg)] border p-[18px] shadow-raised",
    yellow ? "border-brand-yellow bg-brand-yellow" : "border-border bg-surface",
  );

  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        className,
        "transition-colors",
        yellow ? "hover:bg-accent-hover" : "hover:bg-surface-muted",
      )}
    >
      {body}
    </Link>
  );
}

function MeasureTile({
  label,
  value,
  detail,
  href,
  adornment,
  flagged,
  list,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
  adornment?: React.ReactNode;
  flagged?: boolean;
  /**
   * The rows behind the figure, rendered inside the tile under a hairline.
   *
   * IT IS A SLOT RATHER THAN A DATA PROP because what belongs under a measure
   * differs per measure — a list of salons, a sentence about what the week also
   * brought — and a tile that accepted only one shape would push the other into
   * a caption where nobody reads it.
   *
   * WHAT IT IS NOT IS A METER. The seeded tile carried a progress bar against a
   * weekly goal; no goal exists in the data, so no tile here draws one.
   */
  list?: React.ReactNode;
}) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "display-figure text-[36px]",
            flagged ? "text-measure-flagged-foreground" : "text-foreground",
          )}
        >
          {value}
        </span>
        {adornment}
      </p>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{detail}</p>
      {list}
      {href ? (
        <p className="mt-2.5 text-[10px] font-black tracking-[0.07em] text-accent-foreground uppercase">
          See these reviews →
        </p>
      ) : null}
    </>
  );

  const className =
    "block rounded-[var(--radius-lg)] border border-border bg-surface p-[18px] shadow-raised";

  /*
   * A TILE WITHOUT A DRILL-DOWN IS NOT A LINK. Average rating is a property of
   * every review at once; linking it somewhere would send the reader to a list
   * that does not explain the figure, which is worse than not linking it.
   */
  if (!href) return <div className={className}>{body}</div>;

  return (
    <Link href={href} className={cn(className, "transition-colors hover:bg-surface-muted")}>
      {body}
    </Link>
  );
}

function RatingBreakdown({
  distribution,
  filters,
}: {
  distribution: RatingDistribution;
  filters: ReviewFilters;
}) {
  const { counts, total } = distribution;
  /* The longest bar is the biggest bucket, so a bar is read against its peers. */
  const max = Math.max(1, ...counts);

  return (
    <ul className="mt-2.5 space-y-1.5">
      {[5, 4, 3, 2, 1].map((rating) => {
        const count = counts[rating - 1];
        /*
          THE SHARE IS OF THE TOTAL, THE BAR IS OF THE LARGEST BUCKET, and the
          two are different on purpose: the percentage is the fact, and the bar
          is the comparison. A bar drawn as a share of the total would leave
          every row short on an estate that is mostly 5-star, which is most of
          them, and the shape of the distribution would be unreadable.
        */
        const share = total === 0 ? 0 : (count / total) * 100;
        const qualifying = rating >= 3;
        return (
          <li key={rating}>
            <Link
              href={reviewsHref({
                ...filters,
                tab: "reviews",
                rating: String(rating) as ReviewFilters["rating"],
              })}
              className="group flex items-center gap-2.5"
            >
              <span className="w-8 shrink-0 text-[11px] font-black tabular-nums">
                {rating}★
              </span>
              <span
                aria-hidden
                className="relative block h-[13px] min-w-0 flex-1 overflow-hidden rounded-[4px] bg-surface-muted"
              >
                <span
                  className={cn(
                    "block h-full rounded-r-[4px]",
                    /*
                      The 1s and 2s take the flagged fill and the 3s upward take
                      the data fill, unchanged. The split is decided by the star
                      alone — `rating >= 3`, right here — and reads nothing about
                      a baseline, an anchor or a reporting period, so it is not
                      one of the signals the distribution had to stop consulting.
                    */
                    qualifying ? "bg-measure-data" : "bg-status-under",
                  )}
                  style={{ width: `${Math.max(count === 0 ? 0 : 3, (count / max) * 100)}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-[11px] font-black tabular-nums group-hover:underline">
                {formatNumber(count)}
              </span>
              <span className="w-9 shrink-0 text-right text-[10.5px] text-muted-foreground tabular-nums">
                {share.toFixed(0)}%
              </span>
            </Link>
          </li>
        );
      })}
      <li className="pt-1 text-[10px] text-subtle-foreground">
        Distribution of synced Google reviews for the selected filters.
      </li>
    </ul>
  );
}

/**
 * The goal figures per district. Every column is summed over the district's
 * salons that have a baseline, so the target and the count cover the same
 * salons.
 */
function DistrictGoalTable({
  districts,
  filters,
  goal,
}: {
  districts: DistrictGoalRollup[];
  filters: ReviewFilters;
  goal: ReviewGoalContext;
}) {
  return (
    <section className="min-w-0 rounded-[var(--radius-lg)] border border-border bg-surface shadow-raised">
      <ScrollTable>
        <table aria-label="Goal progress by district" className="data-table min-w-[40rem]">
          <thead>
            <tr>
              <th scope="col">District</th>
              <th scope="col" data-align="right">
                Salons
              </th>
              <th
                scope="col"
                data-align="right"
                className="shadow-[inset_0_3px_0_var(--status-at-market-edge)]"
              >
                Qualifying
                <small className="text-muted-foreground">This week</small>
              </th>
              <th
                scope="col"
                data-align="right"
                className="shadow-[inset_0_3px_0_var(--selected)]"
              >
                Qualifying
                <small className="text-muted-foreground">Month to date</small>
              </th>
              <th scope="col" data-align="right">
                Target
                <small className="text-muted-foreground">{goal.target} × counting salons</small>
              </th>
              <th scope="col" data-align="right">
                Salons at goal
              </th>
            </tr>
          </thead>
          <tbody>
            {districts.map((district) => (
              <tr key={district.district}>
                <td>
                  <Link
                    href={reviewsHref({
                      ...filters,
                      district: district.district,
                      storeCode: null,
                    })}
                    className="text-[12px] font-bold text-foreground hover:underline"
                  >
                    {district.district}
                  </Link>
                </td>
                <td data-align="right">{district.locations}</td>
                <td data-align="right">{district.qualifyingThisWeek}</td>
                <td data-align="right" className="font-black text-foreground">
                  {district.qualifyingMonthToDate}
                </td>
                <td data-align="right">{district.combinedTarget}</td>
                <td data-align="right">
                  {district.atGoal} of {district.counting}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </section>
  );
}

/** Re-exported so `LocationRollup` consumers keep one import for the floor. */
export type { LocationRollup };
