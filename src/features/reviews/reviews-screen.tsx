"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUp, ArrowUpRight, Info, MessageSquare, Star, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { DemoDataNote, Notice } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import {
  ProvenanceChip,
  ProvenanceChips,
  SectionRule,
  StatusChip,
  type StatusTone,
} from "@/components/ui/marquee";
import { useInlineAsk } from "@/features/chat/use-inline-ask";
import { AnswerSheet } from "@/features/dashboard/answer-sheet";
import { ReportBand } from "@/features/reports/report-frame";
import {
  DEMO_CUSTOMER_REVIEWS,
  DEMO_REVIEW_METRICS,
  DEMO_REVIEW_TREND,
  reviewGoalProgress,
} from "@/data/demo/reviews";
import type { CustomerReview, ReviewMetric } from "@/types";
import { cn } from "@/lib/utils/cn";
import { demoNow, relativeTime } from "@/lib/utils/date";
import { formatNumber } from "@/lib/utils/format";
import { AXIS_PROPS, CHART_COLORS, ChartFrame, ChartTooltip, GRID_PROPS } from "../reports/chart-kit";

/**
 * ============================================================================
 * GOOGLE REVIEWS, ON THE MARQUEE GOOGLE REVIEWS ARTIFACT
 * ============================================================================
 *
 * The artifact does not simply restyle this page — it re-ranks it, and the
 * headline sentence is the argument:
 *
 *   "This page measures reviews gained. Reviews gained is last week's work — a
 *    Salon Director cannot do anything about it today. What she can act on is
 *    the 2-star review from three days ago that still has no reply, and that
 *    number appears nowhere on the page."
 *
 * So UNANSWERED leads and takes the only coral tile; reviews gained keeps its
 * goal meter and moves to second. Every figure still comes from the same
 * `DEMO_REVIEW_METRICS` and `DEMO_CUSTOMER_REVIEWS` this page always read —
 * nothing from the artifact's own sample data is here, and the salon names,
 * districts, ratings and counts are the app's.
 *
 * WHAT THE ARTIFACT'S PUNCH LIST ASKED FOR, AND WHERE EACH LANDED:
 *
 *   1. Unanswered leads, and is the only coral tile.        `AlarmTile` below.
 *   2. The queue sorts by severity, not by date.            `queueOrder`.
 *   3. Ask Sunny drafts the reply.                          The band's ask bar
 *                                                            and each row's
 *                                                            "Draft a reply".
 *   4. The leaderboard joins the status ladder.             `reviewStatus`,
 *                                                            sharing `StatusChip`
 *                                                            with the report tabs.
 *   5. Twelve weeks with the goal drawn on it.              The dashed rule.
 *   6. The pitch copy comes out.                            See below.
 *
 * ITEM 6, BECAUSE DELETING COPY DESERVES A REASON ON THE RECORD. "Nobody opens
 * twelve Google listings and does subtraction any more" and "this is the number
 * someone counts by hand every week today" were the page's description and its
 * hero footnote. The artifact: "They are sales lines. They belong in the demo,
 * not above a live metric a manager reads every Monday." The substance they
 * carried — that this is not connected to Google yet — is unchanged and still
 * on the page, in the integration notice at the foot where it is a fact rather
 * than a pitch.
 *
 * THE ONE THING THE ARTIFACT ASKED FOR THAT IS NOT A DESIGN CHANGE. It flags
 * that this page and Reporting are built on different salon rosters — twelve
 * salons here, fifteen there, no location in common — and says so itself: "it
 * is a data question rather than a design one." Nothing here can fix that, and
 * inventing a shared roster to make two screens agree would be worse than the
 * disagreement. It is called out in the migration notes rather than papered
 * over.
 */

/* ------------------------------------------------------------- the rules -- */

/**
 * THE ATTENTION RULE, IN ONE PLACE.
 *
 * The artifact caught this page contradicting itself: "The measure says four
 * salons need attention, and the page lists three... By the page's own rule,
 * under 60% of goal or below a 4.5 rating, Brookside Village qualifies too: 40%
 * of goal on a 4.3 rating. Either the count or the list is wrong, and a DM who
 * spots it will not trust either."
 *
 * Both halves of that were true. The count was `attention.length` and the list
 * was `attention.slice(0, 3)` — so a fourth qualifying salon was counted and
 * never shown. It is one predicate now, the tile lists every salon it counts,
 * and the leaderboard's chip reads off the SAME function, so the three places
 * this page talks about "needs attention" cannot disagree.
 */
function needsAttention(metric: ReviewMetric): boolean {
  return reviewGoalProgress(metric) < 60 || metric.averageRating < 4.5;
}

/** Ratings under this read coral in the leaderboard, per the artifact. */
const RATING_FLOOR = 4.5;

/**
 * A SALON'S RUNG ON THE SHARED STATUS LADDER.
 *
 * The Reviews artifact reuses the report tabs' four states and says why: "At
 * goal, on track, behind, needs attention — the same four fills and glyphs as
 * the report tabs, so a chip means the same thing wherever a DM sees it."
 *
 * `needsAttention` is checked FIRST, which is what keeps the chip honest
 * against the tile above it: a salon at 40% of goal on a 4.3 rating is "needs
 * attention" in both places, and cannot come out as "behind" here because its
 * progress happened to round differently.
 */
function reviewStatus(metric: ReviewMetric): { tone: StatusTone; label: string } {
  if (needsAttention(metric)) return { tone: "under", label: "Needs attention" };
  const progress = reviewGoalProgress(metric);
  if (progress >= 90) return { tone: "outperforming", label: "At goal" };
  if (progress >= 70) return { tone: "atMarket", label: "On track" };
  return { tone: "belowMarket", label: "Behind" };
}

/**
 * WHICH WAY IS BETTER FOR A WEEK-ON-WEEK REVIEW DELTA.
 *
 * Stated rather than assumed from the sign, which is the rule the reporting
 * pages follow through `sentimentFor`: a colour may only claim "good" where the
 * business has said which direction that is. Here it has, unambiguously — the
 * page carries a weekly review GOAL for every salon, so more reviews gained is
 * the direction being asked for. A flat week is neutral and takes no colour.
 */
function weekSentiment(delta: number): "good" | "bad" | "neutral" {
  if (delta === 0) return "neutral";
  return delta > 0 ? "good" : "bad";
}

/**
 * THE QUEUE ORDER, WHICH IS THE POINT OF THE QUEUE.
 *
 * The artifact's second item: "The page's own copy says responding to a
 * critical review matters more than the review itself, then sorts newest
 * first. Critical and unanswered comes first, then oldest — a 2-star sitting
 * three days is worse than a 3-star sitting two."
 *
 * So three keys, in order: unanswered before answered, then lower rating
 * before higher, then older before newer. "Newest first" is exactly backwards
 * for a work queue — it buries the review that has been waiting longest.
 */
function queueOrder(a: CustomerReview, b: CustomerReview): number {
  if (a.responded !== b.responded) return a.responded ? 1 : -1;
  if (a.rating !== b.rating) return a.rating - b.rating;
  return Date.parse(a.postedAt) - Date.parse(b.postedAt);
}

/**
 * How many whole days ago, for the alarm tile's one-line summary.
 *
 * MEASURED AGAINST `demoNow()`, NOT THE WALL CLOCK, and this was a real defect
 * caught in visual QA: with `Date.now()` the tile read "18 days out" while the
 * queue row two inches below it read "3 days ago" about the same review. The
 * seeded reviews are stamped from `DEMO_ANCHOR` and `relativeTime` measures
 * against it, so anything describing their age has to use the same clock or the
 * page contradicts itself. It also keeps the figure deterministic between the
 * server render and the browser, which is what stops a hydration mismatch.
 */
function daysAgo(iso: string): number {
  return Math.max(
    0,
    Math.floor((demoNow().getTime() - Date.parse(iso)) / 86_400_000),
  );
}

/** A rating as stars plus the number, so it is never conveyed by shape alone. */
function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-0.5", className)} aria-hidden>
      {Array.from({ length: 5 }).map((_, index) => (
        <Star
          key={index}
          className={cn(
            "size-3",
            index < Math.round(rating) ? "fill-gold text-gold" : "text-border-strong",
          )}
        />
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------- screen -- */

export function ReviewsScreen() {
  const searchParams = useSearchParams();
  const [districtFilter, setDistrictFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [responseFilter, setResponseFilter] = useState("all");

  // Deep link (?location=…) highlights a row. Derived, never copied into state.
  const highlightId = searchParams.get("location");

  const districts = useMemo(
    () => Array.from(new Set(DEMO_REVIEW_METRICS.map((m) => m.districtName))).sort(),
    [],
  );

  const metrics = useMemo(
    () =>
      DEMO_REVIEW_METRICS.filter((metric) =>
        districtFilter === "all" ? true : metric.districtName === districtFilter,
      ),
    [districtFilter],
  );

  const totals = useMemo(() => {
    const total = metrics.reduce((sum, m) => sum + m.totalReviews, 0);
    const gained = metrics.reduce((sum, m) => sum + m.reviewsGainedThisWeek, 0);
    const lastWeek = metrics.reduce((sum, m) => sum + m.reviewsGainedLastWeek, 0);
    const goal = metrics.reduce((sum, m) => sum + m.weeklyGoal, 0);
    const rating =
      metrics.reduce((sum, m) => sum + m.averageRating, 0) / (metrics.length || 1);
    return { total, gained, lastWeek, goal, rating, change: gained - lastWeek };
  }, [metrics]);

  /*
   * THE TREND'S GOAL LINE IS THE WHOLE ESTATE'S, NOT THE FILTERED SLICE'S.
   *
   * `DEMO_REVIEW_TREND` is a single aggregate series across every salon — there
   * is no per-district history behind it — so drawing a district's combined goal
   * across it would compare twelve salons' weekly counts against three salons'
   * target. The chart says which population it covers in its own caption for
   * the same reason.
   */
  const chainGoal = useMemo(
    () => DEMO_REVIEW_METRICS.reduce((sum, m) => sum + m.weeklyGoal, 0),
    [],
  );

  const attention = metrics.filter(needsAttention);

  const districtCount = useMemo(
    () => new Set(metrics.map((m) => m.districtName)).size,
    [metrics],
  );

  /** The reviews in the selected district, then the two queue filters. */
  const reviews = useMemo(() => {
    const inDistrict = DEMO_CUSTOMER_REVIEWS.filter((review) =>
      districtFilter === "all"
        ? true
        : metrics.some((metric) => metric.locationId === review.locationId),
    );
    return inDistrict
      .filter((review) => {
        if (ratingFilter === "critical") return review.rating <= 3;
        if (ratingFilter === "positive") return review.rating >= 4;
        return true;
      })
      .filter((review) => {
        if (responseFilter === "unanswered") return !review.responded;
        if (responseFilter === "answered") return review.responded;
        return true;
      })
      .sort(queueOrder);
  }, [districtFilter, metrics, ratingFilter, responseFilter]);

  /** Unanswered in the selected district, regardless of the queue filters. */
  const unanswered = useMemo(
    () =>
      DEMO_CUSTOMER_REVIEWS.filter(
        (review) =>
          !review.responded &&
          (districtFilter === "all" ||
            metrics.some((metric) => metric.locationId === review.locationId)),
      ).sort(queueOrder),
    [districtFilter, metrics],
  );

  const oldest = unanswered[0];

  return (
    <div className="min-w-0">
      {/*
        THE BAND, and the reviews artifact draws the same one the report tabs
        do — same near-black, same 4px yellow edge, same corner glow, same
        provenance chips, same ask bar. That sameness is the point: two Insights
        pages that share a shell read as one product.
      */}
      <ReportBand
        title="Google Reviews"
        description="The weekly review count and the response queue across every salon you cover"
        provenance={
          <ProvenanceChips>
            <ProvenanceChip emphasis>This week</ProvenanceChip>
            <ProvenanceChip>
              {metrics.length} {metrics.length === 1 ? "salon" : "salons"}
            </ProvenanceChip>
            <ProvenanceChip>
              {districtCount} {districtCount === 1 ? "district" : "districts"}
            </ProvenanceChip>
            <ProvenanceChip>Not connected to Google</ProvenanceChip>
          </ProvenanceChips>
        }
        action={
          /*
            THE ASK BAR, SCOPED TO THIS PAGE AND TO THE OLDEST UNANSWERED
            REVIEW. The artifact's third item: "'draft a reply to the 2-star at
            Hillcrest Station' is the single most useful thing chat can do here.
            The queue button and the band input land in the same place."

            The prompt names the salon and the rating from the page's own data,
            so it is the real oldest unanswered review rather than an example —
            and it degrades to the general question when the queue is empty.
          */
          <ReviewsAskBar review={oldest} />
        }
      />

      {/*
        THE FILTER ROW. District was a lone select in the page header; the
        artifact puts District, Rating and Response on one strip under the band,
        which is also what makes the queue below usable as a queue.
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-5 py-3.5 sm:px-6">
        <span className="eyebrow mr-0.5 shrink-0 text-subtle-foreground">Filters</span>
        <FilterSelect
          label="District"
          value={districtFilter}
          onChange={setDistrictFilter}
          options={[
            { value: "all", label: "All districts" },
            ...districts.map((district) => ({ value: district, label: district })),
          ]}
        />
        <FilterSelect
          label="Rating"
          value={ratingFilter}
          onChange={setRatingFilter}
          options={[
            { value: "all", label: "All" },
            { value: "critical", label: "3 stars and under" },
            { value: "positive", label: "4 stars and over" },
          ]}
        />
        <FilterSelect
          label="Response"
          value={responseFilter}
          onChange={setResponseFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unanswered", label: "Needs a response" },
            { value: "answered", label: "Responded" },
          ]}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 pb-7 sm:px-6">
        <SectionRule
          label="This week"
          action={{ label: "Set up the Google connection", href: "/admin/integrations" }}
        />

        {/*
          FOUR MEASURES, ONE ROW, IN THE ARTIFACT'S ORDER. Unanswered first and
          coral; gained second with its meter; then rating; then attention.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/*
            THE ONLY CORAL TILE ON THE PAGE, and the only one with a button.
            "It is the one thing on this page a Salon Director can fix today."

            IT IS THE DEEPER CORAL RATHER THAN THE ARTIFACT'S LITERAL #ef6079.
            White on that fill measures 3.17:1, and this tile carries an 8px
            caps label and a button label — small text, which needs 4.5:1. The
            deeper coral the system already holds gives 5.02:1 and reads as the
            same tile. Recorded in `globals.css` beside the derivation.
          */}
          <div className="rounded-[var(--radius-lg)] bg-status-under p-[18px] shadow-attention">
            <p className="eyebrow text-status-under-foreground opacity-90">
              Need a response
            </p>
            <p className="display-figure mt-2 text-[36px] text-status-under-foreground">
              {unanswered.length}
            </p>
            <p className="mt-1.5 text-[10.5px] leading-snug text-status-under-foreground opacity-90">
              {oldest
                ? `Oldest is a ${oldest.rating}-star, ${
                    daysAgo(oldest.postedAt) === 0
                      ? "today"
                      : `${daysAgo(oldest.postedAt)} day${daysAgo(oldest.postedAt) === 1 ? "" : "s"} out`
                  }`
                : "Every review in view has a reply"}
            </p>
            {unanswered.length > 0 ? (
              /* Near-black, not white-on-coral: pressing and alarming must not
                 look alike, so the action inside an alarm is the near-black. */
              <a
                href="#response-queue"
                className="pill-action mt-3 bg-chrome text-primary-foreground"
              >
                Open the queue
              </a>
            ) : null}
          </div>

          <MeasureTile
            label="Reviews gained"
            value={`${totals.gained >= 0 ? "+" : ""}${formatNumber(totals.gained)}`}
            detail={`${totals.change >= 0 ? "+" : ""}${totals.change} versus last week`}
            meter={{
              value: totals.goal > 0 ? (totals.gained / totals.goal) * 100 : 0,
              caption: `${formatNumber(totals.gained)} of ${formatNumber(totals.goal)} combined weekly goal`,
            }}
          />

          <MeasureTile
            label="Average rating"
            value={totals.rating.toFixed(2)}
            detail={`Across ${metrics.length} ${metrics.length === 1 ? "salon" : "salons"} · ${formatNumber(totals.total)} reviews total`}
            adornment={<Stars rating={totals.rating} />}
          />

          <MeasureTile
            label="Salons needing attention"
            value={String(attention.length)}
            detail={`Under 60% of goal or below a ${RATING_FLOOR} rating`}
            list={
              attention.length > 0 ? (
                /*
                  EVERY SALON THE MEASURE COUNTS, not the first three. This is
                  the artifact's reported contradiction, fixed at the root: the
                  count and the list read the same array.
                */
                <ul className="mt-2.5 space-y-1 border-t border-border-hairline pt-2.5">
                  {attention.map((metric) => (
                    <li
                      key={metric.locationId}
                      className="flex items-baseline justify-between gap-2 text-[11px]"
                    >
                      <span className="truncate text-foreground">
                        {metric.locationName}
                      </span>
                      <span className="shrink-0 font-bold text-measure-flagged-foreground tabular-nums">
                        {reviewGoalProgress(metric)}% · {metric.averageRating.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 border-t border-border-hairline pt-2.5 text-[11px] text-muted-foreground">
                  Every salon is tracking well this week.
                </p>
              )
            }
          />
        </div>

        {/* ------------------------------------------------ response queue -- */}
        <SectionRule label="Needs a response" />
        <p className="-mt-2 text-[11.5px] text-muted-foreground">
          Critical and unanswered first, then oldest. A 2-star sitting three days
          is worse than a 3-star sitting two.
        </p>
        <div id="response-queue" className="flex flex-col gap-2.5">
          {reviews.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-8 text-center text-[13px] text-muted-foreground shadow-soft">
              No review matches the current filters.
            </p>
          ) : (
            reviews.map((review) => (
              <ReviewRow key={review.id} review={review} />
            ))
          )}
        </div>

        {/* -------------------------------------------------------- trend -- */}
        <SectionRule label="Twelve weeks" />
        <ChartFrame
          title="Reviews gained, twelve weeks"
          description={`Every salon, not the selected district — there is one aggregate series behind this. The dashed line is the ${formatNumber(chainGoal)} combined weekly goal.`}
          height={240}
        >
          <ResponsiveContainer width="100%" height="100%">
            {/*
              BARS, NOT AN AREA. Twelve discrete weekly counts are twelve
              measurements, and the area chart's monotone curve drew values
              between them that were never recorded. The artifact draws twelve
              columns with the goal across them, which is also what makes "one
              week in twelve cleared it" readable at a glance.
            */}
            <BarChart data={DEMO_REVIEW_TREND} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} width={36} />
              <RechartsTooltip
                cursor={{ fill: "var(--surface-muted)" }}
                content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
              />
              {/*
                THE GOAL, DRAWN ON THE CHART — the artifact's fifth item: "With
                185 drawn across it, the story stops being '−2 this week' and
                becomes 'one week in twelve cleared it' — which is a
                conversation rather than a number."

                The deepened yellow rather than the brand yellow: at 1.47:1 the
                brand yellow is invisible on white, and this rule has to be read.
              */}
              <ReferenceLine
                y={chainGoal}
                stroke="var(--measure-goal)"
                strokeWidth={2}
                strokeDasharray="5 4"
                label={{
                  value: `Goal ${formatNumber(chainGoal)}`,
                  position: "insideTopRight",
                  fill: "var(--measure-goal-foreground)",
                  fontSize: 9.5,
                  fontWeight: 900,
                }}
              />
              <Bar dataKey="gained" name="Reviews gained" radius={[4, 4, 0, 0]} maxBarSize={44}>
                {DEMO_REVIEW_TREND.map((week, index) => (
                  /*
                    THE CURRENT WEEK IS THE NEAR-BLACK. Eleven weeks of history
                    in the data colour and "this week" picked out, so a reader
                    finds the figure the tiles above are talking about without
                    counting columns. Not a second data colour — it is the same
                    marker treatment the report tabs use for a named comparison.
                  */
                  <Cell
                    key={week.label}
                    fill={
                      index === DEMO_REVIEW_TREND.length - 1
                        ? CHART_COLORS.benchmark
                        : CHART_COLORS.primary
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        {/* -------------------------------------------------- leaderboard -- */}
        <SectionRule label="Salon leaderboard" />
        <ScrollTable>
          <table className="data-table min-w-[52rem]">
            <thead>
              <tr>
                <th scope="col">Salon</th>
                <th scope="col" data-align="right">
                  This week
                </th>
                <th scope="col" data-align="right">
                  Total
                </th>
                <th scope="col" data-align="right">
                  Rating
                </th>
                <th scope="col" data-align="right">
                  Goal
                </th>
                <th scope="col">Progress</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...metrics]
                .sort((a, b) => reviewGoalProgress(b) - reviewGoalProgress(a))
                .map((metric) => {
                  const progress = reviewGoalProgress(metric);
                  const delta = metric.reviewsGainedThisWeek - metric.reviewsGainedLastWeek;
                  const sentiment = weekSentiment(delta);
                  const status = reviewStatus(metric);
                  return (
                    <tr
                      key={metric.locationId}
                      className={cn(
                        highlightId === metric.locationId && "bg-brand-yellow-soft",
                      )}
                    >
                      <td>
                        <span className="block text-[12px] font-bold text-foreground">
                          {metric.locationName}
                        </span>
                        <span className="block text-[10.5px] text-muted-foreground">
                          {metric.districtName}
                        </span>
                      </td>
                      <td data-align="right">
                        <span className="text-[13px] font-black text-foreground">
                          +{metric.reviewsGainedThisWeek}
                        </span>
                        <span
                          className={cn(
                            "ml-1.5 text-[10px] font-black",
                            sentiment === "good" && "text-delta-up",
                            sentiment === "bad" && "text-measure-flagged-foreground",
                            sentiment === "neutral" && "text-muted-foreground",
                          )}
                        >
                          {delta >= 0 ? "+" : ""}
                          {delta}
                        </span>
                      </td>
                      <td data-align="right">{formatNumber(metric.totalReviews)}</td>
                      <td data-align="right">
                        {/* Under the floor the rating itself turns coral, which
                            is the artifact's fourth item: "Ratings under 4.5
                            turn coral in the rating column too." */}
                        <span
                          className={cn(
                            "text-[12.5px] font-black",
                            metric.averageRating < RATING_FLOOR
                              ? "text-measure-flagged-foreground"
                              : "text-foreground",
                          )}
                        >
                          {metric.averageRating.toFixed(1)}
                        </span>
                      </td>
                      <td data-align="right">{metric.weeklyGoal}</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="relative block h-[13px] w-[104px] shrink-0 rounded-[4px] bg-surface-muted"
                          >
                            <span
                              className={cn(
                                "absolute inset-y-0 left-0 rounded-r-[4px]",
                                status.tone === "under"
                                  ? "bg-measure-data"
                                  : status.tone === "belowMarket"
                                    ? "bg-status-below-market"
                                    : "bg-status-outperforming",
                              )}
                              style={{ width: `${Math.max(2, progress)}%` }}
                            />
                          </span>
                          <span className="text-[11px] font-black tabular-nums">
                            {progress}%
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </ScrollTable>

        <Notice tone="neutral" icon={<Info />}>
          <p className="font-semibold text-foreground">How this becomes automatic</p>
          <p className="mt-1">
            Connecting the Google Business Profile API pulls review counts and
            ratings for every location on a schedule, and &ldquo;reviews
            gained&rdquo; is simply the difference between two pulls. Nothing is
            scraped, and nothing is connected in this prototype — every figure
            here is demo data.
          </p>
        </Notice>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href="/admin/integrations">
              Set up Google Business Profile
              <ArrowUpRight />
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/chat?q=How%20do%20I%20ask%20a%20guest%20for%20a%20Google%20review%3F">
              <MessageSquare />
              Ask Sunny how to ask for reviews
            </Link>
          </Button>
        </div>

        <DemoDataNote />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- the parts -- */

/**
 * The band's ask bar, scoped to the oldest unanswered review.
 *
 * IT ANSWERS HERE, for the reason reported about the report tabs' bar: being
 * thrown to a different screen means reading the answer with the queue no
 * longer on it. Same shared `useInlineAsk` send path, so a reply drafted here is
 * a real chat turn in the same history and audit trail — and `AnswerSheet` still
 * offers "Continue in Ask Sunny" on the newest exchange, adopting the SAME
 * conversation, so the hand-off is a choice rather than the only route.
 *
 * IT CARRIES NO FIGURES, only the salon name and the rating that identify which
 * review to draft a reply to.
 */
function ReviewsAskBar({ review }: { review?: CustomerReview }) {
  const question = review
    ? `Draft a reply to the ${review.rating}-star review at ${review.locationName}, and tell me what to coach the Salon Director on.`
    : "How should we work the Google review queue this week, and what should I coach?";

  const [value, setValue] = useState("");
  const { send, busy, conversationId, exchanges, reset } = useInlineAsk();

  const submit = (text: string) => {
    const asked = text.trim() || question;
    setValue("");
    void send(asked);
  };

  const newestFirst = [...exchanges].reverse();

  return (
    <div>
      <div className="flex items-center gap-3 rounded-[14px] bg-surface py-2.5 pr-3 pl-4 shadow-ask focus-within:shadow-ask-focus">
        <SunMark className="size-6 shrink-0" onDark />
        <label htmlFor="reviews-ask" className="sr-only">
          Ask Sunny about reviews
        </label>
        <textarea
          id="reviews-ask"
          rows={1}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(value);
            }
          }}
          placeholder={`Ask Sunny about reviews — ${question}`}
          className="scroll-slim max-h-24 min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-snug text-foreground placeholder:text-placeholder-foreground focus-visible:outline-none"
        />
        {conversationId ? (
          <button
            type="button"
            onClick={reset}
            aria-label="Clear this conversation"
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => submit(value)}
          disabled={busy}
          aria-label="Ask Sunny about reviews"
          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-brand-yellow text-brand-yellow-foreground transition-opacity disabled:opacity-40"
        >
          <ArrowUp className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>

      {busy ? (
        <p
          className="mt-2.5 flex items-center gap-2.5 text-[11px] text-band-muted-foreground"
          aria-live="polite"
        >
          <span className="flex items-center gap-1" aria-hidden>
            {[1, 0.55, 0.28].map((opacity, index) => (
              <span
                key={index}
                className="size-1.5 rounded-full bg-brand-yellow"
                style={{
                  opacity,
                  animation: "sunny-pulse-dot 1.1s ease-in-out infinite",
                  animationDelay: `${index * 0.16}s`,
                }}
              />
            ))}
          </span>
          Reading the review queue
        </p>
      ) : null}

      {/* The answer on paper, on the band — never prose printed on near-black. */}
      {conversationId && newestFirst.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-raised">
          {newestFirst.map((exchange, index) => (
            <div key={exchange.question.id}>
              <div className="flex flex-wrap items-baseline gap-2.5 border-b border-border-row px-5 pt-4 pb-3">
                <span className="eyebrow shrink-0">You asked</span>
                <span className="min-w-0 flex-1 text-[13.5px] font-bold text-foreground">
                  {exchange.question.content}
                </span>
              </div>
              {exchange.answer ? (
                <AnswerSheet
                  message={exchange.answer}
                  conversationId={conversationId}
                  onDismiss={reset}
                  onAsk={(next) => submit(next)}
                  showContinue={index === 0}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}


/** A white measure tile: micro-label, display figure, sub-copy, and a meter. */
function MeasureTile({
  label,
  value,
  detail,
  meter,
  adornment,
  list,
}: {
  label: string;
  value: string;
  detail: string;
  meter?: { value: number; caption: string };
  adornment?: React.ReactNode;
  list?: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-[18px] shadow-raised">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="display-figure text-[36px] text-foreground">{value}</span>
        {adornment}
      </p>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{detail}</p>
      {meter ? (
        <>
          <span
            aria-hidden
            className="mt-2.5 block h-1.5 overflow-hidden rounded-[4px] bg-measure-track"
          >
            <span
              className="block h-full bg-measure-benchmark"
              style={{ width: `${Math.min(100, Math.max(0, meter.value))}%` }}
            />
          </span>
          <p className="mt-1.5 text-[10px] text-subtle-foreground tabular-nums">
            {meter.caption}
          </p>
        </>
      ) : null}
      {list}
    </div>
  );
}

/**
 * ONE REVIEW IN THE QUEUE.
 *
 * Three columns — the rating, the review, the action — and a 5px coral left edge
 * on anything still unanswered, so the work is visible while scrolling rather
 * than only once each card is read. An answered review keeps its place in the
 * list with a quiet green confirmation rather than disappearing: a Salon
 * Director checking her own work needs to see it.
 */
function ReviewRow({ review }: { review: CustomerReview }) {
  const critical = review.rating <= 3;
  return (
    <article
      className={cn(
        "grid grid-cols-1 gap-3 rounded-[14px] border border-border bg-surface px-4 py-3.5 shadow-soft sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:gap-4",
        !review.responded && "border-l-[5px] border-l-measure-data",
      )}
    >
      <div>
        <p
          className={cn(
            "text-[13px] font-black whitespace-nowrap",
            critical ? "text-measure-flagged-foreground" : "text-foreground",
          )}
        >
          {review.rating} ★
        </p>
        <p className="eyebrow mt-0.5">
          {review.responded ? "Answered" : critical ? "Critical" : "Open"}
        </p>
        <span className="sr-only">{review.rating} out of 5 stars</span>
      </div>
      <div className="min-w-0">
        <p className="text-[12.5px] leading-relaxed text-body-foreground">
          {review.text}
        </p>
        <p className="mt-1.5 text-[10.5px] text-muted-foreground">
          <span className="font-bold text-foreground">{review.authorName}</span> ·{" "}
          {review.locationName}
        </p>
      </div>
      <div className="sm:text-right">
        {review.responded ? (
          <p className="text-[8.5px] font-black tracking-[0.08em] whitespace-nowrap text-delta-up uppercase">
            ✓ Responded
          </p>
        ) : (
          <Link
            href={`/chat?q=${encodeURIComponent(
              `Draft a reply to this ${review.rating}-star Google review at ${review.locationName} from ${review.authorName}: "${review.text}"`,
            )}`}
            className="pill-action bg-selected text-selected-foreground transition-colors hover:bg-selected-hover"
          >
            Draft a reply
          </Link>
        )}
        <p className="mt-1.5 text-[10px] whitespace-nowrap text-muted-foreground">
          {relativeTime(review.postedAt)}
        </p>
      </div>
    </article>
  );
}

/**
 * A filter pill that wraps a real `<select>`.
 *
 * THE NATIVE CONTROL, DELIBERATELY. The reports' filter menus are multi-select
 * popovers because a manager ticks six salons at once; these three are
 * single-choice, where a native select is better on a phone, needs no
 * JavaScript to open, and is already keyboard- and screen-reader-correct. The
 * capsule, the micro-label and the bold value are the artifact's filter chip;
 * the select sits transparently over the whole pill, so the pill is the hit
 * area and the label underneath is what is actually read.
 *
 * A RAW `<select>` RATHER THAN THE SHARED `Select`, and this was found in
 * visual QA. That component renders its own `relative` wrapper and an
 * absolutely positioned chevron as a SIBLING of the select — so making the
 * select transparent left the chevron painted over the value, which showed up
 * as a stray glyph inside every pill. Its chrome is right for a form field and
 * wrong for a chip, so the chip draws its own.
 */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== "all";
  const current = options.find((option) => option.value === value)?.label ?? "";

  return (
    <span
      className={cn(
        "relative inline-flex items-baseline gap-1.5 rounded-[22px] border px-3.5 py-[7px] text-[11.5px] shadow-soft transition-colors",
        active
          ? "border-selected bg-selected text-selected-foreground"
          : "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
      )}
    >
      <span
        className={cn(
          "eyebrow shrink-0",
          active ? "text-selected-foreground opacity-70" : "text-subtle-foreground",
        )}
      >
        {label}
      </span>
      <span className="font-bold whitespace-nowrap">{current}</span>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-3 shrink-0 self-center opacity-60"
      >
        <path
          d="M4 6.5 8 10.5 12 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
