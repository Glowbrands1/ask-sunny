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

/* ==========================================================================
 * THE LIVE STRUCTURE, AS QA FOUND IT ON business.google.com
 * ==========================================================================
 *
 * `listingBlock` above is the SHAPE OF THE SIGNAL: a chip, a store code, some
 * reviews. It proved the logic and it hid a bug, because on the real page the
 * three things that matter are all different:
 *
 *   THE HEADER IS A BLOCK, not a chip — business name, street address, phone
 *   number, then the store code.
 *
 *   THE STORE CODE IS SPLIT ACROSS ELEMENTS. Google renders the label and the
 *   value separately, so no single leaf carries "Store code: 306".
 *
 *   THE REVIEW IS DEEP. `data-lid` sits a dozen wrappers below the header, not
 *   one. The old parser gave up after eight and reported the page as somebody
 *   else's business.
 *
 * The address deliberately ends in a ZIP+4 and the phone number in four digits:
 * both end in "-" plus digits, which is what the bare trailing-code pattern
 * looks for. They are here to prove it cannot win over a labelled code.
 *
 * Nothing in this file is real. The addresses and phone numbers are invented
 * along with everything else.
 */

/** Google's live location header: name, address, phone, store code. */
export function locationHeader({
  business,
  address = "3252 Kimball Ave, Manhattan, KS 66503-1417",
  phone = "(785) 539-1417",
  storeCode,
  /** False renders "Store code: 306" in one leaf, as the old fixtures did. */
  splitCode = true,
}) {
  const code = splitCode
    ? `<span class="label">Store code:</span><span class="value">${storeCode}</span>`
    : `Store code: ${storeCode}`;

  return `
    <div class="header">
      <div class="name"><span>${business}</span></div>
      <div class="address"><span>${address}</span></div>
      <div class="phone"><span>${phone}</span></div>
      <div class="code">${code}</div>
    </div>
  `;
}

/** Buries markup `depth` wrappers deep, the way an Angular app does. */
export function nestDeep(html, depth) {
  let out = html;
  for (let level = 0; level < depth; level += 1) {
    out = `<div class="w${level}">${out}</div>`;
  }
  return out;
}

/**
 * One location card: the header, then its reviews far below it.
 *
 * `wrapperDepth` defaults past the old eight-ancestor limit on purpose — a
 * fixture that sits inside it cannot fail the way the live page did.
 */
export function liveLocationCard({
  business,
  storeCode,
  cards,
  address,
  phone,
  splitCode = true,
  wrapperDepth = 12,
}) {
  return `
    <div class="location-card">
      ${locationHeader({ business, storeCode, address, phone, splitCode })}
      ${nestDeep(cards.join("\n"), wrapperDepth)}
    </div>
  `;
}

/**
 * The harder shape: headers and review runs as SIBLINGS in one flat list.
 *
 * Here no header is an ancestor of the reviews it owns, so the only thing that
 * says which reviews belong to which listing is document order. A parser that
 * stops at the first shared container and takes the first code it finds files
 * every review on the page against the first salon.
 */
export function liveFlatFeed(sections) {
  const parts = [];
  for (const section of sections) {
    parts.push(
      locationHeader({
        business: section.business,
        storeCode: section.storeCode,
        address: section.address,
        phone: section.phone,
        splitCode: section.splitCode ?? true,
      }),
    );
    parts.push(nestDeep(section.cards.join("\n"), section.wrapperDepth ?? 10));
  }
  return `<main class="reviews-feed">${parts.join("\n")}</main>`;
}

/**
 * The page live QA was looking at when the extension said none of it was ours.
 *
 * KS Manhattan (306) and NE Lincoln 27th Street (144) are both on the fifteen;
 * Buff City Soap (236) is the other business on the same Google account.
 */
export function liveFeed() {
  return liveFlatFeed([
    {
      business: "Sun Tan City - KS Manhattan",
      storeCode: "306",
      address: "3252 Kimball Ave, Manhattan, KS 66503-1417",
      cards: [
        reviewCard({ lid: "FIXTURE-LIVE-306-1", reviewer: "Nell Arden", rating: 5 }),
        reviewCard({
          lid: "FIXTURE-LIVE-306-2",
          reviewer: "Orrin Blake",
          rating: 4,
          text: "Friendly desk staff and the bed was ready when I arrived.",
        }),
      ],
    },
    {
      business: "Buff City Soap - Lincoln",
      storeCode: "236",
      address: "700 N 14th St, Lincoln, NE 68508-2233",
      cards: [
        reviewCard({ lid: "FIXTURE-LIVE-236-1", reviewer: "Rowan Dell", rating: 5 }),
      ],
    },
    {
      business: "Sun Tan City - NE Lincoln 27th Street",
      storeCode: "144",
      address: "2711 Pine Lake Rd, Lincoln, NE 68516-7788",
      cards: [
        reviewCard({ lid: "FIXTURE-LIVE-144-1", reviewer: "Ada Quill", rating: 3 }),
        reviewCard({
          lid: "FIXTURE-LIVE-144-2",
          reviewer: "Petra Moss",
          rating: 5,
          text: "Booked online and was in the booth within five minutes of walking in.",
        }),
      ],
    },
  ]);
}
