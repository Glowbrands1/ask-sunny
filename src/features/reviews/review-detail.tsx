import Link from "next/link";
import { X } from "lucide-react";

import {
  formatReviewsDay,
  formatReviewsInstant,
} from "@/lib/reviews/display-time";
import { formatWeekRange } from "@/lib/reviews/reporting-week";
import { reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import type { DashboardReview } from "@/lib/reviews/types";
import { cn } from "@/lib/utils/cn";
import { Stars, WeeklyEligibility } from "./review-stars";

/**
 * ONE REVIEW, IN FULL.
 *
 * Opened by `?review=<id>` rather than by client state, so the panel survives a
 * refresh and a single review is a link somebody can send to the salon it
 * concerns. Closing it drops the parameter and keeps every other filter.
 *
 * ============================================================================
 * WHICH INTERNAL FIELDS APPEAR HERE, AND WHY THEY ARE THE ONLY ONES
 * ============================================================================
 *
 * The brief asks for the Google review id and the source to be visible, and
 * they are — both are what somebody uses to find the same review on Google and
 * to confirm it was counted once. Everything else internal stays out: no row
 * id, no location uuid, no ingestion credential, no parser version. A detail
 * view is for the person answering the review, not for the schema.
 */
export function ReviewDetail({
  review,
  filters,
}: {
  review: DashboardReview;
  filters: ReviewFilters;
}) {
  const closeHref = reviewsHref({ ...filters, openReviewId: null });

  return (
    <section
      id="review-detail"
      aria-label={`Review detail for ${review.reviewerName}`}
      className="rounded-[var(--radius-lg)] border border-border-strong bg-surface p-5 shadow-raised"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Review detail</p>
          <h3 className="mt-1 text-[17px] font-black text-foreground">
            {review.reviewerName}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Stars rating={review.rating} />
            <span className="text-[11px] text-muted-foreground">
              {review.rating} {review.rating === 1 ? "star" : "stars"}
            </span>
          </div>
        </div>
        <Link
          href={closeHref}
          aria-label="Close the review detail"
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </Link>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-body-foreground">
        {review.reviewText ?? (
          <span className="text-muted-foreground italic">
            Rating only — no written comment.
          </span>
        )}
      </p>

      {review.ownerResponseText ? (
        <div className="mt-4 rounded-[var(--radius-md)] bg-surface-muted p-4">
          <p className="eyebrow">
            Owner response
            {review.ownerResponseDateText ? ` · ${review.ownerResponseDateText}` : ""}
          </p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-body-foreground">
            {review.ownerResponseText}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-hairline pt-4">
        <WeeklyEligibility eligible={review.eligibleForWeeklyCount} />
        {/*
          TWO GATES, SHOWN AS TWO. The star rule above says whether this review
          is one of the 3-to-5-star ones; this says whether it is in a reporting
          period at all. A 5-star review in the imported backlog passes the
          first and fails the second, and a reader who sees only one of them
          would reasonably expect it in Monday's number.
        */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10.5px] font-bold",
            review.reportingPeriodId
              ? "text-status-outperforming"
              : "text-muted-foreground",
          )}
        >
          <span aria-hidden>{review.reportingPeriodId ? "✓" : "○"}</span>
          {review.reportingPeriodId
            ? "Counted in a reporting period"
            : "Historical — not assigned to a reporting week"}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
        <Field label="Location">Sun Tan City - {review.locationName}</Field>
        <Field label="Store code">{review.storeCode}</Field>
        <Field label="District">{review.district ?? "Not on record"}</Field>
        <Field label="Response status">
          {review.responseStatus === "responded" ? "Responded" : "Needs Response"}
        </Field>
        <Field label="Google review date">
          {review.relativeDateText ?? "Google showed no date"}
        </Field>
        <Field label="Google absolute date">
          {/*
            NULLABLE AND USUALLY NULL. Google's interface gives relative text
            only; this exists for when a real posting time becomes available,
            and it never moves the reporting week when it arrives.
          */}
          {formatReviewsInstant(review.googleAbsoluteDate) ??
            "Not available from Google"}
        </Field>
        {/*
          ALL THREE ARE READ IN CENTRAL, like every other timestamp on this
          feature. They are `timestamptz` and stored in UTC; `toLocaleString()`
          with no zone drew them in the host container's zone, which put an
          audit trail five hours ahead of the person auditing it.
        */}
        <Field label="First seen by ASK Sunny">
          {formatReviewsInstant(review.firstSeenAt) ?? "—"}
        </Field>
        <Field label="Last seen by ASK Sunny">
          {formatReviewsInstant(review.lastSeenAt) ?? "—"}
        </Field>
        <Field label="Reporting period">
          {review.periodStart ? (
            formatWeekRange(review.periodStart)
          ) : (
            <span className="text-muted-foreground">
              None — imported history, counted toward no week
            </span>
          )}
        </Field>
        <Field label="First seen in week">
          {/*
            AUDIT METADATA, LABELLED AS SUCH. It used to decide the reporting
            period, and that was the defect: importing a backlog put a year of
            reviews into the week somebody pressed Sync. It is shown because it
            is genuinely useful for tracing an import, and it is shown APART
            from the reporting period so the two cannot be confused again.
          */}
          {formatWeekRange(review.firstSeenWeek)}
        </Field>
        <Field label="Google estimated date">
          {review.googleEstimatedAt ? (
            <>
              {formatReviewsDay(review.googleEstimatedAt)}{" "}
              <span className="text-muted-foreground">(approximate)</span>
            </>
          ) : (
            "Could not be read from Google's wording"
          )}
        </Field>
        <Field label="Source">google_business_profile</Field>
        <Field label="Google review ID">
          <span className="font-mono text-[11px] break-all">{review.externalReviewId}</span>
        </Field>
        <Field label="Location website">
          {review.websiteUrl ? (
            <a
              href={review.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent-foreground hover:underline"
            >
              {review.websiteUrl}
            </a>
          ) : (
            "Not recorded"
          )}
        </Field>
      </dl>

      {review.listingState === "verification_required" ? (
        <p className="mt-4 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2 text-[11.5px] text-muted-foreground">
          Google currently shows a verification problem on this listing. The salon is
          trading and stays in every total; Google may not be serving new reviews for
          it until the profile is verified.
        </p>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-subtle-foreground">{label}</dt>
      <dd className="mt-0.5 text-[12.5px] text-foreground">{children}</dd>
    </div>
  );
}
