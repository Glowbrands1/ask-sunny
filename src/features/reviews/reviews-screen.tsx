import Link from "next/link";
import { Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { ScrollTable } from "@/components/ui/layout";
import {
  ProvenanceChip,
  ProvenanceChips,
  SectionRule,
  StatusChip,
  type StatusTone,
} from "@/components/ui/marquee";
import { ReportBand } from "@/features/reports/report-frame";
import { reviewSetupHref, reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import { formatWeekRange } from "@/lib/reviews/reporting-week";
import type {
  DashboardReview,
  DistrictRollup,
  LocationRollup,
  ReviewSummary,
} from "@/lib/reviews/types";
import type { ReviewFeed as ReviewFeedData, ReviewsSnapshot } from "@/lib/reviews/queries";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { ReviewDetail } from "./review-detail";
import { ReviewFeed } from "./review-feed";
import { ReviewsAskBar } from "./reviews-ask-bar";
import { ReviewsFilterBar } from "./reviews-filter-bar";
import { ReviewsTrend } from "./reviews-trend";
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
 * and the feed below it is rendered by the same filters. There is no second
 * query written to resemble the first — the number and the list come from one
 * predicate, so they cannot disagree.
 *
 * That is also why the filters live in the URL: a drill-down IS a filter, a
 * filtered view is a link somebody can send, and the page is server-rendered so
 * the filters have to arrive with the request.
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
 * A LISTING WITH NO ANCHOR IS COUNTING NOTHING, and the page says so at the
 * top. A salon that is unmeasured must not read as a salon that had a quiet
 * week.
 *
 * ============================================================================
 * WHAT IS NOT ON THIS PAGE, AND WHY
 * ============================================================================
 *
 * A WEEKLY GOAL PER SALON. The seeded screen carried one and it was invented:
 * nothing in Supabase holds a review goal, and a progress bar against a number
 * nobody agreed to is a figure a manager would quote in a meeting. When the
 * business sets goals they arrive as data and the meter comes back with them.
 *
 * GOOGLE'S LIFETIME REVIEW COUNT. The Business Profile page does not expose a
 * per-listing lifetime total in a form this parser can read, so "Total" here
 * means reviews ASK SUNNY HOLDS and is labelled that way. Printing a number
 * captioned "total reviews" that is not Google's total would be worse than not
 * printing one.
 */

export function ReviewsScreen({
  filters,
  snapshot,
  feed,
  openReview,
  canManageAnchors = false,
}: {
  filters: ReviewFilters;
  snapshot: ReviewsSnapshot;
  feed: ReviewFeedData;
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
  const { summary, locations, districts } = snapshot;

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

  return (
    <div className="min-w-0">
      <ReportBand
        title="Google Reviews"
        description={
          scoped
            ? `Real Google reviews for ${scoped}, from the Google Business Profile sync`
            : "Real Google reviews across all fifteen Sun Tan City locations, from the Google Business Profile sync"
        }
        provenance={
          <ProvenanceChips>
            <ProvenanceChip emphasis>
              Week of {formatWeekRange(snapshot.currentWeek)}
            </ProvenanceChip>
            <ProvenanceChip>
              {locations.length} {locations.length === 1 ? "location" : "locations"}
            </ProvenanceChip>
            <ProvenanceChip>
              {districts.length} {districts.length === 1 ? "district" : "districts"}
            </ProvenanceChip>
            <ProvenanceChip>
              {snapshot.lastSyncAt
                ? `Last sync ${new Date(snapshot.lastSyncAt).toLocaleString()}`
                : "No sync recorded yet"}
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

      <ReviewsFilterBar
        filters={filters}
        districts={snapshot.districtOptions}
        locations={snapshot.locationOptions}
        weekStarts={snapshot.weekStarts}
      />

      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 pb-7 sm:px-6">
        {snapshot.empty ? <NothingSyncedYet /> : null}

        {snapshot.awaitingAnchor.length > 0 ? (
          <AwaitingAnchor
            listings={snapshot.awaitingAnchor}
            filters={filters}
            canManageAnchors={canManageAnchors}
          />
        ) : null}

        <SectionRule label="This reporting week" />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/*
            THE ONLY CORAL TILE ON THE PAGE. Unanswered leads because it is the
            one thing on this page a Salon Director can act on today — reviews
            gained is last week's work.
          */}
          <AlarmTile
            label="Need a response"
            value={summary.unanswered}
            detail={
              summary.criticalNeedingAttention > 0
                ? `${summary.criticalNeedingAttention} of them are 1 or 2 stars`
                : "No 1- or 2-star review is waiting"
            }
            href={reviewsHref({ ...filters, status: "needs_response", week: "all" })}
            actionLabel="Open the queue"
          />

          <MeasureTile
            label="Qualifying reviews this week"
            value={formatNumber(summary.qualifyingThisWeek)}
            detail={`3–5 stars counted into ${formatWeekRange(
              snapshot.currentWeek,
            )} · ${describeDelta(
              summary.qualifyingThisWeek,
              summary.qualifyingLastWeek,
            )}`}
            href={reviewsHref({
              ...filters,
              week: "current",
              qualifying: "yes",
              assignment: "counted",
            })}
          />

          <MeasureTile
            label="All new reviews this week"
            value={formatNumber(summary.allNewThisWeek)}
            detail={`Every rating counted into this period · ${
              summary.allNewThisWeek - summary.qualifyingThisWeek
            } of them do not raise the qualifying total`}
            href={reviewsHref({ ...filters, week: "current", assignment: "counted" })}
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MeasureTile
            label="1–2 star, needing attention"
            value={formatNumber(summary.criticalNeedingAttention)}
            detail="Stored and shown, and never counted toward the weekly total"
            href={reviewsHref({
              ...filters,
              rating: "1-2",
              status: "needs_response",
              week: "all",
            })}
            flagged={summary.criticalNeedingAttention > 0}
          />

          <MeasureTile
            label="Month to date"
            value={formatNumber(summary.monthToDate)}
            /*
              OVER PERIODS, NOT OVER DAYS, and the caption says so. Reporting
              weeks straddle month boundaries, so "counted between the 1st and
              today" is not a figure this model can produce honestly.
            */
            detail="Counted across the reporting weeks that began this month"
            href={reviewsHref({ ...filters, week: "all", assignment: "counted" })}
          />

          <MeasureTile
            label="Historical, counted nowhere"
            value={formatNumber(summary.historicalReviews)}
            detail={
              summary.historicalReviews === 0
                ? "Every review held is assigned to a reporting period"
                : "Imported backlog and anything whose place in the feed could not be proven. Visible, searchable, and in no weekly total."
            }
            href={reviewsHref({ ...filters, week: "all", assignment: "historical" })}
          />

          <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-[18px] shadow-raised sm:col-span-2">
            <p className="eyebrow">Reviews by rating</p>
            <RatingBreakdown byRating={summary.byRating} filters={filters} />
          </div>
        </div>

        {/* --------------------------------------------------------- trend -- */}
        <SectionRule label="Twelve weeks" />
        <ReviewsTrend trend={snapshot.trend} filters={filters} />

        {/* --------------------------------------------------- leaderboard -- */}
        <SectionRule
          label="Salon leaderboard"
          action={
            canManageAnchors
              ? { label: "Review baselines", href: reviewSetupHref() }
              : undefined
          }
        />
        <LocationTable
          locations={locations}
          filters={filters}
          canManageAnchors={canManageAnchors}
        />

        {/* ----------------------------------------------------- districts -- */}
        {districts.length > 0 ? (
          <>
            <SectionRule label="Districts" />
            <DistrictTable districts={districts} filters={filters} />
          </>
        ) : null}

        {/* ---------------------------------------------------------- feed -- */}
        <SectionRule label="Reviews" />
        <p className="-mt-2 text-[11.5px] text-muted-foreground">
          The actual review records behind every number above. Unanswered first, then
          the lowest rating, then the longest waiting.
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

        <Notice tone="neutral" icon={<Info />} title="Where this data comes from">
          <p>
            Reviews are read from the Google Business Profile Reviews page by the ASK
            Sunny Review Sync extension, in an authorized user&rsquo;s own signed-in
            Brave session, and filed through the ASK Sunny API. Nothing here handles a
            Google credential, and Google&rsquo;s own review id is the deduplication
            key — syncing the same page twice adds nothing. A review counts toward a
            week only where it sat above that salon&rsquo;s last-counted review, so an
            imported backlog never raises this week&rsquo;s number.
          </p>
        </Notice>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- parts -- */

function describeDelta(current: number, previous: number): string {
  const delta = current - previous;
  if (delta === 0) return "level with last week";
  return `${delta > 0 ? "+" : ""}${delta} versus last week`;
}

/**
 * THE LOUDEST THING ON THE PAGE WHEN IT APPEARS.
 *
 * A listing with no reporting anchor is not being counted, and the page must
 * say that rather than let fifteen zeroes read as a quiet week. It is an
 * expected state — every listing starts here, before anybody has said where
 * last week's count ended — so it is explained rather than reported as a fault.
 */
function AwaitingAnchor({
  listings,
  filters,
  canManageAnchors,
}: {
  listings: { storeCode: string; label: string; historical: number }[];
  filters: ReviewFilters;
  canManageAnchors: boolean;
}) {
  const held = listings.reduce((total, entry) => total + entry.historical, 0);

  return (
    <Notice
      tone="attention"
      icon={<Info />}
      title={`${listings.length} ${
        listings.length === 1 ? "location is" : "locations are"
      } not being counted yet`}
    >
      <p>
        A salon counts reviews from its <strong>reporting anchor</strong> — the last
        review already counted — upward. Until an anchor is set, everything synced for
        it is stored as history and raises no weekly total, which is what stops a
        year&rsquo;s backlog landing in the week it was imported.
        {held > 0 ? (
          <>
            {" "}
            <Link
              href={reviewsHref({ ...filters, week: "all", assignment: "historical" })}
              className="font-bold text-accent-foreground hover:underline"
            >
              {formatNumber(held)} held {held === 1 ? "review is" : "reviews are"}{" "}
              waiting
            </Link>
            .
          </>
        ) : null}
      </p>
      {/*
        EACH NAME IS A LINK STRAIGHT TO ITS OWN SETUP, for an administrator.
        The notice names the problem; without somewhere to go it would just be
        a recurring complaint, and the fix is two clicks away.
      */}
      <p className="mt-1.5 text-[12px]">
        Awaiting an anchor:{" "}
        {listings.map((entry, index) => (
          <span key={entry.storeCode}>
            {index > 0 ? ", " : ""}
            {canManageAnchors ? (
              <Link
                href={reviewSetupHref(entry.storeCode)}
                className="font-bold text-accent-foreground hover:underline"
              >
                {entry.label} ({entry.storeCode})
              </Link>
            ) : (
              `${entry.label} (${entry.storeCode})`
            )}
          </span>
        ))}
        .
      </p>
      {canManageAnchors ? (
        <p className="mt-2">
          <Link href={reviewSetupHref()} className="pill-action bg-selected text-selected-foreground hover:bg-selected-hover">
            Set review baselines
          </Link>
        </p>
      ) : null}
    </Notice>
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

function AlarmTile({
  label,
  value,
  detail,
  href,
  actionLabel,
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-status-under p-[18px] shadow-attention">
      <p className="eyebrow text-status-under-foreground opacity-90">{label}</p>
      <p className="display-figure mt-2 text-[36px] text-status-under-foreground">
        {formatNumber(value)}
      </p>
      <p className="mt-1.5 text-[10.5px] leading-snug text-status-under-foreground opacity-90">
        {detail}
      </p>
      {value > 0 ? (
        /* Near-black inside the alarm: pressing and alarming must not look alike. */
        <Link href={href} className="pill-action mt-3 bg-chrome text-primary-foreground">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function MeasureTile({
  label,
  value,
  detail,
  href,
  adornment,
  flagged,
}: {
  label: string;
  value: string;
  detail: string;
  href?: string;
  adornment?: React.ReactNode;
  flagged?: boolean;
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
  byRating,
  filters,
}: {
  byRating: ReviewSummary["byRating"];
  filters: ReviewFilters;
}) {
  const max = Math.max(1, ...byRating);

  return (
    <ul className="mt-2.5 space-y-1.5">
      {[5, 4, 3, 2, 1].map((rating) => {
        const count = byRating[rating - 1];
        const qualifying = rating >= 3;
        return (
          <li key={rating}>
            <Link
              href={reviewsHref({
                ...filters,
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
                      the data fill, so the split the weekly rule draws is
                      visible in the chart as well as stated in the caption.
                    */
                    qualifying ? "bg-measure-data" : "bg-status-under",
                  )}
                  style={{ width: `${Math.max(count === 0 ? 0 : 3, (count / max) * 100)}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-right text-[11px] font-black tabular-nums group-hover:underline">
                {formatNumber(count)}
              </span>
            </Link>
          </li>
        );
      })}
      <li className="pt-1 text-[10px] text-subtle-foreground">
        The 1- and 2-star bars are coral because those reviews never raise the official
        weekly count.
      </li>
    </ul>
  );
}

/**
 * A LISTING'S RUNG ON THE SHARED STATUS LADDER.
 *
 * The same four tones the report tabs use, so a chip means the same thing
 * wherever a DM sees it — but the PREDICATE is rebuilt for real data, because
 * the seeded screen's version read a weekly goal that does not exist.
 *
 * What it says instead is what the records can actually support: an open 1- or
 * 2-star review needs attention; anything else unanswered is behind; a listing
 * with everything answered is at goal; a listing with no reviews at all this
 * week is "quiet", which is a fact rather than a judgement.
 */
/**
 * ============================================================================
 * WHETHER THIS SALON IS BEING COUNTED, AND HOW TO FIX IT IF IT IS NOT
 * ============================================================================
 *
 * THE MOST IMPORTANT WORDS IN THE TABLE when the answer is no. A listing with
 * no anchor is not having a quiet week — it is not being counted at all, and
 * only saying so stops the zero beside it from being read as news about the
 * salon. For an administrator the sentence is also the way to resolve it: it
 * links to that listing's own baseline setup, with its picker already open.
 *
 * ONCE AN ANCHOR EXISTS IT SAYS SO BRIEFLY AND NAMES A PERSON. "Tracking active
 * · counting after Tarissa Barry" is what an operator needs to confirm the
 * boundary is where they left it. THE GOOGLE REVIEW ID IS NEVER RENDERED — it
 * is an internal key, it means nothing to a reader, and putting it on a screen
 * is how it starts being copied into emails and spreadsheets.
 *
 * THE LINK IS A LINK, not a control. Following it opens a page; it cannot move
 * an anchor, and no filter or sync action on this dashboard can either. Moving
 * one is a POST from the setup screen, made deliberately.
 */
function AnchorMarker({
  location,
  canManageAnchors,
}: {
  location: LocationRollup;
  canManageAnchors: boolean;
}) {
  if (location.anchorReviewId === null) {
    const text = "No anchor — counting nothing";
    return canManageAnchors ? (
      <Link
        href={reviewSetupHref(location.storeCode)}
        className="font-bold text-measure-flagged-foreground underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title={`Set the review baseline for ${location.locationName}`}
      >
        {text}
      </Link>
    ) : (
      <span className="font-bold text-measure-flagged-foreground">{text}</span>
    );
  }

  const label = location.anchorReviewer
    ? `Tracking active · counting after ${location.anchorReviewer}`
    : "Tracking active";

  return canManageAnchors ? (
    <Link
      href={reviewSetupHref(location.storeCode)}
      className="text-status-outperforming hover:underline"
      title={`Review the baseline for ${location.locationName}`}
    >
      {label}
    </Link>
  ) : (
    <span className="text-status-outperforming">{label}</span>
  );
}

function listingStatus(location: LocationRollup): { tone: StatusTone; label: string } {
  /*
   * NOT COUNTING comes FIRST, ahead of every performance state. A listing with
   * no anchor cannot be described as at goal or behind, because nothing about
   * its week has been measured — and a green chip on an unmeasured salon is the
   * page asserting something nobody has established.
   */
  if (location.anchorReviewId === null && location.total > 0) {
    return { tone: "capacity", label: "No anchor" };
  }
  if (location.criticalOpen > 0) return { tone: "under", label: "Needs attention" };
  if (location.unanswered > 0) return { tone: "belowMarket", label: "Replies waiting" };
  if (location.total === 0) return { tone: "capacity", label: "Nothing synced" };
  return { tone: "outperforming", label: "All answered" };
}

function LocationTable({
  locations,
  filters,
  canManageAnchors,
}: {
  locations: LocationRollup[];
  filters: ReviewFilters;
  canManageAnchors: boolean;
}) {
  const ordered = [...locations].sort(
    (a, b) =>
      b.qualifyingThisWeek - a.qualifyingThisWeek ||
      b.reviewsThisWeek - a.reviewsThisWeek ||
      a.locationName.localeCompare(b.locationName),
  );

  return (
    <ScrollTable>
      <table className="data-table min-w-[58rem]">
        <thead>
          <tr>
            <th scope="col">Salon</th>
            <th scope="col" data-align="right">Store code</th>
            <th scope="col" data-align="right">Qualifying this week</th>
            <th scope="col" data-align="right">All this week</th>
            <th scope="col" data-align="right">Last week</th>
            <th scope="col" data-align="right">Unanswered</th>
            <th scope="col" data-align="right">Average</th>
            <th scope="col" data-align="right">Historical</th>
            <th scope="col" data-align="right">Held</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((location) => {
            const status = listingStatus(location);
            return (
              <tr key={location.storeCode}>
                <td>
                  {/*
                    THE SALON NAME IS THE DRILL-DOWN. "KS Manhattan = 12 reviews
                    this week" opens exactly those twelve.
                  */}
                  <Link
                    href={reviewsHref({
                      ...filters,
                      storeCode: location.storeCode,
                      week: "current",
                    })}
                    className="block text-[12px] font-bold text-foreground hover:underline"
                  >
                    {location.locationName}
                  </Link>
                  <span className="block text-[10.5px] text-muted-foreground">
                    {location.district ?? "District not on record"}
                    {location.listingState === "verification_required"
                      ? " · Google verification required"
                      : ""}
                    {" · "}
                    <AnchorMarker location={location} canManageAnchors={canManageAnchors} />
                  </span>
                </td>
                <td data-align="right" className="tabular-nums">
                  {location.storeCode}
                </td>
                <td data-align="right">
                  <Link
                    href={reviewsHref({
                      ...filters,
                      storeCode: location.storeCode,
                      week: "current",
                      qualifying: "yes",
                    })}
                    className="text-[13px] font-black text-foreground hover:underline"
                  >
                    {location.qualifyingThisWeek}
                  </Link>
                </td>
                <td data-align="right">{location.reviewsThisWeek}</td>
                <td data-align="right">{location.lastWeek}</td>
                <td data-align="right">
                  {location.unanswered > 0 ? (
                    <Link
                      href={reviewsHref({
                        ...filters,
                        storeCode: location.storeCode,
                        status: "needs_response",
                        week: "all",
                      })}
                      className={cn(
                        "font-black hover:underline",
                        location.criticalOpen > 0
                          ? "text-measure-flagged-foreground"
                          : "text-foreground",
                      )}
                    >
                      {location.unanswered}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td data-align="right">
                  <span
                    className={cn(
                      "text-[12.5px] font-black",
                      location.averageRating !== null && location.averageRating < 4.5
                        ? "text-measure-flagged-foreground"
                        : "text-foreground",
                    )}
                  >
                    {location.averageRating === null
                      ? "—"
                      : location.averageRating.toFixed(2)}
                  </span>
                </td>
                <td data-align="right">
                  {location.historical > 0 ? (
                    <Link
                      href={reviewsHref({
                        ...filters,
                        storeCode: location.storeCode,
                        week: "all",
                        assignment: "historical",
                      })}
                      className="text-muted-foreground hover:underline"
                    >
                      {formatNumber(location.historical)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td data-align="right">{formatNumber(location.total)}</td>
                <td>
                  <StatusChip tone={status.tone}>{status.label}</StatusChip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollTable>
  );
}

function DistrictTable({
  districts,
  filters,
}: {
  districts: DistrictRollup[];
  filters: ReviewFilters;
}) {
  return (
    <ScrollTable>
      <table className="data-table min-w-[40rem]">
        <thead>
          <tr>
            <th scope="col">District</th>
            <th scope="col" data-align="right">Salons</th>
            <th scope="col" data-align="right">Qualifying this week</th>
            <th scope="col" data-align="right">All this week</th>
            <th scope="col" data-align="right">Unanswered</th>
            <th scope="col" data-align="right">Average</th>
            <th scope="col" data-align="right">Held</th>
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
                    week: "current",
                  })}
                  className="text-[12px] font-bold text-foreground hover:underline"
                >
                  {district.district}
                </Link>
              </td>
              <td data-align="right">{district.locations}</td>
              <td data-align="right" className="font-black">
                {district.qualifyingThisWeek}
              </td>
              <td data-align="right">{district.reviewsThisWeek}</td>
              <td data-align="right">{district.unanswered}</td>
              <td data-align="right">
                {district.averageRating === null ? "—" : district.averageRating.toFixed(2)}
              </td>
              <td data-align="right">{formatNumber(district.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}
