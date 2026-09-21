import { Provenance } from "@/components/ui/marquee";
import { formatNumber } from "@/lib/utils/format";
import type { ReviewsWeekBlock, ReviewsWeekFigures } from "@/lib/reviews/weekly-block";
import { loadReviewsWeekBlock } from "@/lib/reviews/weekly-block-read";
import { ReviewsBar, ReviewsBarNotice, ReviewsBarSkeleton } from "./reviews-bar";

/**
 * ============================================================================
 * THE OVERVIEW'S GOOGLE REVIEWS BLOCK — the live half of the yellow bar
 * ============================================================================
 *
 * A SERVER COMPONENT, for the same reason the Performance Overview card is one:
 * the review read layer is `server-only`, the Overview screen is a client
 * component, and the way those meet in this app is a node rendered on the
 * server and passed down as a prop behind a `<Suspense>`. No JSON endpoint is
 * added — publishing the estate's review counts to an unauthenticated route to
 * feed a landing-page widget would be a wider change than the widget.
 *
 * THE FIGURES ARE THE GOOGLE REVIEWS TAB'S OWN. See `lib/reviews/weekly-block.ts`
 * for the projection and `weekly-block-read.ts` for the read; nothing about
 * what counts toward a week is decided here, or anywhere on this side of the
 * page.
 *
 * WHAT THE CAPTION IS FOR. The bar has room for five figures and no room to say
 * what any of them means, and "Reviews gained" is a definition somebody will
 * quote — it is the 3-, 4- and 5-star reviews counted into the open reporting
 * period, compared against the period before it. The old line under this block
 * announced that every figure was a placeholder; this one names the period, the
 * comparison and the population instead. It is not a warning and never appears
 * as one.
 */

/** The provenance line: the period, the definition and the population. */
export function weekBlockCaption(block: ReviewsWeekFigures): string {
  return [
    `Week of ${block.weekLabel}`,
    `3–5★ counted into the period, ${formatNumber(block.allNew)} counted in total`,
    `vs ${block.previousWeekLabel}`,
    `${formatNumber(block.salonCount)} ${block.salonCount === 1 ? "salon" : "salons"}`,
    block.goalPerSalon === null
      ? null
      : `goal ${formatNumber(block.goalPerSalon)} per salon`,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * The block, given its data. Pure and synchronous, so every state is testable.
 *
 * The states nobody sees in development are the ones that matter here: an
 * estate with nothing synced and a failed read must both be distinguishable
 * from a genuinely quiet week, and neither may borrow a figure from the other.
 */
export function ReviewsWeekCard({ block }: { block: ReviewsWeekBlock }) {
  if (block.status === "no_data") {
    return <ReviewsBarNotice>{block.reason}</ReviewsBarNotice>;
  }

  if (block.status === "error") {
    return (
      <ReviewsBarNotice>
        {block.message} No figures are shown rather than figures that might be
        wrong — Google Reviews has the detail once it is reachable.
      </ReviewsBarNotice>
    );
  }

  return (
    <>
      <ReviewsBar
        gained={block.gained}
        goal={block.goal}
        vsLastWeek={block.vsLastWeek}
        averageRating={block.averageRating}
        salonCount={block.salonCount}
      />
      <Provenance className="mt-2.5">{weekBlockCaption(block)}</Provenance>
    </>
  );
}

/** Holds the block's dimensions while the review read resolves. */
export function ReviewsWeekSkeleton() {
  return (
    <>
      <ReviewsBarSkeleton />
      <Provenance className="mt-2.5">Reading this week&rsquo;s Google reviews…</Provenance>
    </>
  );
}

/** Reads the reviews, then renders the block. Streamed behind a `<Suspense>`. */
export async function ReviewsWeek() {
  return <ReviewsWeekCard block={await loadReviewsWeekBlock()} />;
}
