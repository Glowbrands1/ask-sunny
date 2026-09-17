/**
 * GOOGLE REVIEW DOM FIXTURES.
 *
 * ============================================================================
 * NOT ONE BYTE OF REAL CUSTOMER DATA IS IN THIS FILE
 * ============================================================================
 *
 * Every reviewer name is invented, every comment is invented, and every review
 * id is a `FIXTURE-…` string rather than a Google one. A real `data-lid` was
 * observed during DOM discovery and is deliberately not committed: a review id
 * plus a store code identifies a named member of the public, and a test fixture
 * is not where that belongs.
 *
 * ============================================================================
 * WHAT THE MARKUP IMITATES, AND WHAT IT CANNOT
 * ============================================================================
 *
 * These reproduce the SIGNALS the parser is built on, each of which was
 * confirmed against the live Google Business Profile Reviews page in Brave
 * DevTools:
 *
 *   `data-lid` on the review element, repeated on a nested descendant.
 *   Five Material Icon star spans, the earned ones computing to rgb(251,188,4).
 *   An avatar `alt` of "Photo of <name>".
 *   A relative date: "7 hours ago", "2 days ago".
 *   A "Reply" control on a review with no response.
 *   A "Response from the owner" block on one that has been answered.
 *   A location chip naming the business and the store code.
 *
 * WHAT THEY DO NOT REPRODUCE is Google's actual class names and nesting depth,
 * because those are minified, unstable and not what the parser reads. A fixture
 * that copied them would be testing a snapshot of one afternoon's markup. The
 * honest limitation is stated in the handoff: these prove the PARSER'S LOGIC,
 * and only a run against the live page proves the selectors still find it.
 */

/** Google's filled star. Verified: #FBBC04. */
export const FILLED = "rgb(251, 188, 4)";
/** An unearned star, in Google's grey. */
export const EMPTY = "rgb(218, 220, 224)";

function stars(rating, { withAriaLabel = false } = {}) {
  const spans = [];
  for (let index = 1; index <= 5; index += 1) {
    const filled = index <= rating;
    spans.push(
      `<span class="gm-icon" style="color: ${filled ? FILLED : EMPTY}">${
        filled ? "star" : "star_border"
      }</span>`,
    );
  }
  const label = withAriaLabel
    ? ` aria-label="${rating} star${rating === 1 ? "" : "s"}"`
    : "";
  return `<div class="rating"${label} role="img">${spans.join("")}</div>`;
}

/**
 * One review card.
 *
 * `nested: true` wraps the body in a SECOND element carrying the same
 * `data-lid`, which is what Google's own markup does and what the parser has to
 * collapse. It is a fixture option rather than a separate fixture so every
 * other case can be run through it unchanged.
 */
export function reviewCard({
  lid,
  reviewer,
  rating,
  text = null,
  relativeDate = "2 days ago",
  ownerResponse = null,
  ownerResponseDate = "1 day ago",
  nested = false,
  withAriaLabel = false,
}) {
  const body = `
    <img alt="Photo of ${reviewer}" src="data:," />
    <div role="heading" aria-level="3">${reviewer}</div>
    ${stars(rating, { withAriaLabel })}
    <span class="when">${relativeDate}</span>
    ${text ? `<div class="comment">${text}</div>` : ""}
    ${
      ownerResponse
        ? `<div class="owner">
             <div class="owner-label">Response from the owner</div>
             <span class="owner-when">${ownerResponseDate}</span>
             <div class="owner-body">${ownerResponse}</div>
           </div>`
        : `<button type="button">Reply</button>`
    }
  `;

  const inner = nested ? `<div data-lid="${lid}">${body}</div>` : body;
  return `<div class="review" data-lid="${lid}">${inner}</div>`;
}

/** A listing block: the location chip plus the reviews filed under it. */
export function listingBlock({ business, storeCode, cards }) {
  return `
    <section class="listing">
      <div class="location-chip">
        <span class="business">${business}</span>
        <span class="code">Store code: ${storeCode}</span>
      </div>
      ${cards.join("\n")}
    </section>
  `;
}

/** The whole combined reviews feed, as Google renders several listings at once. */
export function reviewsFeed(blocks) {
  return `<main class="reviews-feed">${blocks.join("\n")}</main>`;
}

/**
 * The page the QA script walks through: one review of each shape that matters,
 * plus a Buff City Soap listing and an unlisted Sun Tan City store.
 */
export function standardFeed() {
  return reviewsFeed([
    listingBlock({
      business: "Sun Tan City - KS Manhattan",
      storeCode: "306",
      cards: [
        reviewCard({
          lid: "FIXTURE-KSM-0001",
          reviewer: "Tamsin Vale",
          rating: 3,
          text: "First Tan Free was not completely true for me, but the staff sorted it out in the end.",
          relativeDate: "7 hours ago",
          nested: true,
        }),
        reviewCard({
          lid: "FIXTURE-KSM-0002",
          reviewer: "Orrin Blake",
          rating: 1,
          text: "Bed was not cleaned between appointments.",
          relativeDate: "3 days ago",
        }),
      ],
    }),
    listingBlock({
      business: "Sun Tan City - NE Kearney",
      storeCode: "143",
      cards: [
        reviewCard({
          lid: "FIXTURE-KRN-0001",
          reviewer: "Mirela Fenn",
          rating: 2,
          text: "Waited too long at the front desk.",
          relativeDate: "2 days ago",
        }),
      ],
    }),
    listingBlock({
      business: "Sun Tan City - NE Lincoln 27th Street",
      storeCode: "144",
      cards: [
        /* Rating only: Google carried five stars and no words. */
        reviewCard({
          lid: "FIXTURE-L27-0001",
          reviewer: "Ada Quill",
          rating: 5,
          text: null,
          relativeDate: "1 week ago",
          ownerResponse: "Thank you for the five stars — see you next visit!",
        }),
        reviewCard({
          lid: "FIXTURE-L27-0002",
          reviewer: "Petra Moss",
          rating: 5,
          text: "Easiest membership upgrade I have ever done, took two minutes flat.",
          relativeDate: "4 days ago",
        }),
        reviewCard({
          lid: "FIXTURE-L27-0003",
          reviewer: "Iveta Crane",
          rating: 4,
          text: "Nice location and helpful staff, would like slightly longer evening hours.",
          relativeDate: "5 days ago",
        }),
      ],
    }),
    /* A different business on the same Google account. Ignored, not a failure. */
    listingBlock({
      business: "Buff City Soap - Lincoln",
      storeCode: "881",
      cards: [
        reviewCard({
          lid: "FIXTURE-BCS-0001",
          reviewer: "Rowan Dell",
          rating: 5,
          text: "Lovely soap, wonderful smell.",
          relativeDate: "1 day ago",
        }),
      ],
    }),
    /* A Sun Tan City store that is NOT on the fifteen-store allowlist. */
    listingBlock({
      business: "Sun Tan City - Somewhere Else",
      storeCode: "999",
      cards: [
        reviewCard({
          lid: "FIXTURE-UNK-0001",
          reviewer: "Casper Lune",
          rating: 4,
          text: "Good visit, friendly team on the desk today.",
          relativeDate: "6 days ago",
        }),
      ],
    }),
  ]);
}
