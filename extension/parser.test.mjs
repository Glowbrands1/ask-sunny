// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  PARSER_VERSION,
  extractListing,
  extractOwnerResponse,
  extractRating,
  extractReviewText,
  extractReviewerName,
  findReviewCards,
  hasReplyButton,
  looksLikeReviewsPage,
  parseReviewsFromDocument,
} from "./parser.js";
import { classifyReviews, isAllowedStoreCode, toApiPayload } from "./store-codes.js";
import { EMPTY, FILLED, listingBlock, reviewCard, reviewsFeed, standardFeed } from "./fixtures.mjs";

/**
 * THE PARSER'S TESTS.
 *
 * WHAT THESE PROVE: that given markup carrying the signals confirmed on the
 * live page, the parser reads the right rating, the right name, the right text,
 * the right response state and the right store — and that it collapses nested
 * duplicates, ignores another business, and refuses what it cannot read.
 *
 * WHAT THEY CANNOT PROVE, stated here rather than in a handoff nobody reads
 * twice: that Google's markup still carries those signals TODAY. No fixture can
 * establish that; only running the extension against the live Reviews page can,
 * which is why the QA script starts with one real location.
 *
 * Every name and every review id below is invented. See `fixtures.mjs`.
 */

function render(html) {
  document.body.innerHTML = html;
  return document;
}

function only(html) {
  const parsed = parseReviewsFromDocument(render(html));
  expect(parsed.reviews).toHaveLength(1);
  return parsed.reviews[0];
}

beforeEach(() => {
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------- ratings --- */

describe("star ratings", () => {
  it.each([1, 2, 3, 4, 5])(
    "reads %i filled stars when there is no aria-label to read",
    (rating) => {
      const review = only(
        listingBlock({
          business: "Sun Tan City - KS Manhattan",
          storeCode: "306",
          cards: [reviewCard({ lid: "FIXTURE-RATE-001", reviewer: "Nell Arden", rating })],
        }),
      );
      expect(review.rating).toBe(rating);
      expect(review.strategies.rating).toBe("filled-star-color");
    },
  );

  it("prefers the aria-label, which is the rung least likely to be restyled away", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - KS Manhattan",
        storeCode: "306",
        cards: [
          reviewCard({
            lid: "FIXTURE-RATE-002",
            reviewer: "Nell Arden",
            rating: 4,
            withAriaLabel: true,
          }),
        ],
      }),
    );
    expect(review.rating).toBe(4);
    expect(review.strategies.rating).toBe("aria-label");
  });

  it("counts filled against unfilled rather than counting star elements", () => {
    /*
     * THE REGRESSION THIS PINS. Five star elements are always present; only
     * their colour says what the customer gave. A parser that counted elements
     * would report five stars for every review on the page and the weekly
     * number would be perfect and meaningless.
     */
    const card = render(
      `<div data-lid="FIXTURE-RATE-003">
         <div role="img">
           <span style="color: ${FILLED}">star</span>
           <span style="color: ${FILLED}">star</span>
           <span style="color: ${EMPTY}">star_border</span>
           <span style="color: ${EMPTY}">star_border</span>
           <span style="color: ${EMPTY}">star_border</span>
         </div>
       </div>`,
    ).querySelector("[data-lid]");

    expect(extractRating(card)).toEqual({ rating: 2, strategy: "filled-star-color" });
  });

  it("refuses a review whose rating cannot be read rather than guessing one", () => {
    /*
     * A GUESSED RATING SILENTLY MOVES THE OFFICIAL WEEKLY COUNT, which is the
     * one number this whole system exists to get right. Refusing is the only
     * safe answer, and the review is reported as unreadable so somebody looks.
     */
    const parsed = parseReviewsFromDocument(
      render(
        `<div data-lid="FIXTURE-RATE-004">
           <img alt="Photo of Nell Arden" src="data:," />
           <div class="comment">No stars rendered at all in this markup.</div>
         </div>`,
      ),
    );

    expect(parsed.reviews).toHaveLength(0);
    expect(parsed.unreadable).toEqual([
      { externalReviewId: "FIXTURE-RATE-004", reason: "no_readable_rating" },
    ]);
  });
});

/* ------------------------------------------------------- names and text --- */

describe("reviewer name and review text", () => {
  it("reads the reviewer's name from the avatar's alt text", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - KS Manhattan",
        storeCode: "306",
        cards: [
          reviewCard({
            lid: "FIXTURE-NAME-001",
            reviewer: "Tamsin Vale",
            rating: 3,
            text: "The staff were friendly once I had been waiting a little while.",
          }),
        ],
      }),
    );
    expect(review.reviewerName).toBe("Tamsin Vale");
    expect(review.strategies.reviewerName).toBe("avatar-alt");
  });

  it("reads the comment and keeps it apart from the name and the date", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - NE Kearney",
        storeCode: "143",
        cards: [
          reviewCard({
            lid: "FIXTURE-TEXT-001",
            reviewer: "Mirela Fenn",
            rating: 2,
            text: "Waited too long at the front desk and nobody acknowledged me.",
            relativeDate: "2 days ago",
          }),
        ],
      }),
    );
    expect(review.reviewText).toBe(
      "Waited too long at the front desk and nobody acknowledged me.",
    );
    expect(review.relativeDateText).toBe("2 days ago");
  });

  it("returns null text for a rating-only review rather than an empty string", () => {
    /*
     * NULL AND "" ARE DIFFERENT FACTS. Null is "Google carried no words", which
     * the dashboard prints as "Rating only — no written comment."; an empty
     * string would be indistinguishable from a parser that failed to find the
     * comment, and one of those is a bug.
     */
    const review = only(
      listingBlock({
        business: "Sun Tan City - NE Lincoln 27th Street",
        storeCode: "144",
        cards: [
          reviewCard({
            lid: "FIXTURE-TEXT-002",
            reviewer: "Ada Quill",
            rating: 5,
            text: null,
          }),
        ],
      }),
    );
    expect(review.reviewText).toBeNull();
    expect(review.rating).toBe(5);
  });

  it("does not mistake the owner's reply for the customer's comment", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - NE Lincoln 27th Street",
        storeCode: "144",
        cards: [
          reviewCard({
            lid: "FIXTURE-TEXT-003",
            reviewer: "Ada Quill",
            rating: 5,
            text: null,
            ownerResponse:
              "Thank you for the five stars, we are glad the visit went well for you.",
          }),
        ],
      }),
    );
    expect(review.reviewText).toBeNull();
    expect(review.ownerResponseText).toContain("Thank you for the five stars");
  });
});

/* ----------------------------------------------------- response status ---- */

describe("response status", () => {
  it("reports needs-response when Google is still offering a Reply control", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - KS Manhattan",
        storeCode: "306",
        cards: [
          reviewCard({
            lid: "FIXTURE-RESP-001",
            reviewer: "Orrin Blake",
            rating: 1,
            text: "Bed was not cleaned between appointments and nobody checked.",
          }),
        ],
      }),
    );
    expect(review.hasOwnerResponse).toBe(false);
    expect(review.ownerResponseText).toBeNull();
    expect(review.replyButtonPresent).toBe(true);
  });

  it("reports responded, with the reply and its date, when the owner has answered", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - NE Lincoln 27th Street",
        storeCode: "144",
        cards: [
          reviewCard({
            lid: "FIXTURE-RESP-002",
            reviewer: "Petra Moss",
            rating: 5,
            text: "Easiest membership upgrade I have ever done, took two minutes flat.",
            ownerResponse: "Thanks Petra, that is exactly how it should work.",
            ownerResponseDate: "1 day ago",
          }),
        ],
      }),
    );
    expect(review.hasOwnerResponse).toBe(true);
    expect(review.ownerResponseText).toBe(
      "Thanks Petra, that is exactly how it should work.",
    );
    expect(review.ownerResponseDateText).toBe("1 day ago");
    expect(review.replyButtonPresent).toBe(false);
  });

  it("finds the reply by its label rather than by a class name", () => {
    const card = render(
      `<div data-lid="FIXTURE-RESP-003">
         <section class="whatever-google-calls-it-this-week">
           <p>Your reply</p>
           <span>5 days ago</span>
           <p>We are sorry about the wait and have added cover on weekends.</p>
         </section>
       </div>`,
    ).querySelector("[data-lid]");

    const response = extractOwnerResponse(card);
    expect(response.hasOwnerResponse).toBe(true);
    expect(response.ownerResponseText).toContain("added cover on weekends");
    expect(response.ownerResponseDateText).toBe("5 days ago");
    expect(hasReplyButton(card)).toBe(false);
  });
});

/* ------------------------------------------------- nested duplicate lids -- */

describe("nested elements sharing one data-lid", () => {
  it("collapses them to one review and keeps the outermost element", () => {
    /*
     * GOOGLE'S OWN MARKUP DOES THIS. Without the collapse a page of twelve
     * reviews posts twenty-four records, and although the database's unique
     * constraint would absorb them, every count the manager reads would be
     * doubled on the way there.
     */
    const parsed = parseReviewsFromDocument(
      render(
        listingBlock({
          business: "Sun Tan City - KS Manhattan",
          storeCode: "306",
          cards: [
            reviewCard({
              lid: "FIXTURE-DUPE-001",
              reviewer: "Tamsin Vale",
              rating: 3,
              text: "Perfectly fine visit, nothing to complain about really.",
              nested: true,
            }),
          ],
        }),
      ),
    );

    expect(parsed.discovered).toBe(1);
    expect(parsed.duplicatesCollapsed).toBe(1);
    expect(parsed.reviews).toHaveLength(1);
    expect(parsed.reviews[0].externalReviewId).toBe("FIXTURE-DUPE-001");
    /* The outermost element is the one kept, so every field is still reachable. */
    expect(parsed.reviews[0].reviewerName).toBe("Tamsin Vale");
    expect(parsed.reviews[0].rating).toBe(3);
  });

  it("keeps the outer element when the markup is walked inner-first", () => {
    const { cards, duplicatesCollapsed } = findReviewCards(
      render(
        `<div id="outer" data-lid="FIXTURE-DUPE-002">
           <div id="inner" data-lid="FIXTURE-DUPE-002"><span>body</span></div>
         </div>`,
      ),
    );
    expect(duplicatesCollapsed).toBe(1);
    expect(cards.get("FIXTURE-DUPE-002").id).toBe("outer");
  });
});

/* --------------------------------------------------------- the listing --- */

describe("store codes and other businesses", () => {
  it("resolves a review's store code from the listing chip above it", () => {
    const review = only(
      listingBlock({
        business: "Sun Tan City - KS Manhattan",
        storeCode: "306",
        cards: [
          reviewCard({ lid: "FIXTURE-CODE-001", reviewer: "Nell Arden", rating: 4 }),
        ],
      }),
    );
    expect(review.storeCode).toBe("306");
    expect(review.businessName).toMatch(/Sun Tan City/);
  });

  it("does not read a store code out of the review's own prose", () => {
    /*
     * THE FAILURE THIS PREVENTS is the quiet one: a comment mentioning a number
     * becomes a store code, and the review is filed against a salon the
     * customer never visited.
     */
    const listing = extractListing(
      render(
        `<div data-lid="FIXTURE-CODE-002">
           <div class="comment">I have been going to this store since 2019 and it is great.</div>
         </div>`,
      ).querySelector("[data-lid]"),
    );
    expect(listing.storeCode).toBeNull();
  });

  it("ignores a Buff City Soap review without reporting it as a problem", () => {
    const parsed = parseReviewsFromDocument(
      render(
        listingBlock({
          business: "Buff City Soap - Lincoln",
          storeCode: "881",
          cards: [
            reviewCard({
              lid: "FIXTURE-BCS-0001",
              reviewer: "Rowan Dell",
              rating: 5,
              text: "Lovely soap and a really nice smell in the shop.",
            }),
          ],
        }),
      ),
    );

    const { send, ignoredOther, unknownStore } = classifyReviews(parsed.reviews);
    expect(send).toHaveLength(0);
    expect(ignoredOther).toHaveLength(1);
    /* Not a finding: another business on the same account is the normal case. */
    expect(unknownStore).toHaveLength(0);
  });

  it("rejects an unlisted Sun Tan City store and reports it as needing a look", () => {
    const parsed = parseReviewsFromDocument(
      render(
        listingBlock({
          business: "Sun Tan City - Somewhere Else",
          storeCode: "999",
          cards: [
            reviewCard({
              lid: "FIXTURE-UNK-0001",
              reviewer: "Casper Lune",
              rating: 4,
              text: "Good visit and the team on the desk were friendly today.",
            }),
          ],
        }),
      ),
    );

    const { send, ignoredOther, unknownStore } = classifyReviews(parsed.reviews);
    expect(send).toHaveLength(0);
    expect(ignoredOther).toHaveLength(0);
    /* One of OURS being dropped is a finding, and is counted separately. */
    expect(unknownStore).toHaveLength(1);
    expect(isAllowedStoreCode("999")).toBe(false);
  });
});

/* ------------------------------------------------------- the whole feed --- */

describe("the combined reviews feed", () => {
  it("reads every listing, keeps the fifteen and drops the rest", () => {
    const parsed = parseReviewsFromDocument(render(standardFeed()));
    const { send, ignoredOther, unknownStore } = classifyReviews(parsed.reviews);

    /* Eight reviews across five listings, one of them nested twice. */
    expect(parsed.discovered).toBe(8);
    expect(parsed.duplicatesCollapsed).toBe(1);

    expect(send.map((review) => review.storeCode).sort()).toEqual([
      "143",
      "144",
      "144",
      "144",
      "306",
      "306",
    ]);
    expect(ignoredOther).toHaveLength(1);
    expect(unknownStore).toHaveLength(1);
  });

  it("sends only review facts — no business name, no strategy record", () => {
    const parsed = parseReviewsFromDocument(render(standardFeed()));
    const { send } = classifyReviews(parsed.reviews);
    const payload = toApiPayload(send);

    for (const record of payload) {
      expect(Object.keys(record).sort()).toEqual([
        "externalReviewId",
        /* Where it sat on the page. The server decides what that means. */
        "feedPosition",
        "hasOwnerResponse",
        "ownerResponseDateText",
        "ownerResponseText",
        "rating",
        "relativeDateText",
        "reviewText",
        "reviewerName",
        "storeCode",
      ]);
    }
  });

  it("numbers each listing's run from the top, and numbers them separately", () => {
    /*
     * THE ORDER IS WHAT THE REPORTING PERIOD RESTS ON. ASK Sunny counts the
     * reviews above a listing's last-counted one, so it needs to know which
     * were above which — and the page is the only place that exists.
     *
     * PER LISTING, not across the page: on the combined feed the listings
     * follow one another, and a global index would make one salon's third
     * review comparable with another salon's first.
     */
    const parsed = parseReviewsFromDocument(render(standardFeed()));
    const { send } = classifyReviews(parsed.reviews);
    const payload = toApiPayload(send);

    const byStore = {};
    for (const record of payload) {
      byStore[record.storeCode] = byStore[record.storeCode] ?? [];
      byStore[record.storeCode].push(record.feedPosition);
    }

    /* KS Manhattan has two, NE Lincoln 27th has three, NE Kearney has one. */
    expect(byStore["306"]).toEqual([0, 1]);
    expect(byStore["144"]).toEqual([0, 1, 2]);
    expect(byStore["143"]).toEqual([0]);
  });

  it("carries a parser version, so a bad read can be traced to the parser", () => {
    const parsed = parseReviewsFromDocument(render(standardFeed()));
    expect(parsed.parserVersion).toBe(PARSER_VERSION);
    expect(PARSER_VERSION).toMatch(/^\d{4}\.\d{2}\.\d{2}-\d+$/);
  });

  it("tells a page with no reviews apart from a page it can read", () => {
    expect(looksLikeReviewsPage(render("<main><p>Signed out</p></main>"))).toBe(false);
    expect(looksLikeReviewsPage(render(standardFeed()))).toBe(true);
  });
});

/* -------------------------------------------------------- the QA shapes --- */

describe("one review of each shape the QA script walks through", () => {
  const cases = [
    { rating: 1, qualifying: false },
    { rating: 2, qualifying: false },
    { rating: 3, qualifying: true },
    { rating: 4, qualifying: true },
    { rating: 5, qualifying: true },
  ];

  it.each(cases)(
    "a $rating-star review parses and its weekly eligibility is $qualifying",
    ({ rating, qualifying }) => {
      const review = only(
        listingBlock({
          business: "Sun Tan City - KS Manhattan",
          storeCode: "306",
          cards: [
            reviewCard({
              lid: `FIXTURE-SHAPE-00${rating}`,
              reviewer: "Nell Arden",
              rating,
              text: "A comment long enough to be read as a comment rather than a label.",
            }),
          ],
        }),
      );

      expect(review.rating).toBe(rating);
      /*
       * THE RULE ITSELF IS NOT THE PARSER'S TO APPLY — `eligible_for_weekly_count`
       * is generated in the database from the rating. This asserts the input
       * that rule reads, which is the parser's actual responsibility.
       */
      expect(review.rating >= 3).toBe(qualifying);
    },
  );
});

/* --------------------------------------------------- the reviewer helper -- */

describe("extractReviewerName", () => {
  it("does not return a relative date as somebody's name", () => {
    const card = render(
      `<div data-lid="FIXTURE-NAME-002"><span>7 hours ago</span><span>Nell Arden</span></div>`,
    ).querySelector("[data-lid]");
    expect(extractReviewerName(card).name).toBe("Nell Arden");
  });

  it("does not return the owner-response label as somebody's name", () => {
    const card = render(
      `<div data-lid="FIXTURE-NAME-003">
         <span>Response from the owner</span>
         <span>Nell Arden</span>
       </div>`,
    ).querySelector("[data-lid]");
    expect(extractReviewerName(card).name).toBe("Nell Arden");
  });
});

describe("extractReviewText", () => {
  it("ignores short labels and returns the sentence", () => {
    const card = render(
      `<div data-lid="FIXTURE-TEXT-004">
         <span>New</span>
         <span>Nell Arden</span>
         <span>2 days ago</span>
         <div>The team remembered my name and had me in and out in ten minutes.</div>
       </div>`,
    ).querySelector("[data-lid]");

    expect(extractReviewText(card, null)).toBe(
      "The team remembered my name and had me in and out in ten minutes.",
    );
  });
});

describe("the feed wrapper", () => {
  it("finds reviews inside the page wrapper the live feed uses", () => {
    const parsed = parseReviewsFromDocument(
      render(
        reviewsFeed([
          listingBlock({
            business: "Sun Tan City - MO St Joseph",
            storeCode: "409",
            cards: [
              reviewCard({ lid: "FIXTURE-FEED-001", reviewer: "Nell Arden", rating: 5 }),
            ],
          }),
        ]),
      ),
    );
    expect(parsed.reviews[0].storeCode).toBe("409");
  });
});
