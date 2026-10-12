"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { DEMO_CUSTOMER_REVIEWS, DEMO_REVIEW_METRICS } from "@/data/demo/reviews";
import { PRODUCTION_SALONS } from "@/data/salons";
import { districtRollups } from "@/lib/reviews/aggregate";
import {
  parseReviewFilters,
  ratingBounds,
  WEEK_ALL,
  WEEK_CURRENT,
  WEEK_MONTH,
  type ReviewFilters,
} from "@/lib/reviews/filters";
import { DEFAULT_MONTHLY_REVIEW_GOAL, goalContext, isCounting } from "@/lib/reviews/goal";
import type { ReviewFeed, ReviewsSnapshot } from "@/lib/reviews/queries";
import { ratingDistribution } from "@/lib/reviews/rating-distribution";
import { currentWeekStart, recentWeekStarts, weekEndOf } from "@/lib/reviews/reporting-week";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import { buildReviewTimeline } from "@/lib/reviews/timeline";
import { googleReviewsToday } from "@/lib/reviews/timezone";
import type { DashboardReview, LocationRollup, ReviewSummary } from "@/lib/reviews/types";
import { shiftDays } from "@/lib/business-date";
import { DEMO_ANCHOR } from "@/lib/utils/date";
import { ReviewsScreen } from "./reviews-screen";

/**
 * ============================================================================
 * THE GOOGLE REVIEWS PAGE IN A DEMO DEPLOYMENT — THE LIVE SCREEN, SEEDED
 * ============================================================================
 *
 * A demo deployment never holds the privileged Supabase key (see
 * `DemoModeRefusesPrivilegedKeyError`), so `/reviews` cannot read a single
 * review and renders this instead, under a notice saying the content is
 * invented.
 *
 * IT USED TO BE A SEPARATE, HAND-DRAWN COPY of the dashboard — its own tiles,
 * its own leaderboard and its own weekly goal — and that is how a preview of
 * the October 2026 redesign showed the OLD page: the live screen had changed
 * and this copy had not. So there is no copy any more. This file turns the
 * seeded figures into the same `ReviewsSnapshot`, feed and timeline the server
 * builds from Supabase, and hands them to `ReviewsScreen` itself. Every view,
 * column, tile and control is the live one by construction; only the numbers
 * are invented.
 *
 * Only `lib/demo/runtime.demo.ts` names this module, so a production build
 * never emits it or the seeded data it imports.
 */

/** Salon number → Google store code, from the verified mapping. */
const STORE_CODE_BY_SALON = new Map(
  GOOGLE_REVIEW_LOCATIONS.map((entry) => [entry.salonNumber, entry] as const),
);

function demoLocations(): LocationRollup[] {
  const rows: LocationRollup[] = [];
  for (const salon of PRODUCTION_SALONS) {
    const listing = STORE_CODE_BY_SALON.get(salon.salonNumber);
    const figures = DEMO_REVIEW_METRICS.find((row) => row.salonNumber === salon.salonNumber);
    if (!listing || !figures) continue;
    rows.push({
      storeCode: listing.storeCode,
      locationName: salon.name,
      district: salon.districtName,
      salonNumber: salon.salonNumber,
      listingState: listing.verificationRequired ? "verification_required" : "verified",
      anchorReviewId: figures.counting ? `DEMOANCHOR${salon.salonNumber}` : null,
      anchorReviewer: null,
      historical: figures.historical,
      reviewsThisWeek: figures.qualifyingThisWeek,
      qualifyingThisWeek: figures.qualifyingThisWeek,
      lastWeek: figures.qualifyingLastWeek,
      qualifyingLastWeek: figures.qualifyingLastWeek,
      qualifyingMonthToDate: figures.qualifyingMonthToDate,
      unanswered: 0,
      criticalOpen: 0,
      averageRating: figures.averageRating,
      total: figures.held,
    });
  }
  return rows;
}

/**
 * The seeded customer reviews as review records, moved from the demo clock to
 * today so they land in this week and this month like real ones would.
 */
function demoReviews(today: string, currentWeek: string): DashboardReview[] {
  const shiftMs = new Date(`${today}T17:00:00Z`).getTime() - new Date(DEMO_ANCHOR).getTime();
  return DEMO_CUSTOMER_REVIEWS.flatMap((review) => {
    const salonNumber = review.locationId.replace(/^loc-/, "");
    const listing = STORE_CODE_BY_SALON.get(salonNumber);
    const salon = PRODUCTION_SALONS.find((entry) => entry.salonNumber === salonNumber);
    if (!listing || !salon) return [];
    const seenAt = new Date(new Date(review.postedAt).getTime() + shiftMs).toISOString();
    const seenWeek = currentWeekStart(seenAt.slice(0, 10));
    const periodStart = seenWeek < currentWeek ? shiftDays(currentWeek, -7) : currentWeek;
    return [
      {
        id: review.id,
        source: "google_business_profile",
        externalReviewId: `DEMO${review.id}`,
        storeCode: listing.storeCode,
        salonNumber,
        locationName: salon.name,
        district: salon.districtName,
        websiteUrl: null,
        listingState: listing.verificationRequired ? "verification_required" : "verified",
        reviewerName: review.authorName,
        rating: review.rating,
        reviewText: review.text,
        relativeDateText: null,
        googleAbsoluteDate: seenAt,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        hasOwnerResponse: review.responded,
        ownerResponseText: null,
        ownerResponseDateText: null,
        responseStatus: review.responded ? "responded" : "needs_response",
        eligibleForWeeklyCount: review.rating >= 3,
        reportingPeriodId: `demo-${periodStart}`,
        reportingAssignmentStatus: "anchor_assigned",
        periodStart,
        periodEnd: weekEndOf(periodStart),
        firstSeenWeek: seenWeek,
        googleEstimatedAt: null,
        parserVersion: "demo",
      } satisfies DashboardReview,
    ];
  });
}

/** The feed's own predicate, applied in memory to the seeded records. */
function matchesFeed(review: DashboardReview, filters: ReviewFilters, today: string): boolean {
  if (filters.district && review.district !== filters.district) return false;
  if (filters.storeCode && review.storeCode !== filters.storeCode) return false;
  const bounds = ratingBounds(filters.rating);
  if (bounds && (review.rating < bounds.min || review.rating > bounds.max)) return false;
  if (filters.status !== "all" && review.responseStatus !== filters.status) return false;
  if (filters.qualifying !== "all" && review.eligibleForWeeklyCount !== (filters.qualifying === "yes")) {
    return false;
  }
  if (filters.week === WEEK_CURRENT && review.periodStart !== currentWeekStart(today)) return false;
  if (filters.week === WEEK_MONTH && review.firstSeenAt.slice(0, 7) !== today.slice(0, 7)) return false;
  if (filters.week !== WEEK_ALL && filters.week !== WEEK_CURRENT && filters.week !== WEEK_MONTH) {
    if (review.periodStart !== filters.week) return false;
  }
  if (filters.assignment === "historical") return false;
  if (filters.search) {
    const term = filters.search.toLowerCase();
    const haystack = `${review.reviewerName} ${review.reviewText ?? ""} ${review.locationName}`;
    if (!haystack.toLowerCase().includes(term)) return false;
  }
  return true;
}

export function ReviewsDemoScreen() {
  const params = useSearchParams();

  const props = useMemo(() => {
    const filters = parseReviewFilters(Object.fromEntries(params.entries()));
    const today = googleReviewsToday();
    const currentWeek = currentWeekStart(today);
    const goal = goalContext(today, DEFAULT_MONTHLY_REVIEW_GOAL);

    const all = demoLocations();
    const locations = all.filter(
      (entry) =>
        (!filters.district || entry.district === filters.district) &&
        (!filters.storeCode || entry.storeCode === filters.storeCode),
    );
    const counting = locations.filter(isCounting);

    const reviews = demoReviews(today, currentWeek);
    const inScope = reviews.filter((review) =>
      matchesFeed(review, { ...filters, rating: "all", status: "all", qualifying: "all", week: WEEK_ALL, assignment: "all", search: null }, today),
    );
    const unanswered = inScope.filter((review) => review.responseStatus === "needs_response");

    const feedRows = reviews
      .filter((review) => matchesFeed(review, filters, today))
      .sort(
        (a, b) =>
          a.responseStatus.localeCompare(b.responseStatus) ||
          a.rating - b.rating ||
          b.firstSeenAt.localeCompare(a.firstSeenAt),
      );
    const feed: ReviewFeed = { reviews: feedRows, total: feedRows.length, truncated: false };

    const held = locations.reduce((sum, entry) => sum + entry.total, 0);
    const ratingSum = locations.reduce((sum, entry) => sum + (entry.averageRating ?? 0) * entry.total, 0);
    const sum = (pick: (entry: LocationRollup) => number) =>
      counting.reduce((total, entry) => total + pick(entry), 0);

    const summary: ReviewSummary = {
      periodId: `demo-${currentWeek}`,
      weekStart: currentWeek,
      weekEnd: weekEndOf(currentWeek),
      qualifyingThisWeek: sum((entry) => entry.qualifyingThisWeek),
      allNewThisWeek: sum((entry) => entry.reviewsThisWeek),
      criticalNeedingAttention: unanswered.filter((review) => review.rating <= 2).length,
      unanswered: unanswered.length,
      averageRating: held === 0 ? null : ratingSum / held,
      averageRatingThisWeek: null,
      byRating: [0, 0, 0, 0, 0],
      monthToDate: sum((entry) => entry.qualifyingMonthToDate),
      qualifyingLastWeek: sum((entry) => entry.qualifyingLastWeek),
      allNewLastWeek: sum((entry) => entry.lastWeek),
      totalReviews: held,
      historicalReviews: locations.reduce((total, entry) => total + entry.historical, 0),
      listingsWithoutAnchor: locations.length - counting.length,
    };

    const snapshot: ReviewsSnapshot = {
      empty: false,
      summary,
      trend: [],
      locations,
      districts: districtRollups(locations),
      districtOptions: [...new Set(all.map((entry) => entry.district).filter((d): d is string => Boolean(d)))].sort(),
      locationOptions: all.map((entry) => ({
        storeCode: entry.storeCode,
        label: entry.locationName,
        district: entry.district,
      })),
      verificationRequired: all
        .filter((entry) => entry.listingState === "verification_required")
        .map((entry) => ({ storeCode: entry.storeCode, label: entry.locationName })),
      awaitingAnchor: all
        .filter((entry) => !isCounting(entry))
        .map((entry) => ({ storeCode: entry.storeCode, label: entry.locationName, historical: entry.historical })),
      weekStarts: recentWeekStarts(12, today),
      currentWeek,
      previousWeek: shiftDays(currentWeek, -7),
      lastSyncAt: null,
      goal,
    };

    const perStar = [1, 2, 3, 4, 5].map(
      (star) => inScope.filter((review) => review.rating === star).length,
    );

    return {
      filters,
      snapshot,
      feed,
      timeline: {
        ...buildReviewTimeline(
          inScope.map((review) => ({
            googleAbsoluteDate: review.googleAbsoluteDate,
            googleEstimatedAt: null,
            firstSeenAt: review.firstSeenAt,
          })),
        ),
        truncated: false,
      },
      ratingDistribution: ratingDistribution(perStar),
    };
  }, [params]);

  return (
    <ReviewsScreen
      filters={props.filters}
      snapshot={props.snapshot}
      feed={props.feed}
      timeline={props.timeline}
      ratingDistribution={props.ratingDistribution}
      openReview={null}
      /* No baseline setup exists behind a demo; its links would only bounce. */
      canManageAnchors={false}
    />
  );
}
