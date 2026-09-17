/**
 * ============================================================================
 * THE GOOGLE BUSINESS PROFILE REVIEW PARSER — the only place Google's markup
 * is understood.
 * ============================================================================
 *
 * Every selector, pattern and colour this extension knows about Google's DOM is
 * in `PARSER_CONFIG` below. That is the whole design: Google ships markup
 * changes without notice, so when one lands, ONE OBJECT changes and the rest of
 * the extension, the API and the dashboard are untouched.
 *
 * ============================================================================
 * WHAT IT READS, AND WHAT IT REFUSES TO
 * ============================================================================
 *
 * It reads the review content Google has ALREADY RENDERED to an authorized
 * person who is already signed in: the review id, the store code, the
 * reviewer's display name, the stars, the comment, and whether the business has
 * replied.
 *
 * IT DOES NOT READ, AND HAS NO CODE THAT COULD READ: cookies, `localStorage`,
 * session tokens, OAuth tokens, form fields, password inputs, or anything on
 * any other page. It never navigates, never submits, never clicks. It is a
 * read-only pass over one document that is already open.
 *
 * ============================================================================
 * DEFENSIVE PARSING, AND WHY THE ORDER OF THE STRATEGIES IS THE DESIGN
 * ============================================================================
 *
 * Google's class names are minified and rotate. Anything built on
 * `.fontBodyMedium` is built on sand, so each field is read by a LADDER of
 * strategies from most durable to least, and the first that yields a usable
 * value wins:
 *
 *   SEMANTIC FIRST — `data-lid`, `aria-label`, `role`, `alt`. These exist
 *   because assistive technology needs them, which makes them the most stable
 *   thing on the page: Google can restyle freely and cannot quietly drop them
 *   without breaking a screen reader.
 *
 *   RENDERED STATE SECOND — the computed colour of a star. A filled Google star
 *   currently computes to rgb(251, 188, 4). This survives a class rename
 *   because it is what the class DOES rather than what it is called.
 *
 *   STRUCTURE AND TEXT LAST — glyphs, label phrases, element relationships.
 *
 *   MINIFIED CLASS NAMES: NEVER. There is not one in this file.
 *
 * Every review records WHICH strategy answered, in `strategies`. When a field
 * starts coming back wrong, that is what says which rung of which ladder broke.
 *
 * ============================================================================
 * THIS FILE IS AN ES MODULE ON PURPOSE
 * ============================================================================
 *
 * A Manifest V3 content script is a classic script and cannot `import`. It can,
 * however, `await import(chrome.runtime.getURL(...))` a module listed in
 * `web_accessible_resources`, which is what `content.js` does — and it means
 * the SAME FILE the extension runs is the file the tests import directly under
 * jsdom. A parser tested through a copy is a parser tested somewhere else.
 */

/**
 * The parser's identity, sent with every sync and stored on every review.
 *
 * BUMP IT WHENEVER EXTRACTION CHANGES. It is what answers "which records did
 * the broken parser write?" three weeks after somebody notices a field is
 * wrong, and a version that lags the code cannot answer that.
 */
export const PARSER_VERSION = "2026.09.17-1";

/**
 * ============================================================================
 * THE ONE OBJECT TO EDIT WHEN GOOGLE CHANGES ITS MARKUP
 * ============================================================================
 */
export const PARSER_CONFIG = {
  /**
   * The review id. Verified against the live page in Brave DevTools: every
   * review element carries it, and nested elements within one review share it.
   */
  reviewIdAttribute: "data-lid",

  /**
   * A FILLED STAR'S COLOUR. Verified on the live page: filled stars compute to
   * rgb(251, 188, 4) — #FBBC04, Google's own yellow. Several spellings are
   * listed because `getComputedStyle` normalises differently across engines and
   * because a fixture may write the hex form.
   */
  filledStarColors: ["rgb(251,188,4)", "#fbbc04", "rgba(251,188,4,1)"],

  /** Leaf text that means "this element is a star". */
  starGlyphs: ["star", "grade", "★", "☆", "star_border", "star_half", "star_outline"],

  /** Leaf text that means "this star is NOT filled", whatever colour it is. */
  emptyStarGlyphs: ["star_border", "☆", "star_outline"],

  /** "4 stars", "Rated 4.0 out of 5". Read off aria-label, the durable rung. */
  ratingPattern: /(\d(?:[.,]\d)?)\s*(?:out of\s*5\s*)?star/i,

  /** The control offered when nothing has been replied yet. */
  replyButtonPattern: /^\s*(reply|respond|reply to review|write a reply)\s*$/i,

  /** The heading Google puts above a reply the business has already written. */
  ownerResponseLabelPattern:
    /(response from the owner|owner response|your reply|reply from the owner|replied by the owner|response from owner)/i,

  /** "7 hours ago", "2 days ago", "a week ago", "yesterday". */
  relativeDatePattern:
    /^(?:(?:an?|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|just now|yesterday|today|edited\s+\d+\s+\w+\s+ago)$/i,

  /** The business name that identifies one of ours. Everything else is ignored. */
  businessNamePattern: /sun\s*tan\s*city/i,

  /**
   * How a store code appears beside a listing name.
   *
   * THE LABELLED FORMS ARE TRIED ON ANY TEXT, because "Store code: 306" cannot
   * be mistaken for anything else — a phone number, a street number or a year
   * does not carry that prefix.
   */
  labelledStoreCodePatterns: [
    /store\s*code\s*[:#-]?\s*(\d{1,8})\b/i,
    /\bstore\s*#?\s*(\d{1,8})\b/i,
  ],

  /**
   * The bare trailing code — "Sun Tan City - KS Manhattan · 306".
   *
   * ONLY APPLIED TO SHORT TEXT, and that restriction is the whole reason it is
   * a separate pattern. On a review comment it would happily match a year, a
   * house number or a price and file somebody's review against a salon that
   * does not exist. A location chip is a label, and a label is short.
   */
  trailingStoreCodePattern: /[·•|–-]\s*(\d{2,6})\s*$/,

  /** How far up the tree to look for the listing a review belongs to. */
  ancestorSearchDepth: 8,

  /** Longer than this and a text node is a comment, not a name or a date. */
  shortTextLimit: 80,
};

/** A colour in a shape the config can be compared against. */
function normaliseColor(value) {
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/\s+/g, "");
}

function normaliseText(value) {
  if (typeof value !== "string") return "";
  /* Non-breaking spaces are everywhere in Google's markup and are not spaces. */
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Leaf elements only: the ones that actually carry a glyph or a word. */
function leaves(element) {
  return Array.from(element.querySelectorAll("*")).filter(
    (node) => node.children.length === 0,
  );
}

/**
 * The computed colour, or the inline one when there is no view.
 *
 * jsdom has no layout engine and `getComputedStyle` there resolves inline
 * styles only. That is exactly what the fixtures provide, and in the real
 * browser the same call resolves the stylesheet — so one code path serves both
 * and neither is a simulation of the other.
 */
function colorOf(element) {
  const view = element.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    try {
      const computed = view.getComputedStyle(element).color;
      if (computed) return normaliseColor(computed);
    } catch {
      /* Some elements throw in exotic documents. Fall through to inline. */
    }
  }
  return normaliseColor(element.style?.color ?? "");
}

function isFilledStarColor(element) {
  const color = colorOf(element);
  return PARSER_CONFIG.filledStarColors.some(
    (candidate) => normaliseColor(candidate) === color,
  );
}

/* ---------------------------------------------------------------- rating -- */

/**
 * The star rating, 1-5.
 *
 * THREE RUNGS, and the first that answers wins:
 *
 *   1. `aria-label`. "4 stars" is written for a screen reader and is the most
 *      durable thing on the card.
 *   2. FILLED STAR COUNT. Google draws five Material Icon spans and colours the
 *      earned ones #FBBC04. This is the strategy that was verified by hand
 *      against real reviews in Brave DevTools.
 *   3. GLYPH COUNT. `★` versus `☆`, for a rendering that uses characters.
 *
 * Returns `{ rating, strategy }`, or a null rating when no rung answered — a
 * review with no readable rating is REFUSED rather than guessed at, because a
 * guessed rating silently moves the official weekly count.
 */
export function extractRating(card) {
  const labelled = [card, ...card.querySelectorAll("[aria-label]")];
  for (const element of labelled) {
    const label = element.getAttribute?.("aria-label");
    if (!label) continue;
    const match = PARSER_CONFIG.ratingPattern.exec(label);
    if (!match) continue;
    const value = Math.round(Number(match[1].replace(",", ".")));
    if (value >= 1 && value <= 5) return { rating: value, strategy: "aria-label" };
  }

  const glyphLeaves = leaves(card).filter((node) => {
    const text = normaliseText(node.textContent).toLowerCase();
    if (PARSER_CONFIG.starGlyphs.includes(text)) return true;
    const className = typeof node.className === "string" ? node.className : "";
    return /star/i.test(className) || /star/i.test(node.getAttribute("aria-hidden") ?? "");
  });

  if (glyphLeaves.length >= 5) {
    /* Only the first five: a card can carry the business's own rating too. */
    const stars = glyphLeaves.slice(0, 5);

    const filledByColor = stars.filter((node) => {
      const text = normaliseText(node.textContent).toLowerCase();
      if (PARSER_CONFIG.emptyStarGlyphs.includes(text)) return false;
      return isFilledStarColor(node);
    }).length;
    if (filledByColor >= 1 && filledByColor <= 5) {
      return { rating: filledByColor, strategy: "filled-star-color" };
    }

    const filledByGlyph = stars.filter((node) => {
      const text = normaliseText(node.textContent).toLowerCase();
      return text === "star" || text === "grade" || text === "★";
    }).length;
    if (filledByGlyph >= 1 && filledByGlyph <= 5) {
      return { rating: filledByGlyph, strategy: "star-glyph" };
    }
  }

  return { rating: null, strategy: "none" };
}

/* ------------------------------------------------------- owner response -- */

/**
 * The business's own reply, if there is one.
 *
 * TWO INDEPENDENT SIGNALS, and they are read separately on purpose:
 *
 *   THE LABEL. Google heads a written reply with "Response from the owner" or
 *   similar. Finding it means there IS a reply, and the words after it are it.
 *
 *   THE REPLY BUTTON. Google offers "Reply" on a review with no response. Its
 *   ABSENCE is weak evidence of a response and its PRESENCE is strong evidence
 *   of none — so it is used to confirm "needs response", never on its own to
 *   claim one exists.
 *
 * The label wins where they disagree, because a reply whose text is on the page
 * is a fact and a missing button is an inference.
 */
export function extractOwnerResponse(card) {
  const candidates = Array.from(card.querySelectorAll("*"));

  for (const element of candidates) {
    const own = normaliseText(directText(element));
    if (!own || !PARSER_CONFIG.ownerResponseLabelPattern.test(own)) continue;

    /*
     * The label's container holds the reply. Its own text minus the label is
     * the response; where the label sits in a sibling heading, the following
     * block is read instead.
     */
    const container = element.parentElement ?? element;
    const whole = normaliseText(container.textContent);
    const withoutLabel = normaliseText(
      whole.replace(PARSER_CONFIG.ownerResponseLabelPattern, " "),
    );

    const dateText = findRelativeDate(container);
    const body = normaliseText(
      dateText ? withoutLabel.replace(dateText, " ") : withoutLabel,
    );

    return {
      hasOwnerResponse: true,
      ownerResponseText: body.length > 0 ? body : null,
      ownerResponseDateText: dateText,
      container,
      strategy: "owner-response-label",
    };
  }

  return {
    hasOwnerResponse: false,
    ownerResponseText: null,
    ownerResponseDateText: null,
    container: null,
    strategy: "none",
  };
}

/** Whether Google is still offering a Reply control on this review. */
export function hasReplyButton(card) {
  const controls = Array.from(card.querySelectorAll('button, [role="button"], a'));
  return controls.some((control) => {
    const label = normaliseText(
      control.getAttribute("aria-label") ?? control.textContent ?? "",
    );
    return PARSER_CONFIG.replyButtonPattern.test(label);
  });
}

/** The text a node owns directly, ignoring what its children contribute. */
function directText(element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3 /* TEXT_NODE */)
    .map((node) => node.textContent)
    .join(" ");
}

function findRelativeDate(element) {
  for (const node of leaves(element)) {
    const text = normaliseText(node.textContent);
    if (text && PARSER_CONFIG.relativeDatePattern.test(text)) return text;
  }
  const own = normaliseText(directText(element));
  return own && PARSER_CONFIG.relativeDatePattern.test(own) ? own : null;
}

/* -------------------------------------------------------- reviewer name -- */

/**
 * The reviewer's display name.
 *
 * THE AVATAR'S ALT TEXT FIRST. Google writes "Photo of Jane Smith" for a screen
 * reader, which makes it both the most durable source and an unambiguous one —
 * it cannot be confused with a date or a store code the way a bare text node
 * can.
 */
export function extractReviewerName(card, exclude) {
  for (const image of card.querySelectorAll("img[alt]")) {
    const alt = normaliseText(image.getAttribute("alt"));
    const match = /^(?:photo of|profile photo of|avatar of)\s+(.{1,120})$/i.exec(alt);
    if (match) return { name: normaliseText(match[1]), strategy: "avatar-alt" };
    /* Some listings write the bare name. Accept it when it looks like one. */
    if (alt && alt.length <= PARSER_CONFIG.shortTextLimit && !looksLikeNoise(alt)) {
      return { name: alt, strategy: "avatar-alt-bare" };
    }
  }

  const headings = card.querySelectorAll('[role="heading"], h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    if (exclude && exclude.contains(heading)) continue;
    const text = normaliseText(heading.textContent);
    if (text && text.length <= PARSER_CONFIG.shortTextLimit && !looksLikeNoise(text)) {
      return { name: text, strategy: "heading" };
    }
  }

  /*
   * LAST RUNG: the first short leaf that is not a date, a rating, a store code
   * or a control. Deliberately last — it is the rung most likely to pick up
   * something that merely looks like a name.
   */
  for (const node of leaves(card)) {
    if (exclude && exclude.contains(node)) continue;
    const text = normaliseText(node.textContent);
    if (!text || text.length > PARSER_CONFIG.shortTextLimit) continue;
    if (looksLikeNoise(text)) continue;
    /* A name has letters and is not a sentence. */
    if (!/[A-Za-z]/.test(text) || text.split(" ").length > 6) continue;
    return { name: text, strategy: "first-short-text" };
  }

  return { name: null, strategy: "none" };
}

function looksLikeNoise(text) {
  const value = normaliseText(text).toLowerCase();
  if (value.length === 0) return true;
  if (PARSER_CONFIG.relativeDatePattern.test(value)) return true;
  if (PARSER_CONFIG.starGlyphs.includes(value)) return true;
  if (PARSER_CONFIG.replyButtonPattern.test(value)) return true;
  if (PARSER_CONFIG.ownerResponseLabelPattern.test(value)) return true;
  if (/^\d+([.,]\d+)?$/.test(value)) return true;
  if (/^(store\s*code|posted|edited|like|share|see more|read more|new)\b/.test(value)) {
    return true;
  }
  return false;
}

/* ----------------------------------------------------------- review text -- */

/**
 * The customer's own words, or null.
 *
 * NULL IS A REAL ANSWER. A rating with no comment is common on Google, and the
 * dashboard prints "Rating only — no written comment." for it. Returning an
 * empty string instead would make a silent review indistinguishable from one
 * whose text the parser failed to find, which is the difference between a
 * normal record and a bug.
 *
 * The owner's reply is excluded by SUBTREE rather than by matching its text: a
 * business that quotes the customer back at them would otherwise delete the
 * customer's comment from the record.
 */
export function extractReviewText(card, responseContainer) {
  let best = null;

  for (const element of card.querySelectorAll("*")) {
    if (responseContainer && responseContainer.contains(element)) continue;
    if (element.children.length > 0) continue;

    const text = normaliseText(element.textContent);
    if (!text || looksLikeNoise(text)) continue;
    /* A comment is longer than a name and is a sentence rather than a label. */
    if (text.length <= PARSER_CONFIG.shortTextLimit && text.split(" ").length < 5) continue;
    if (!best || text.length > best.length) best = text;
  }

  return best;
}

/* ------------------------------------------------------------ the listing -- */

/**
 * Which business and which store code a review belongs to.
 *
 * Searched on the card first and then up its ancestors, because on the combined
 * feed the listing is named once above a run of reviews rather than on each
 * one. The search is bounded so a miss walks a handful of parents rather than
 * the whole document and matching the page's own footer.
 */
export function extractListing(card) {
  let node = card;
  /*
   * THE WALK DOES NOT STOP AT A BUSINESS NAME, ONLY AT A STORE CODE, and that
   * ordering is load-bearing. Stopping at the first level that named a business
   * would stop at the review card itself the moment a customer wrote "Sun Tan
   * City" in their comment — and the store code, which is one level up, would
   * never be found. The name is remembered as it goes past; the code ends the
   * search.
   */
  let ourBusinessName = null;

  for (let depth = 0; node && depth <= PARSER_CONFIG.ancestorSearchDepth; depth += 1) {
    const found = listingFrom(node);
    if (!ourBusinessName && found.ourBusinessName) ourBusinessName = found.ourBusinessName;

    if (found.storeCode) {
      return {
        storeCode: found.storeCode,
        /*
         * OURS WINS OVER THE CHIP'S OWN LABEL when both are present, because
         * "Sun Tan City" is the thing the allowlist actually asks about. The
         * chip's label is what identifies somebody ELSE'S business, which is
         * the case that has to be distinguishable from "could not tell".
         */
        businessName: ourBusinessName ?? found.labelBusinessName,
        depth,
      };
    }
    node = node.parentElement;
  }

  return { storeCode: null, businessName: ourBusinessName, depth: -1 };
}

function listingFrom(element) {
  const candidates = [
    ...Array.from(element.querySelectorAll("[aria-label]")).map((node) =>
      node.getAttribute("aria-label"),
    ),
    ...leaves(element).map((node) => node.textContent),
    directText(element),
  ];

  let ourBusinessName = null;
  let storeCode = null;

  for (const raw of candidates) {
    const text = normaliseText(raw);
    if (!text) continue;

    if (!ourBusinessName && PARSER_CONFIG.businessNamePattern.test(text)) {
      ourBusinessName = text;
    }

    if (!storeCode) {
      for (const pattern of PARSER_CONFIG.labelledStoreCodePatterns) {
        const match = pattern.exec(text);
        if (match) {
          storeCode = match[1];
          break;
        }
      }
    }

    /* The bare trailing form, on label-length text only. See the config. */
    if (!storeCode && text.length <= PARSER_CONFIG.shortTextLimit) {
      const match = PARSER_CONFIG.trailingStoreCodePattern.exec(text);
      if (match) storeCode = match[1];
    }
  }

  /*
   * WHOSE BUSINESS IS THIS, WHEN IT IS NOT OURS?
   *
   * Only asked once a store code has been found, because that is what says this
   * element is a listing rather than a review card. The first label-length text
   * that is not noise is the chip's business name — which is how a Buff City
   * Soap review becomes "ignored, not one of ours" rather than "a Sun Tan City
   * review whose store could not be identified". Those are a normal Tuesday and
   * a parser defect respectively, and reporting them as one number would let
   * lost reviews hide inside an expected count.
   */
  let labelBusinessName = null;
  if (storeCode && !ourBusinessName) {
    for (const raw of candidates) {
      const text = normaliseText(raw);
      if (!text || text.length > PARSER_CONFIG.shortTextLimit) continue;
      if (looksLikeNoise(text)) continue;
      if (/store\s*code/i.test(text)) continue;
      if (!/[A-Za-z]/.test(text)) continue;
      labelBusinessName = text;
      break;
    }
  }

  return { storeCode, ourBusinessName, labelBusinessName };
}

/* ------------------------------------------------------------- the pass --- */

/**
 * Every review element on the page, deduplicated by `data-lid`.
 *
 * NESTED ELEMENTS SHARE A LID, which is the single most important thing about
 * this function. Google's markup puts the attribute on more than one element
 * per review, so a naive `querySelectorAll('[data-lid]')` returns the same
 * review several times. The OUTERMOST element for each lid is kept — the one
 * with no ancestor carrying the same lid — because it is the only one
 * guaranteed to contain every field.
 */
export function findReviewCards(root) {
  const all = Array.from(
    root.querySelectorAll(`[${PARSER_CONFIG.reviewIdAttribute}]`),
  );

  const byLid = new Map();
  let duplicatesCollapsed = 0;

  for (const element of all) {
    const lid = normaliseText(element.getAttribute(PARSER_CONFIG.reviewIdAttribute));
    if (!lid) continue;

    const existing = byLid.get(lid);
    if (!existing) {
      byLid.set(lid, element);
      continue;
    }

    duplicatesCollapsed += 1;
    /* Keep whichever contains the other; that is the review's real boundary. */
    if (element.contains(existing)) byLid.set(lid, element);
  }

  return { cards: byLid, duplicatesCollapsed };
}

/**
 * Read every review on the page.
 *
 * Returns extracted records and a diagnostic for each card that could not be
 * read. NOTHING IS FILTERED HERE — the store-code allowlist is applied by
 * `store-codes.js`, so this module has exactly one job and the allowlist has
 * exactly one owner.
 */
export function parseReviewsFromDocument(root) {
  const { cards, duplicatesCollapsed } = findReviewCards(root);

  const reviews = [];
  const unreadable = [];

  for (const [externalReviewId, card] of cards) {
    const response = extractOwnerResponse(card);
    const replyOffered = hasReplyButton(card);
    const { rating, strategy: ratingStrategy } = extractRating(card);
    const { name, strategy: nameStrategy } = extractReviewerName(
      card,
      response.container,
    );
    const listing = extractListing(card);

    if (rating === null) {
      unreadable.push({ externalReviewId, reason: "no_readable_rating" });
      continue;
    }
    if (!name) {
      unreadable.push({ externalReviewId, reason: "no_reviewer_name" });
      continue;
    }

    reviews.push({
      externalReviewId,
      storeCode: listing.storeCode,
      businessName: listing.businessName,
      reviewerName: name,
      rating,
      reviewText: extractReviewText(card, response.container),
      relativeDateText: findRelativeDate(card),
      hasOwnerResponse: response.hasOwnerResponse,
      ownerResponseText: response.ownerResponseText,
      ownerResponseDateText: response.ownerResponseDateText,
      /*
       * CARRIED FOR DIAGNOSIS, NOT SENT. The API decides "responded" from
       * `hasOwnerResponse` alone; this says whether Google was still offering
       * the control, which is how a disagreement between the two signals gets
       * noticed rather than silently resolved.
       */
      replyButtonPresent: replyOffered,
      strategies: {
        rating: ratingStrategy,
        reviewerName: nameStrategy,
        ownerResponse: response.strategy,
        listingDepth: listing.depth,
      },
    });
  }

  return {
    parserVersion: PARSER_VERSION,
    discovered: cards.size,
    duplicatesCollapsed,
    reviews,
    unreadable,
  };
}

/**
 * Whether this document looks like the Google reviews page at all.
 *
 * Used to tell "you are on the wrong page" apart from "you are on the right
 * page and Google has signed you out", which are different messages and
 * different fixes for the person reading them.
 */
export function looksLikeReviewsPage(root) {
  return root.querySelector(`[${PARSER_CONFIG.reviewIdAttribute}]`) !== null;
}
