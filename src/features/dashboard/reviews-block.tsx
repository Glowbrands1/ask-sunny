import { Provenance } from "@/components/ui/marquee";
import { formatNumber } from "@/lib/utils/format";
import type {
  ReviewsOverviewBlock,
  ReviewsOverviewFigures,
} from "@/lib/reviews/overview-block";
import { loadReviewsOverviewBlock } from "@/lib/reviews/overview-block-read";
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
 * IT REPORTS THE INVENTORY, NOT THE WEEK. See `lib/reviews/overview-block.ts`
 * for why that changed and `overview-block-read.ts` for the read. Nothing here
 * consults a baseline, an anchor or a reporting period, and nothing about
 * `/reviews` changed when this stopped doing so.
 *
 * WHAT THE CAPTION IS FOR. "Total reviews 88" is a figure somebody will quote,
 * and the one thing it must not be mistaken for is GOOGLE'S OWN lifetime total
 * — the Business Profile page does not expose a per-listing lifetime count this
 * system can read, which is why the tab's own column is labelled "reviews ASK
 * SUNNY HOLDS". The caption says the same thing in a line. It is not a warning
 * and never appears as one.
 */

/** The provenance line: what the figures count, and what they do not. */
export function overviewBlockCaption(block: ReviewsOverviewFigures): string {
  return [
    `${formatNumber(block.totalReviews)} Google ${
      block.totalReviews === 1 ? "review" : "reviews"
    } Ask Sunny holds across ${formatNumber(block.salonCount)} ${
      block.salonCount === 1 ? "salon" : "salons"
    }`,
    "not Google's own lifetime total",
  ].join(" · ");
}

/**
 * The block, given its data. Pure and synchronous, so every state is testable.
 *
 * The states nobody sees in development are the ones that matter here: an
 * estate with nothing synced and a failed read must both be distinguishable
 * from a real inventory, and neither may borrow a figure from the other.
 */
export function ReviewsBlockCard({ block }: { block: ReviewsOverviewBlock }) {
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
        totalReviews={block.totalReviews}
        averageRating={block.averageRating}
        salonCount={block.salonCount}
      />
      <Provenance className="mt-2.5">{overviewBlockCaption(block)}</Provenance>
    </>
  );
}

/** Holds the block's dimensions while the review read resolves. */
export function ReviewsBlockSkeleton() {
  return (
    <>
      <ReviewsBarSkeleton />
      <Provenance className="mt-2.5">Reading the Google reviews…</Provenance>
    </>
  );
}

/** Reads the reviews, then renders the block. Streamed behind a `<Suspense>`. */
export async function ReviewsBlock() {
  return <ReviewsBlockCard block={await loadReviewsOverviewBlock()} />;
}
