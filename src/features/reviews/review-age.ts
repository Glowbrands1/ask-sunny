import type { DashboardReview } from "@/lib/reviews/types";

/**
 * HOW LONG A REVIEW HAS BEEN WAITING, in the most truthful terms available.
 *
 * ============================================================================
 * IT LIVES IN ITS OWN MODULE BECAUSE BOTH SIDES OF THE RENDER ASK
 * ============================================================================
 *
 * The response queue is a client component — it reveals more cards as somebody
 * works through them — and the alarm tile on the Overview is server-rendered.
 * Both need this sentence, and importing it out of a `"use client"` module into
 * a server component would put a boundary directive in charge of a pure
 * function. So it sits here, with no directive and no dependency, and both
 * sides import it.
 *
 * ============================================================================
 * THE ORDER OF THE ANSWERS IS THE POINT
 * ============================================================================
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
