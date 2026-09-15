import { Star } from "lucide-react";

import { EmptyState } from "@/components/ui/feedback";
import { formatNumber } from "@/lib/utils/format";
import { FEEDBACK_RATINGS, OUTCOME_LABEL } from "@/lib/feedback/types";
import type { FeedbackSummary } from "@/lib/analytics/feedback-queries";
import { changeAgainst } from "@/lib/analytics/queries";

/**
 * CONVERSATION FEEDBACK — the headline, the distribution and the outcome split.
 *
 * ============================================================================
 * THE DENOMINATOR IS ALWAYS ON SCREEN
 * ============================================================================
 *
 * The dashboard this is modelled on prints "2.5 ★" and, beneath it, "19
 * responses in the last 30 days · 9% got what they needed" — next to an answer
 * rate of 100%. Read quickly that says nine tenths of everything failed. Read
 * correctly it says 19 people out of 1,467 inquiries answered a question, and
 * of those 19, two said yes.
 *
 * Both readings come from the same three numbers, which is what makes the
 * layout rather than the arithmetic the problem. So: the response count sits
 * beside the average rather than under it, the outcome split is stated as a
 * fraction of the RATED answers in those words, and an unrated window says "No
 * data yet" instead of printing a zero that looks like a score.
 *
 * ============================================================================
 * A NULL AVERAGE IS NOT A ZERO
 * ============================================================================
 *
 * `averageRating` is null when nothing was rated, and it stays null all the way
 * from the SQL to here. "0.0 ★" for a quiet fortnight is a catastrophe that did
 * not happen, and it is the kind of figure somebody screenshots.
 */
export function ConversationFeedbackSummary({
  summary,
  previous,
  periodLabel,
}: {
  summary: FeedbackSummary;
  previous: FeedbackSummary;
  periodLabel: string;
}) {
  if (summary.responses === 0) {
    return (
      <EmptyState
        title="No feedback yet"
        description={`Nobody rated an Ask Sunny answer in the ${periodLabel.toLowerCase()}. Ratings are collected under every answer and appear here as they arrive — nothing is backfilled, so this fills from the day the feature shipped.`}
      />
    );
  }

  const rated = summary.responses;
  const change =
    summary.averageRating !== null && previous.averageRating !== null
      ? summary.averageRating - previous.averageRating
      : null;
  const volumeChange = changeAgainst(rated, previous.responses);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      {/* ------------------------------------------------------ headline -- */}
      <div>
        <div className="flex items-baseline gap-2">
          <span className="display text-[44px] leading-none text-foreground tabular-nums">
            {summary.averageRating !== null
              ? summary.averageRating.toFixed(1)
              : "—"}
          </span>
          <Star className="size-6 fill-brand-yellow text-brand-yellow" aria-hidden />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          average rating per answer
        </p>

        {/*
          PER ANSWER, SAID IN AS MANY WORDS. This is the grain the whole feature
          is built on — a rating attaches to one assistant turn on one surface,
          not to a conversation — and the label is where a reader finds that out
          without reading the schema.
        */}
        <p className="mt-3 text-[13px] leading-relaxed text-body-foreground">
          <strong className="font-bold text-foreground">
            {formatNumber(rated)}
          </strong>{" "}
          {rated === 1 ? "answer" : "answers"} rated in the{" "}
          {periodLabel.toLowerCase()}
          {volumeChange !== null ? (
            <>
              {" "}
              ({volumeChange >= 0 ? "+" : ""}
              {Math.round(volumeChange)}% vs prior)
            </>
          ) : null}
          .
        </p>

        {change !== null ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {change === 0
              ? "Unchanged against the prior period."
              : `${change > 0 ? "Up" : "Down"} ${Math.abs(change).toFixed(1)} against the prior period.`}
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted-foreground">
            The prior period had nothing rated, so there is no comparison yet.
          </p>
        )}

        {/* ------------------------------------------------- got what? -- */}
        <div className="mt-5">
          <p className="eyebrow mb-2">Did they get what they needed?</p>
          <dl className="space-y-1.5">
            {(["yes", "partially", "no"] as const).map((outcome) => {
              const count = summary.outcomes[outcome];
              const share = rated > 0 ? Math.round((count / rated) * 100) : 0;
              return (
                <div key={outcome} className="flex items-center gap-3">
                  <dt className="w-20 shrink-0 text-[13px] text-body-foreground">
                    {OUTCOME_LABEL[outcome]}
                  </dt>
                  <dd className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                      className="h-2 rounded-full bg-brand-yellow"
                      style={{ width: `${Math.max(share, count > 0 ? 2 : 0)}%` }}
                      aria-hidden
                    />
                    <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                      {count} ({share}%)
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>
          {/*
            STATED AS A FRACTION OF WHAT WAS RATED, not of all activity. The
            percentages above divide by `rated`, and saying so is what stops
            "9% got what they needed" being read as a verdict on everything the
            product did.
          */}
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Percentages are of the {formatNumber(rated)} rated{" "}
            {rated === 1 ? "answer" : "answers"}, not of all activity.
          </p>
        </div>
      </div>

      {/* -------------------------------------------------- distribution -- */}
      <div>
        <p className="eyebrow mb-3">Rating distribution</p>
        <dl className="space-y-2.5">
          {/*
            FIVE DOWN TO ONE. The scale reads best from its top, and it puts the
            bar somebody is looking for — the 1-star count — at the bottom of a
            descending list rather than buried in the middle of an ascending one.
          */}
          {[...FEEDBACK_RATINGS].reverse().map((value) => {
            const count = summary.distribution[value];
            const share = rated > 0 ? (count / rated) * 100 : 0;
            return (
              <div key={value}>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[13px] text-body-foreground">
                    {value} {value === 1 ? "star" : "stars"}
                  </dt>
                  <dd className="text-[13px] font-bold text-foreground tabular-nums">
                    {formatNumber(count)}
                  </dd>
                </div>
                <div
                  className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-brand-yellow"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
            );
          })}
        </dl>

        {/* ------------------------------------------------ queue depth -- */}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-border-row pt-3.5">
          {(
            [
              ["Pending", summary.queue.pending],
              ["In review", summary.queue.in_review],
              ["Resolved", summary.queue.resolved],
              ["Dismissed", summary.queue.dismissed],
              ["Hidden", summary.hidden],
            ] as const
          ).map(([label, count]) => (
            <p key={label} className="text-[12px] text-muted-foreground">
              <span className="font-bold text-foreground tabular-nums">
                {formatNumber(count)}
              </span>{" "}
              {label.toLowerCase()}
            </p>
          ))}
        </div>
        {/*
          THE QUEUE COUNTS INCLUDE HIDDEN ITEMS AND THE AVERAGES DO NOT, which
          is a real difference and worth one line rather than a support question.
        */}
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Hidden comments are excluded from the average and the distribution, and
          still counted in the queue above — hiding a complaint does not answer
          it.
        </p>
      </div>
    </div>
  );
}
