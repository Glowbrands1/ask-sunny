import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { EmptyState } from "@/components/ui/feedback";
import { reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import type { DashboardReview } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { Stars, WeeklyEligibility } from "./review-stars";

/**
 * THE INDIVIDUAL REVIEW RECORDS.
 *
 * The page's other half. Summary tiles say how many; this says WHICH — actual
 * reviewer names, actual comments, actual ratings, the real salon, the real
 * store code and the real district — and every tile on the page links into it
 * with the filters that produced its number.
 *
 * ORDERED AS A WORK QUEUE, not as a calendar. Unanswered before answered, then
 * the lower rating, then the older review: a 2-star sitting three days is worse
 * than a 3-star sitting two, and "newest first" buries the review that has been
 * waiting longest. The order is applied in SQL so the first page is the right
 * hundred rather than the most recent hundred.
 */

/** "Rating only" is a real state and is printed as one, never as blank space. */
const NO_COMMENT = "Rating only — no written comment.";

export function ReviewFeed({
  reviews,
  total,
  truncated,
  filters,
}: {
  reviews: DashboardReview[];
  total: number;
  truncated: boolean;
  filters: ReviewFilters;
}) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        compact
        title="No review matches these filters"
        description="Clear a filter, or widen the week, to see more."
        action={
          <Link href="/reviews#review-feed" className="pill-action bg-selected text-selected-foreground">
            Clear filters
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-muted-foreground">
        {truncated
          ? `Showing the first ${reviews.length} of ${total} matching reviews, worst and oldest first.`
          : `${total} ${total === 1 ? "review" : "reviews"}, worst and oldest first.`}
      </p>
      {reviews.map((review) => (
        <ReviewRow key={review.id} review={review} filters={filters} />
      ))}
    </div>
  );
}

function ReviewRow({
  review,
  filters,
}: {
  review: DashboardReview;
  filters: ReviewFilters;
}) {
  const critical = review.rating <= 2;
  const open = review.responseStatus === "needs_response";

  /*
   * THE WHOLE ROW OPENS THE DETAIL VIEW, and it does it by changing the URL
   * rather than by opening client state — so a review is a link somebody can
   * send, and the panel survives a refresh. Every other filter in force is
   * preserved, which is what stops "open this review" from silently resetting
   * the page underneath it.
   */
  const detailHref = reviewsHref({ ...filters, openReviewId: review.id });

  return (
    <article
      className={cn(
        "rounded-[14px] border border-border bg-surface px-4 py-3.5 shadow-soft",
        open && "border-l-[5px] border-l-measure-data",
      )}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <Link
              href={detailHref}
              className="text-[13px] font-black text-foreground hover:underline"
            >
              {review.reviewerName}
            </Link>
            <Stars rating={review.rating} />
            <span className="text-[10.5px] text-muted-foreground">
              {review.rating} {review.rating === 1 ? "star" : "stars"}
            </span>
          </div>

          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {/* The three location facts, each a filter of its own. */}
            <Link
              href={reviewsHref({ storeCode: review.storeCode })}
              className="font-bold text-foreground hover:underline"
            >
              Sun Tan City - {review.locationName}
            </Link>
            {" · Store Code: "}
            <span className="tabular-nums">{review.storeCode}</span>
            {review.district ? (
              <>
                {" · District: "}
                <Link
                  href={reviewsHref({ district: review.district })}
                  className="hover:underline"
                >
                  {review.district}
                </Link>
              </>
            ) : (
              " · District: not on record"
            )}
          </p>

          <p
            className={cn(
              "mt-2 text-[12.5px] leading-relaxed",
              review.reviewText ? "text-body-foreground" : "text-muted-foreground italic",
            )}
          >
            {review.reviewText ?? NO_COMMENT}
          </p>

          {review.ownerResponseText ? (
            <div className="mt-2.5 border-l-2 border-border-strong pl-3">
              <p className="eyebrow text-subtle-foreground">
                Owner response
                {review.ownerResponseDateText ? ` · ${review.ownerResponseDateText}` : ""}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-body-foreground">
                {review.ownerResponseText}
              </p>
            </div>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {/*
              TWO FACTS, NEVER ONE. The star rule says whether this review is one
              of the 3-to-5-star ones; the period says whether it is in a week at
              all. A 5-star review sitting in the imported backlog satisfies the
              first and not the second, and showing only the first would have a
              reader expecting it in Monday's number.
            */}
            <WeeklyEligibility eligible={review.eligibleForWeeklyCount} />
            {review.reportingPeriodId === null ? (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-muted-foreground">
                <span aria-hidden>○</span>
                Historical — not assigned to a reporting week
              </span>
            ) : null}
            <span className="text-[10.5px] text-muted-foreground">
              Received: {review.relativeDateText ?? "date not shown by Google"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <span
            className={cn(
              "inline-flex items-center rounded-[var(--radius-xs)] px-2.5 py-1 text-[8.5px] font-black tracking-[0.07em] uppercase",
              open
                ? critical
                  ? "bg-status-under text-status-under-foreground"
                  : "bg-status-below-market text-status-below-market-foreground"
                : "bg-status-outperforming text-status-outperforming-foreground",
            )}
          >
            {open ? "Needs Response" : "Responded"}
          </span>

          {open ? (
            /*
             * The reply is drafted in Ask Sunny, on the same chat path every
             * other screen uses, so it is a real turn in the same history and
             * audit trail rather than a second assistant nobody can review.
             */
            <Link
              href={`/chat?q=${encodeURIComponent(
                `Draft a reply to this ${review.rating}-star Google review at Sun Tan City ${
                  review.locationName
                } from ${review.reviewerName}: "${review.reviewText ?? "(rating only, no comment)"}"`,
              )}`}
              className="pill-action bg-selected text-selected-foreground transition-colors hover:bg-selected-hover"
            >
              <MessageSquare className="mr-1 inline size-3" aria-hidden />
              Draft a reply
            </Link>
          ) : null}

          <Link
            href={detailHref}
            className="text-[10.5px] text-muted-foreground hover:text-foreground hover:underline"
          >
            Full detail
          </Link>
        </div>
      </div>
    </article>
  );
}
