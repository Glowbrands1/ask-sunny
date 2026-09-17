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
export const PARSER_VERSION = "2026.09.17-3";

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

  /**
   * How a rating is WRITTEN, wherever it is written — `aria-label`, `alt`,
   * `title`, or a visually-hidden span put there for a screen reader.
   *
   * THREE SHAPES, because Google does not use one. Live QA found reviews whose
   * rating the single old pattern could not read at all, and a review with no
   * readable rating is refused rather than guessed at — so a shape this list
   * does not know about is a review that silently never arrives.
   */
  ratingLabelPatterns: [
    /(\d(?:[.,]\d)?)\s*(?:out of\s*\d+\s*)?stars?\b/i,
    /\brated?\s+(\d(?:[.,]\d)?)\b/i,
    /(\d(?:[.,]\d)?)\s*(?:\/|out of)\s*5\b/i,
  ],

  /** Attributes a rating may be written into, in order of how durable they are. */
  ratingLabelAttributes: ["aria-label", "alt", "title", "aria-valuetext"],

  /**
   * ATTRIBUTES THAT SAY "THIS ELEMENT IS ONE STAR".
   *
   * Read with `getAttribute` rather than `.className`, and that is not a
   * detail: on an SVG element `className` is an `SVGAnimatedString` and not a
   * string at all, so the old `typeof node.className === "string"` guard
   * skipped every SVG star on the page. Google draws its stars as SVG.
   */
  starSignalAttributes: ["class", "aria-label", "alt", "title", "data-icon"],

  /** A signal naming a star. */
  starSignalPattern: /\bstars?\b|star[-_]?(?:border|half|outline|rate|rating|empty|off)|\bgrade\b/i,

  /** A signal naming a star that is explicitly NOT earned. */
  emptyStarSignalPattern: /star[-_]?(?:border|outline|empty|off)\b/i,

  /** The control offered when nothing has been replied yet. */
  replyButtonPattern: /^\s*(reply|respond|reply to review|write a reply)\s*$/i,

  /** The heading Google puts above a reply the business has already written. */
  ownerResponseLabelPattern:
    /(response from the owner|owner response|your reply|reply from the owner|replied by the owner|response from owner)/i,

  /** "7 hours ago", "2 days ago", "a week ago", "yesterday". */
  relativeDatePattern:
    /^(?:(?:an?|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|just now|yesterday|today|edited\s+\d+\s+\w+\s+ago)$/i,

  /**
   * The same thing found ANYWHERE in a longer string.
   *
   * Used to refuse a reviewer-name candidate that has swallowed the timestamp
   * beside it — "Abbi Tuma1 hour ago" is what a concatenated card reads as, and
   * storing it as somebody's name would be worse than storing nothing.
   */
  relativeDateAnywherePattern:
    /\b(?:an?|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago\b/i,

  /**
   * ============================================================================
   * GOOGLE'S OWN WORDS FOR "THIS PERSON DID NOT WRITE ANYTHING"
   * ============================================================================
   *
   * The Reviews page prints "The user didn't write a review, and has left just a
   * rating." in the place a comment would go. It is Google's interface text, not
   * the customer's, and storing it as a comment would put a sentence the
   * customer never wrote into a report and into a reply queue. A rating-only
   * review is `reviewText: null`, which the dashboard already renders as
   * "Rating only — no written comment."
   */
  ratingOnlyNoticePatterns: [
    /did\s*n[o'\u2019]?t write a review/i,
    /(?:has )?left (?:just )?a rating/i,
    /^no (?:written )?(?:review|comment)\.?$/i,
  ],

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
   * ONLY A FALLBACK, AND ONLY WHEN THE PAGE CARRIES NO LABELLED CODE AT ALL.
   * See `findStoreCodeMarkers`. A trailing run of digits is genuinely ambiguous:
   * "3252 Kimball Ave, Manhattan KS 66503-1234" ends in four digits after a
   * hyphen, and so does a phone number. Live QA found the old parser reading
   * exactly that kind of text and filing every review against a store nobody
   * has. So the labelled form wins everywhere it exists, and this is reached
   * only on a page that has no "Store code:" anywhere.
   */
  trailingStoreCodePattern: /(?:^|[·•|–—-])\s*(\d{2,6})\s*$/,

  /**
   * How far up the tree to look for the listing a review belongs to.
   *
   * GENEROUS ON PURPOSE. It used to be 8, chosen against a fixture where the
   * store code sat one element above the review. Google Business Profile nests
   * a review far deeper than that inside its own wrappers, and a walk that gave
   * up early reported "not Sun Tan City" for a page full of Sun Tan City
   * reviews. The walk is safe to make long because it STOPS AT THE FIRST
   * ANCESTOR CONTAINING A STORE-CODE MARKER and then picks the marker that owns
   * the review by document order — so reaching a shared container does not
   * mean guessing.
   */
  ancestorSearchDepth: 30,

  /** Longer than this and a text node is a comment, not a name or a date. */
  shortTextLimit: 80,

  /**
   * The most text a LOCATION HEADER can carry before it stops being one.
   *
   * A header is a business name, an address, maybe a phone number and the store
   * code. Anything materially longer is a container that has swallowed a review
   * body, and reading a store code out of it would associate the code with
   * whatever else it happens to contain.
   */
  headerTextLimit: 240,

  /** How far above a store code to look for the listing name beside it. */
  headerScopeDepth: 6,
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

/** The paint values an element states, in every form a star can be coloured. */
function paintValues(element) {
  const values = [];
  const view = element.ownerDocument?.defaultView;

  if (view && typeof view.getComputedStyle === "function") {
    try {
      const computed = view.getComputedStyle(element);
      /*
       * `fill` AS WELL AS `color`. An SVG star is painted by `fill`, and the
       * old pass read `color` alone — so an SVG star was never filled, however
       * yellow it looked.
       */
      if (computed.color) values.push(normaliseColor(computed.color));
      if (computed.fill) values.push(normaliseColor(computed.fill));
    } catch {
      /* Some elements throw in exotic documents. Fall through to the markup. */
    }
  }

  values.push(normaliseColor(element.style?.color ?? ""));
  values.push(normaliseColor(element.style?.fill ?? ""));
  /* `fill` is usually a presentation ATTRIBUTE on Google's paths, not a style. */
  values.push(normaliseColor(element.getAttribute?.("fill") ?? ""));

  return values.filter(Boolean);
}

function paintsFilled(element) {
  const values = paintValues(element);
  return PARSER_CONFIG.filledStarColors.some((candidate) =>
    values.includes(normaliseColor(candidate)),
  );
}

/** Everything an element says about itself, for star detection. */
function starSignals(element) {
  /*
   * `getAttribute("class")` RATHER THAN `.className`. On an SVG element
   * `className` is an `SVGAnimatedString` object; the old code guarded with
   * `typeof === "string"` and therefore skipped every SVG star silently.
   */
  return PARSER_CONFIG.starSignalAttributes
    .map((name) => element.getAttribute?.(name) ?? "")
    .join(" ");
}

function looksLikeOneStar(element) {
  const text = normaliseText(element.textContent).toLowerCase();
  if (PARSER_CONFIG.starGlyphs.includes(text)) return true;
  return PARSER_CONFIG.starSignalPattern.test(starSignals(element));
}

/** Drops any element that contains another element from the same list. */
function innermostElements(elements) {
  return elements.filter(
    (element) => !elements.some((other) => other !== element && element.contains(other)),
  );
}

/**
 * The elements drawing this card's stars, innermost first-class only.
 *
 * A rating is a container plus five icons plus, often, an SVG and a path
 * inside each. All of them may carry a "star" signal, and counting all of them
 * would give twenty-five stars. Keeping the innermost that still says "star"
 * gives the five icons.
 */
function starElements(card) {
  const found = [];
  for (const element of card.querySelectorAll("*")) {
    if (looksLikeOneStar(element)) found.push(element);
  }
  return innermostElements(found);
}

/** Whether this element says, in text or in an attribute, "unearned star". */
function looksLikeEmptyStar(element) {
  const text = normaliseText(element.textContent).toLowerCase();
  if (PARSER_CONFIG.emptyStarGlyphs.includes(text)) return true;
  return PARSER_CONFIG.emptyStarSignalPattern.test(starSignals(element));
}

/**
 * ============================================================================
 * THE EARNED STARS, FOUND BY PAINT ALONE
 * ============================================================================
 *
 * The rung that had to exist. Live QA's page draws each star as
 * `<svg class="NhWcyb"><path fill="#FBBC04"/></svg>` — a minified class that
 * says nothing, an element whose `className` is not even a string, and a colour
 * carried on `fill` rather than `color`. Nothing about that markup names a
 * star. The ONE thing it still states is Google's own yellow, which is why this
 * rung asks about paint and about nothing else.
 *
 * ONE SLOT PER STAR. The painted node is usually a `<path>` inside an `<svg>`
 * inside a container; counting painted nodes would count paths, so each painted
 * node is grown upward into the outermost ancestor that still holds only it.
 * Five stars give five slots however many wrappers Google puts around them.
 *
 * THE FIRST RUN ONLY. A card can carry a second set of stars — the business's
 * own aggregate rating — and the review's own comes first in document order, so
 * slots are kept only while they share the first one's parent.
 */
function paintedStarSlots(card) {
  const painted = innermostElements(
    Array.from(card.querySelectorAll("*")).filter(
      (element) => paintsFilled(element) && !looksLikeEmptyStar(element),
    ),
  );
  if (painted.length === 0) return [];

  const within = (node) => painted.filter((element) => node.contains(element)).length;

  const slots = [];
  for (const element of painted) {
    let slot = element;
    let node = element.parentElement;
    while (node && node !== card && within(node) === 1) {
      slot = node;
      node = node.parentElement;
    }
    if (!slots.includes(slot) && !looksLikeEmptyStar(slot)) slots.push(slot);
  }

  if (slots.length === 0) return [];
  const firstParent = slots[0].parentElement;
  return slots.filter((slot) => slot.parentElement === firstParent);
}

/** A rating written into an attribute or a visually hidden span. */
function ratingFromText(raw) {
  const text = normaliseText(raw);
  if (!text) return null;

  for (const pattern of PARSER_CONFIG.ratingLabelPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = Math.round(Number(match[1].replace(",", ".")));
    if (value >= 1 && value <= 5) return value;
  }
  return null;
}

/* ---------------------------------------------------------------- rating -- */

/**
 * The star rating, 1-5.
 *
 * ============================================================================
 * WHY THIS LADDER IS LONGER THAN IT WAS
 * ============================================================================
 *
 * Live QA found three real Sun Tan City reviews discovered on the page and all
 * three thrown away before a store code was ever looked for. A review with no
 * readable rating is REFUSED rather than guessed at — a guessed rating silently
 * moves the official weekly count — so every shape the rating can take has to
 * be readable, or correct behaviour becomes indistinguishable from data loss.
 *
 * The two things the old ladder could not see:
 *
 *   SVG STARS. Google draws each star as an `<svg>` with a `<path>`. The glyph
 *   rung filtered on `typeof node.className === "string"`, and on an SVG
 *   element `className` is an `SVGAnimatedString`, so the filter dropped every
 *   one of them. The fill rung then read `color` only, which an SVG star does
 *   not use.
 *
 *   RATINGS WRITTEN ANY WAY BUT "4 stars". One pattern on `aria-label` alone
 *   missed "Rated 5.0", "5/5" and a rating put in `title` or a hidden span.
 *
 * THE RUNGS, most durable first:
 *
 *   1. A WRITTEN RATING, in any of the attributes screen readers use. Text put
 *      there on purpose for assistive technology is the most stable signal on
 *      the card.
 *   2. FILLED STAR COUNT, by paint. Five icons, the earned ones #FBBC04 —
 *      verified by hand in Brave DevTools, and now read from `fill` as well as
 *      `color` and from the `fill` attribute as well as the computed style.
 *   3. FILLED STARS ONLY. Some renderings draw the earned stars and nothing
 *      else; where every star found is filled, the count is the rating.
 *   4. GLYPH COUNT, for a rendering using `★` and `☆` characters.
 *   5. A VISIBLE "4 stars" IN SHORT TEXT, anchored so a comment cannot match.
 */
export function extractRating(card) {
  /* 1. Written, in an attribute meant for a screen reader. */
  const labelled = [card, ...card.querySelectorAll("*")];
  for (const element of labelled) {
    for (const attribute of PARSER_CONFIG.ratingLabelAttributes) {
      const value = ratingFromText(element.getAttribute?.(attribute));
      if (value !== null) return { rating: value, strategy: `label:${attribute}` };
    }
  }

  /* 2. Paint. The rung that works when nothing on the card says "star". */
  const painted = paintedStarSlots(card);
  if (painted.length >= 1) {
    return { rating: Math.min(painted.length, 5), strategy: "filled-star-color" };
  }

  /*
   * 3. GLYPHS. For a rendering that spells its stars out — `★` against `☆`, or
   * Material's "star" against "star_border" — and paints them from a stylesheet
   * this parser could not resolve.
   */
  const stars = starElements(card);
  if (stars.length >= 1) {
    /* Only the first five: a card can carry the business's own rating too. */
    const group = stars.slice(0, 5);
    const glyphs = group.filter((node) => {
      const text = normaliseText(node.textContent).toLowerCase();
      return text === "star" || text === "grade" || text === "★";
    }).length;
    if (glyphs >= 1) return { rating: glyphs, strategy: "star-glyph" };
  }

  /* 4. Written where a person can see it. Anchored: a comment cannot match. */
  for (const node of leaves(card)) {
    const text = normaliseText(node.textContent);
    if (!text || text.length > PARSER_CONFIG.shortTextLimit) continue;
    if (!/^\d(?:[.,]\d)?\s*(?:out of\s*5\s*)?stars?(?:\s+rating)?$/i.test(text)) continue;
    const value = ratingFromText(text);
    if (value !== null) return { rating: value, strategy: "visible-text" };
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
  /* 1. THE AVATAR'S ALT TEXT. Written for a screen reader, so unambiguous. */
  for (const image of card.querySelectorAll("img[alt]")) {
    const alt = normaliseText(image.getAttribute("alt"));
    const match = /^(?:photo of|profile photo of|avatar of)\s+(.{1,120})$/i.exec(alt);
    if (match) return { name: normaliseText(match[1]), strategy: "avatar-alt" };
    /* Some listings write the bare name. Accept it when it looks like one. */
    if (alt && alt.length <= PARSER_CONFIG.shortTextLimit && !looksLikeNoise(alt)) {
      return { name: alt, strategy: "avatar-alt-bare" };
    }
  }

  /*
   * 2. THE SAME PHRASE IN AN ARIA-LABEL OR TITLE. Google's avatar is often a
   * `div` with a background image rather than an `img`, and then the name is
   * on the element itself. The old ladder looked for `img[alt]` and nothing
   * else at this rung, so on that rendering it fell through.
   */
  for (const element of card.querySelectorAll("[aria-label], [title]")) {
    for (const attribute of ["aria-label", "title"]) {
      const value = normaliseText(element.getAttribute(attribute));
      const match = /^(?:photo of|profile photo of|avatar of|review by|reviewed by)\s+(.{1,120})$/i.exec(
        value,
      );
      if (match) return { name: normaliseText(match[1]), strategy: `label:${attribute}` };
    }
  }

  /* 3. A HEADING. */
  const headings = card.querySelectorAll('[role="heading"], h1, h2, h3, h4, h5, h6');
  for (const heading of headings) {
    if (exclude && exclude.contains(heading)) continue;
    const text = normaliseText(heading.textContent);
    if (text && couldBeName(text)) return { name: text, strategy: "heading" };
  }

  /*
   * 4. THE FIRST SMALL ELEMENT WHOSE WHOLE TEXT READS LIKE A NAME.
   *
   * Above the leaf rung on purpose. Google splits a name across spans inside a
   * link — `<a><span>Abbi</span> <span>Tuma</span></a>` — and a leaf scan
   * returns "Abbi". Document order is pre-order, so the link is reached before
   * its spans and the whole name wins.
   *
   * The element has to be SMALL: a handful of descendants, short text, at most
   * six words, no timestamp inside it. Without those a rating-only card whose
   * entire text happens to be short would be returned as somebody's name.
   */
  for (const element of card.querySelectorAll("*")) {
    if (element === card) continue;
    if (exclude && exclude.contains(element)) continue;
    if (element.querySelectorAll("*").length > 3) continue;
    const text = normaliseText(element.textContent);
    if (!couldBeName(text)) continue;
    return { name: text, strategy: "short-element" };
  }

  /*
   * 5. LAST RUNG: the first short leaf that is not a date, a rating, a store
   * code or a control. Deliberately last — it is the rung most likely to pick
   * up something that merely looks like a name.
   */
  for (const node of leaves(card)) {
    if (exclude && exclude.contains(node)) continue;
    const text = normaliseText(node.textContent);
    if (!couldBeName(text)) continue;
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
  /* Google's own sentence for a rating-only review. Never a name, never a comment. */
  if (isRatingOnlyNotice(value)) return true;
  if (/^\d+([.,]\d+)?$/.test(value)) return true;
  if (/^(store\s*code|posted|edited|like|share|see more|read more|new)\b/.test(value)) {
    return true;
  }
  if (/^(helpful|report|translate|see translation|show original|photos?)\b/.test(value)) {
    return true;
  }
  return false;
}

/**
 * Whether this text is Google's "they left a rating and no words" interface
 * copy rather than anything a customer typed.
 *
 * It appears exactly where a comment would, so without this it becomes the
 * review's text — putting a sentence the customer never wrote into the
 * dashboard, into the response queue, and in front of whoever replies to it.
 */
export function isRatingOnlyNotice(text) {
  const value = normaliseText(text);
  if (!value) return false;
  return PARSER_CONFIG.ratingOnlyNoticePatterns.some((pattern) => pattern.test(value));
}

/** Text that has swallowed the timestamp beside it is not somebody's name. */
function carriesRelativeDate(text) {
  return PARSER_CONFIG.relativeDateAnywherePattern.test(text);
}

/** Whether a short text could be a person's name. */
function couldBeName(text) {
  if (!text || text.length > PARSER_CONFIG.shortTextLimit) return false;
  if (looksLikeNoise(text)) return false;
  if (carriesRelativeDate(text)) return false;
  /* A name has letters and is not a sentence. */
  return /[A-Za-z]/.test(text) && text.split(" ").length <= 6;
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
    /*
     * GOOGLE'S OWN SENTENCE IS NOT THE CUSTOMER'S. "The user didn't write a
     * review, and has left just a rating." sits exactly where a comment would
     * and is long enough to win the longest-text contest below. Storing it
     * would put words the customer never wrote into the dashboard and into
     * somebody's reply queue.
     */
    if (isRatingOnlyNotice(text)) continue;
    /* A comment is longer than a name and is a sentence rather than a label. */
    if (text.length <= PARSER_CONFIG.shortTextLimit && text.split(" ").length < 5) continue;
    if (!best || text.length > best.length) best = text;
  }

  return best;
}

/* ------------------------------------------------------------ the listing -- */

/**
 * ============================================================================
 * WHICH LISTING OWNS A REVIEW — the thing live QA proved the old pass got wrong
 * ============================================================================
 *
 * The first version walked up from the review card and regexed whatever text it
 * met, taking the first number that matched anything. On the fixtures that
 * worked. On business.google.com it reported "none of the 8 reviews belong to
 * the fifteen Sun Tan City stores" for a page that visibly showed KS Manhattan
 * (306) and NE Lincoln 27th Street (144). Four separate defects, all of which
 * this rewrite closes:
 *
 *   IT GAVE UP AFTER EIGHT ANCESTORS. Google nests a review far deeper inside
 *   its own wrappers than a fixture does, so the header was simply never
 *   reached and every review came back with no store code at all.
 *
 *   IT ONLY READ LEAF TEXT. "Store code: 306" rendered as a label element and a
 *   value element is invisible to a leaf scan: no single leaf carries both
 *   halves, and the container's own direct text is empty. Here a marker is an
 *   element whose WHOLE text is short and contains the labelled code, so it
 *   does not matter how many spans Google splits it across.
 *
 *   A BARE TRAILING NUMBER COULD WIN BEFORE THE LABELLED ONE WAS REACHED. The
 *   old loop took the first candidate that matched ANY pattern, so an address
 *   ending "66503-1234" or a phone number became the store code and the review
 *   was filed against a salon nobody has. Labelled codes now win across the
 *   whole document; the bare form is reached only on a page with no labelled
 *   code anywhere.
 *
 *   IT HAD NO IDEA WHICH HEADER OWNED WHICH REVIEW. Where several listings
 *   share one container — a header, its reviews, the next header, its reviews —
 *   the old walk stopped at that container and returned the FIRST code in it
 *   for every review under it. Ownership is now decided by document order: the
 *   marker a review belongs to is the last one that precedes it.
 *
 * THE STORE CODE IS A STRING AND IS NEVER TRANSFORMED. Google's 306 stays
 * "306". It is never zero-padded, never parsed as a number, and never compared
 * against an ASK Sunny salon number — those are different identifiers that
 * happen to overlap, and converting between them is how a review ends up on the
 * wrong salon's report.
 */

/**
 * A store code exactly as Google wrote it, or null.
 *
 * NO PADDING, NO ARITHMETIC, NO COERCION. `Number("0306")` is 306 and
 * `String(306).padStart(4, "0")` is "0306"; both would be a different
 * identifier belonging to a different salon. The only thing done here is
 * trimming and a shape check.
 */
export function normaliseStoreCode(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return /^\d{1,8}$/.test(text) ? text : null;
}

/** The labelled form — "Store code: 306" — read out of any text. */
function labelledStoreCodeIn(text) {
  for (const pattern of PARSER_CONFIG.labelledStoreCodePatterns) {
    const match = pattern.exec(text);
    if (match) return normaliseStoreCode(match[1]);
  }
  return null;
}

/** The bare chip form — "Sun Tan City - KS Manhattan · 306". Fallback only. */
function bareStoreCodeIn(text) {
  /*
   * A LABEL, NOT A NUMBER. The text has to read like a listing chip: short, and
   * carrying letters. "(785) 539-1234" has no letters and is refused here; an
   * address that does carry letters is refused by the document-wide rule that
   * this form is only consulted when the page has no labelled code at all.
   */
  if (text.length > PARSER_CONFIG.shortTextLimit) return null;
  if (!/[A-Za-z]/.test(text)) return null;
  const match = PARSER_CONFIG.trailingStoreCodePattern.exec(text);
  return match ? normaliseStoreCode(match[1]) : null;
}

/** Every text this element states in its own right, for marker detection. */
function markerTexts(element) {
  const texts = [normaliseText(element.textContent)];
  const label = element.getAttribute?.("aria-label");
  if (label) texts.push(normaliseText(label));
  return texts.filter(Boolean);
}

/**
 * Every location header on the page that names a store code.
 *
 * Returned in DOCUMENT ORDER, which is what makes ownership decidable: a review
 * belongs to the last header above it.
 *
 * INNERMOST WINS. A store code sits inside a header, inside a card, inside the
 * feed — and all three "contain" the text. Keeping only the innermost element
 * whose own text is short enough to still be a header gives the tightest
 * anchor, which is what the business-name lookup then reads around.
 *
 * LABELLED AND BARE ARE SEPARATE LISTS on purpose. The bare form is genuinely
 * ambiguous against addresses and phone numbers, so it is only used on a page
 * that carries no labelled code at all.
 */
export function findStoreCodeMarkers(root) {
  const labelled = [];
  const bare = [];

  for (const element of root.querySelectorAll("*")) {
    let labelledCode = null;
    let bareCode = null;

    for (const text of markerTexts(element)) {
      if (text.length > PARSER_CONFIG.headerTextLimit) continue;
      if (!labelledCode) labelledCode = labelledStoreCodeIn(text);
      if (!bareCode) bareCode = bareStoreCodeIn(text);
    }

    if (labelledCode) labelled.push({ element, storeCode: labelledCode, source: "labelled" });
    else if (bareCode) bare.push({ element, storeCode: bareCode, source: "bare" });
  }

  return { labelled: innermost(labelled), bare: innermost(bare) };
}

/** Drops any marker that contains another marker from the same list. */
function innermost(markers) {
  return markers.filter(
    (marker) =>
      !markers.some(
        (other) => other !== marker && marker.element.contains(other.element),
      ),
  );
}

/** True when `card` comes after `element` in the document, containment included. */
function comesAfter(element, card) {
  if (element === card) return true;
  const FOLLOWING = 4; /* Node.DOCUMENT_POSITION_FOLLOWING */
  return (element.compareDocumentPosition(card) & FOLLOWING) !== 0;
}

/**
 * The marker a review belongs to, out of the markers sharing its container.
 *
 * THE LAST ONE ABOVE IT. On a feed of "header, its reviews, next header, its
 * reviews" that is exactly the header the reader saw over this review. A review
 * that precedes every marker falls back to the first, which is the only other
 * honest reading of "the header nearest to it".
 */
function ownerOf(markers, card) {
  let owner = null;
  for (const marker of markers) {
    if (comesAfter(marker.element, card)) owner = marker;
  }
  return owner ?? markers[0] ?? null;
}

/**
 * Walks up from the review until an ancestor holds at least one marker.
 *
 * Stopping at the FIRST such ancestor is what keeps a deep walk safe: the
 * tightest container that knows about any listing is the one whose markers are
 * relevant, and ownership inside it is settled by document order rather than by
 * picking whichever came first.
 */
function resolveMarker(card, markers) {
  if (markers.length === 0) return { marker: null, depth: -1 };

  let node = card;
  for (let depth = 0; node && depth <= PARSER_CONFIG.ancestorSearchDepth; depth += 1) {
    const inside = markers.filter((marker) => node.contains(marker.element));
    if (inside.length > 0) return { marker: ownerOf(inside, card), depth };
    node = node.parentElement;
  }

  return { marker: null, depth: -1 };
}

/**
 * The block of markup the store code belongs to — name, address, code.
 *
 * Grown upward from the marker while the text still reads like a header. The
 * bound is what stops the scope swallowing the reviews below it, which matters
 * because this is where the business name is read: a customer who writes "Sun
 * Tan City" in a review of somebody else's shop must not turn that shop into
 * one of ours.
 */
function headerScopeOf(marker) {
  let scope = marker;
  let node = marker.parentElement;

  for (let depth = 0; node && depth < PARSER_CONFIG.headerScopeDepth; depth += 1) {
    if (normaliseText(node.textContent).length > PARSER_CONFIG.headerTextLimit) break;
    scope = node;
    node = node.parentElement;
  }

  return scope;
}

/**
 * Whose listing this is.
 *
 * Two answers that must stay distinguishable: OURS, and SOMEBODY ELSE'S NAMED.
 * A Buff City Soap review is a normal Tuesday on this Google account; a Sun Tan
 * City review whose store could not be placed is one of ours being dropped.
 * Reporting them as one number would let lost reviews hide inside an expected
 * count, which is why the second is read at all.
 */
function businessAround(scope) {
  const texts = [
    ...Array.from(scope.querySelectorAll("[aria-label]")).map((node) =>
      node.getAttribute("aria-label"),
    ),
    ...leaves(scope).map((node) => node.textContent),
    directText(scope),
    /* Last: the whole header as one blob, for a name split across spans. */
    scope.textContent,
  ];

  for (const raw of texts) {
    const text = normaliseText(raw);
    if (text && PARSER_CONFIG.businessNamePattern.test(text)) {
      return { ourBusinessName: text, labelBusinessName: null };
    }
  }

  for (const raw of texts) {
    const text = normaliseText(raw);
    if (!text || text.length > PARSER_CONFIG.shortTextLimit) continue;
    if (looksLikeNoise(text)) continue;
    if (/store\s*code/i.test(text)) continue;
    if (!/[A-Za-z]/.test(text)) continue;
    return { ourBusinessName: null, labelBusinessName: text };
  }

  return { ourBusinessName: null, labelBusinessName: null };
}

/**
 * Which business and which store code a review belongs to.
 *
 * `markers` is passed in by `parseReviewsFromDocument`, which finds them once
 * for the page. Called without them — as the tests do for a single card — it
 * finds them itself from the card's own document.
 */
export function extractListing(card, markers = null) {
  const found = markers ?? findStoreCodeMarkers(card.ownerDocument ?? card);

  /*
   * LABELLED FIRST, ACROSS THE WHOLE PAGE. Only a page with no "Store code:"
   * anywhere falls through to the bare chip form — see the config note on
   * `trailingStoreCodePattern` for the addresses and phone numbers that makes
   * safe.
   */
  const pool = found.labelled.length > 0 ? found.labelled : found.bare;
  const { marker, depth } = resolveMarker(card, pool);

  if (!marker) return { storeCode: null, businessName: null, depth: -1, source: "none" };

  const { ourBusinessName, labelBusinessName } = businessAround(headerScopeOf(marker.element));

  return {
    storeCode: marker.storeCode,
    /*
     * OURS WINS OVER THE HEADER'S OWN LABEL when both are present, because "Sun
     * Tan City" is the thing the allowlist actually asks about. The header's
     * label is what identifies somebody ELSE'S business, which is the case that
     * has to stay distinguishable from "could not tell".
     */
    businessName: ourBusinessName ?? labelBusinessName,
    depth,
    source: marker.source,
  };
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

  /*
   * FOUND ONCE FOR THE PAGE, NOT ONCE PER REVIEW. Ownership is decided by where
   * a review sits relative to every header on the page, so the headers have to
   * be known before any review is placed — and scanning the document eight
   * times for eight reviews would be the same answer at eight times the cost.
   */
  const markers = findStoreCodeMarkers(root);

  const reviews = [];
  const unreadable = [];

  for (const [externalReviewId, card] of cards) {
    /*
     * ONE BAD CARD MUST NOT END THE PASS. Google ships markup this parser has
     * never seen, and a throw here would lose every review after it on the page
     * as well as this one — reported as nothing at all rather than as a
     * failure. The card is recorded as unreadable and the loop continues.
     */
    let extracted;
    try {
      extracted = extractOneReview(card, markers);
    } catch {
      unreadable.push({
        externalReviewId,
        reason: "extraction_failed",
        reasons: ["extraction_failed"],
      });
      continue;
    }

    const { rating, name, listing, response, replyOffered, strategies } = extracted;

    /*
     * ========================================================================
     * WHAT A REVIEW MUST HAVE BEFORE IT CAN BE INGESTED, AND WHY
     * ========================================================================
     *
     * Exactly the fields `google_reviews` refuses to store without, and not one
     * more. Live QA found three real reviews discarded here, so the line is
     * drawn at the database's own requirements rather than at whatever the
     * parser happened to be able to read:
     *
     *   THE REVIEW ID is the deduplication key and the unique constraint. Every
     *   card has one — it is what `findReviewCards` keyed the map on — so this
     *   is a guard against a future change rather than an observed failure.
     *
     *   THE RATING must be an integer 1-5. `rating smallint not null check
     *   (rating between 1 and 5)`, and `eligible_for_weekly_count` is generated
     *   from it, so a wrong or missing rating is a wrong weekly total.
     *
     *   THE REVIEWER NAME. `reviewer_name text not null check (length(btrim(…))
     *   > 0)`. It is not required because the parser likes it — it is required
     *   because the record cannot exist without it, and sending null would
     *   trade a visible "unreadable" for a silent rejection at the API.
     *
     * EVERYTHING ELSE IS OPTIONAL, and this is where the live failure was:
     *
     *   THE COMMENT. `review_text` is nullable and null is a REAL ANSWER — a
     *   rating-only review is common and the dashboard prints "Rating only — no
     *   written comment." for it.
     *
     *   THE RELATIVE DATE. Nullable. Useful, never required.
     *
     *   THE OWNER RESPONSE. Defaults to "needs response", which is the honest
     *   reading of "we could not find a reply".
     *
     *   THE STORE CODE. Required to INGEST, but not decided here — it is the
     *   allowlist's business, and a review with no code is reported as
     *   unresolved rather than as unreadable. Those are different findings and
     *   the popup keeps them apart.
     */
    const reasons = [];
    if (!externalReviewId) reasons.push("missing_review_id");
    if (rating === null) reasons.push("missing_rating");
    else if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      reasons.push("invalid_rating");
    }
    if (!name) reasons.push("missing_reviewer");

    if (reasons.length > 0) {
      unreadable.push({ externalReviewId, reason: reasons[0], reasons });
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
      strategies,
    });
  }

  /*
   * ============================================================================
   * WHAT THE PAGE ACTUALLY PARSED, FOR THE PERSON STANDING IN FRONT OF IT
   * ============================================================================
   *
   * The failure live QA hit reported itself as "none of these are Sun Tan City",
   * which is the one sentence that makes a parser bug look like a normal
   * Tuesday. These two fields are what tell the difference without DevTools:
   * the codes that WERE read, and how many reviews got none at all.
   *
   * COUNTS AND STORE CODES ONLY. No review id, no reviewer, no comment — a
   * diagnostics line is exactly where somebody's words must not end up, and a
   * store code is a fact about a shop rather than about a person.
   */
  const storeCodes = [...new Set(reviews.map((review) => review.storeCode).filter(Boolean))].sort();

  return {
    parserVersion: PARSER_VERSION,
    discovered: cards.size,
    duplicatesCollapsed,
    reviews,
    unreadable,
    /*
     * WHY each unreadable card was unreadable, as counts. "Unreadable: 3" is
     * the number that sent this build back from QA twice without ever saying
     * which field broke; "missing rating: 3" names the rung to go and look at.
     */
    unreadableReasons: countReasons(unreadable),
    storeCodes,
    unresolvedStoreCodes: reviews.filter((review) => review.storeCode === null).length,
  };
}

/** Everything read off one card, before anything is decided about it. */
function extractOneReview(card, markers) {
  const response = extractOwnerResponse(card);
  const replyOffered = hasReplyButton(card);
  const { rating, strategy: ratingStrategy } = extractRating(card);
  const { name, strategy: nameStrategy } = extractReviewerName(card, response.container);
  const listing = extractListing(card, markers);

  return {
    rating,
    name,
    listing,
    response,
    replyOffered,
    strategies: {
      rating: ratingStrategy,
      reviewerName: nameStrategy,
      ownerResponse: response.strategy,
      listingDepth: listing.depth,
      listingSource: listing.source,
    },
  };
}

/** `{ missing_rating: 3 }`. Counts only — never a review id or a name. */
function countReasons(unreadable) {
  const counts = {};
  for (const entry of unreadable) {
    for (const reason of entry.reasons ?? [entry.reason]) {
      if (!reason) continue;
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
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
