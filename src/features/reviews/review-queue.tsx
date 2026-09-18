import Link from "next/link";

import { reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import type { DashboardReview } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";

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

/**
 * How long this review has been waiting, in the most truthful terms available.
 *
 * GOOGLE'S OWN WORDING FIRST, verbatim. It is what a manager sees on the page
 * they will check this against, and converting "a month ago" into a date
 * manufactures a precision Google never gave us.
 *
 * Then the real publication instant, which the Apify source supplies and the
 * Business Profile page does not.
 *
 * AND `first_seen_at` IS LABELLED AS WHAT IT IS. It is when ASK Sunny first saw
 * the review, not when the customer wrote it, and printing it bare as an age
 * would be the page asserting a review date it does not have.
 */
export function reviewWaitingFor(review: DashboardReview): string {
  if (review.relativeDateText) return review.relativeDateText;

  const published = review.googleAbsoluteDate ?? review.googleEstimatedAt;
  if (published) {
    const age = relativeAge(published);
    if (age) return age;
  }

  const seen = relativeAge(review.firstSeenAt);
  return seen ? `First seen ${seen}` : "First seen recently";
}

function relativeAge(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;

  const hours = Math.floor((Date.now() - parsed) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

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
 * and holds no limit of its own, so the cards here are a subset of the same
 * feed the page renders below — a second, similar-looking query is how a list
 * and the number above it start disagreeing.
 *
 * THE CALLER SLICES, AND THE CALLER SAYS SO. The page shows the handful waiting
 * longest and captions that against the real unanswered total, because a
 * section captioned as a complete queue while showing six of forty is worse
 * than no section at all.
 */
export function ReviewQueue({
  reviews,
  filters,
  emptyLabel,
}: {
  reviews: DashboardReview[];
  filters: ReviewFilters;
  emptyLabel: string;
}) {
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

  return (
    <div id="response-queue" className="flex scroll-mt-4 flex-col gap-2.5">
      {reviews.map((review) => (
        <QueueCard key={review.id} review={review} filters={filters} />
      ))}
    </div>
  );
}
