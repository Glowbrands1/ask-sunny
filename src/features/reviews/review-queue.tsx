"use client";

import Link from "next/link";

import { reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import type { DashboardReview } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { RevealMore, useReveal } from "./load-more";
import { reviewWaitingFor } from "./review-age";

/**
 * ============================================================================
 * THE RESPONSE QUEUE — the one thing on this page somebody can fix today
 * ============================================================================
 *
 * A deliberately narrower card than the feed's. The feed answers "which
 * reviews are these", so it carries the store code, the district, the
 * eligibility, the period and the owner response. This answers one question —
 * WHO IS WAITING, AND HOW LONG — so it carries the rating, the words, the
 * salon, and how old it is, and nothing else.
 *
 * ============================================================================
 * THE ORDER IS THE WHOLE POINT, AND IT IS NOT "NEWEST FIRST"
 * ============================================================================
 *
 * Unanswered before answered, then the lower rating, then the longer wait. A
 * 2-star sitting three days is worse than a 3-star sitting two, and a calendar
 * order buries the one that has been waiting longest. The order is applied in
 * SQL, so the first page is the right page rather than the most recent one;
 * this renders what it is given.
 *
 * ============================================================================
 * "CRITICAL" MEANS 1 OR 2 STARS, AND THAT IS NOT A STYLING CHOICE
 * ============================================================================
 *
 * It is the same line the weekly rule draws: 3, 4 and 5 stars count toward the
 * official total, 1 and 2 do not. Calling a 3-star critical here would have the
 * queue contradict the number it sits under, on the same screen.
 */

/** "Rating only" is a real and common state, printed as one rather than as blank. */
const NO_COMMENT = "Rating only — no written comment.";

/*
 * THE WAIT SENTENCE LIVES IN `review-age.ts` AND IS NOT RE-EXPORTED FROM HERE.
 *
 * It is a pure function the server-rendered alarm tile also needs, and this
 * module is a client component: a server component importing a plain value out
 * of one gets the client module's reference rather than the value, which
 * typechecks, passes every jsdom test, and throws at request time. So there is
 * one import path for it and it is not this file.
 */

function QueueCard({
  review,
  filters,
}: {
  review: DashboardReview;
  filters: ReviewFilters;
}) {
  const critical = review.rating <= 2;
  const answered = review.responseStatus === "responded";

  const status = answered ? "Answered" : critical ? "Critical" : "Open";

  /*
   * THE WHOLE CARD OPENS THE DETAIL VIEW BY CHANGING THE URL rather than by
   * opening client state — so a review is a link somebody can send, the panel
   * survives a refresh, and every filter in force is preserved.
   */
  const detailHref = reviewsHref({ ...filters, openReviewId: review.id });

  return (
    <article
      className={cn(
        "rounded-[14px] border border-border bg-surface shadow-soft",
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-3.5",
        "sm:grid-cols-[76px_minmax(0,1fr)_auto] sm:gap-x-5",
        /* The coral edge marks the ones still waiting, and only those. */
        !answered && "border-l-[5px] border-l-status-under",
      )}
    >
      {/* ------------------------------------------------- the rating rail -- */}
      <div className="min-w-0">
        <p
          className={cn(
            "text-[15px] leading-none font-black tabular-nums",
            critical && !answered ? "text-status-under" : "text-foreground",
          )}
        >
          {review.rating}
          <span className="ml-0.5 text-[12px]">★</span>
        </p>
        <p
          className={cn(
            "mt-1 text-[8.5px] font-black tracking-[0.07em] uppercase",
            answered
              ? "text-muted-foreground"
              : critical
                ? "text-status-under"
                : "text-subtle-foreground",
          )}
        >
          {status}
        </p>
      </div>

      {/* ---------------------------------------------------- the customer -- */}
      <div className="min-w-0">
        <Link href={detailHref} className="block">
          <p
            className={cn(
              "text-[13px] leading-relaxed",
              review.reviewText ? "text-body-foreground" : "text-muted-foreground italic",
            )}
          >
            {review.reviewText ?? NO_COMMENT}
          </p>
        </Link>
        <p className="mt-1 text-[11px] text-muted-foreground">
          <span className="font-bold text-foreground">{review.reviewerName}</span>
          {" · "}
          {/* The salon is a filter of its own, as every location fact here is. */}
          <Link
            href={reviewsHref({ storeCode: review.storeCode })}
            className="hover:underline"
          >
            {review.locationName}
          </Link>
        </p>
      </div>

      {/* ------------------------------------------------------ the action -- */}
      <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start">
        {answered ? (
          <span className="text-[10px] font-black tracking-[0.06em] text-measure-positive-foreground uppercase">
            ✓ Responded
          </span>
        ) : (
          /*
            IT OPENS THE REVIEW, it does not post anything. Drafting a reply is
            an Ask Sunny conversation about a specific review, and the detail
            panel is where that starts — this button is the way in, not a
            second path that could drift from it.
          */
          <Link href={detailHref} className="pill-action bg-chrome text-primary-foreground">
            Draft a reply
          </Link>
        )}
        <span className="text-[10.5px] whitespace-nowrap text-muted-foreground">
          {reviewWaitingFor(review)}
        </span>
      </div>
    </article>
  );
}

/**
 * The queue itself.
 *
 * IT RENDERS EXACTLY WHAT IT IS GIVEN. It runs no query, applies no ordering
 * and holds no limit of its own, so the cards here are the same records the
 * feed would show under the same filters — a second, similar-looking query is
 * how a list and the number above it start disagreeing.
 *
 * REVEALED TWENTY AT A TIME when the caller asks for it, which the Needs
 * Response tab does: it is a work list somebody is going to get through, not a
 * summary, so the whole of it belongs here rather than a slice — but not all at
 * once. `total` is passed so the caption can name what matched in the database
 * rather than only what this page holds.
 */
export function ReviewQueue({
  reviews,
  filters,
  emptyLabel,
  paginate = false,
  total,
}: {
  reviews: DashboardReview[];
  filters: ReviewFilters;
  emptyLabel: string;
  /** Reveal in steps rather than rendering every card handed over. */
  paginate?: boolean;
  /** Matching rows in the database, where that exceeds what was loaded. */
  total?: number;
}) {
  const { visible, hasMore, revealMore } = useReveal(reviews.length);

  if (reviews.length === 0) {
    return (
      /* The anchor lives on both branches: the alarm tile links here whether or
         not the current filters leave anything in the queue, and a link that
         scrolls nowhere reads as a broken button. */
      <p
        id="response-queue"
        className="scroll-mt-4 rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-8 text-center text-[13px] text-muted-foreground shadow-soft"
      >
        {emptyLabel}
      </p>
    );
  }

  const shown = paginate ? reviews.slice(0, visible) : reviews;

  return (
    <div id="response-queue" className="flex scroll-mt-4 flex-col gap-2.5">
      {shown.map((review) => (
        <QueueCard key={review.id} review={review} filters={filters} />
      ))}
      {paginate ? (
        <RevealMore
          shown={shown.length}
          loaded={reviews.length}
          total={total ?? reviews.length}
          onReveal={revealMore}
          hasMore={hasMore}
        />
      ) : null}
    </div>
  );
}
