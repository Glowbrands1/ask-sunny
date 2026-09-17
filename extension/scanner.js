/**
 * ============================================================================
 * THE FULL-FEED SCANNER — reading the whole Google review feed, not the part of
 * it that happens to be mounted right now.
 * ============================================================================
 *
 * ============================================================================
 * THE PROBLEM THIS EXISTS FOR
 * ============================================================================
 *
 * `parseReviewsFromDocument` reads the document. Google's Reviews page renders
 * a handful of review cards at a time and swaps them as you move: it lazy-loads
 * further batches on scroll, and on some accounts paginates instead. So a sync
 * captured four reviews out of a feed that visibly held dozens — not because
 * anything failed, but because four was what existed in the DOM at the instant
 * the button was pressed.
 *
 * ============================================================================
 * THE ONE THING THAT MAKES THIS HARD: VIRTUALIZATION
 * ============================================================================
 *
 * Google does not only ADD cards as you scroll. It REMOVES the ones that have
 * gone off screen. So the obvious approach — scroll to the bottom, then call
 * `querySelectorAll` once — returns the LAST few reviews and loses everything
 * in between, which is a worse answer than not scrolling at all because it
 * looks like it worked.
 *
 * The scanner therefore parses after EVERY cycle and merges into a Map keyed on
 * Google's review id. A review that was on screen in cycle 3 and gone by cycle
 * 9 is still in the results, because it was banked when it was seen. Nothing is
 * ever read back off the page after the fact.
 *
 * ============================================================================
 * NO DOM IN THIS FILE
 * ============================================================================
 *
 * The loop takes a `parse` function and a `driver` — scroll, paginate, wait,
 * where-am-I. `createPageDriver` below is the real one; the tests pass a fake
 * that returns scripted pages, which is the only way to test "a review is
 * virtualized out of the DOM and must survive" without a real browser.
 *
 * NOTHING HERE DECIDES WHAT COUNTS. Store codes belong to `store-codes.js`,
 * extraction to `parser.js`, reporting to the server. This module accumulates.
 */

/**
 * SAFETY CAPS, NOT TARGETS.
 *
 * Every one of these exists to bound a loop that drives somebody else's page.
 * A scan that hits a cap has not failed — it has stopped where it was told to,
 * and says which cap it hit so the next run can be widened deliberately.
 */
export const SCAN_LIMITS = Object.freeze({
  /** Consecutive cycles that may find nothing new before the feed is finished. */
  quietCycles: 3,
  /** Hard ceiling on scroll/page steps. */
  maxCycles: 100,
  /** Hard ceiling on wall-clock time. */
  maxRuntimeMs: 3 * 60 * 1000,
  /** How long to let Google render a batch before parsing again. */
  settleMs: 700,
  /** How far down to jump, as a fraction of the visible height. */
  scrollStepRatio: 0.8,
  /** Never jump less than this, for a short container. */
  minScrollStepPx: 240,
  /** Slack when deciding "the container is at the bottom". */
  bottomSlackPx: 24,
  /** Pages to walk back when putting the reader where they started. */
  maxRestorePages: 30,
  /**
   * Pages to walk back when rewinding to the start of the feed.
   *
   * Higher than `maxRestorePages` because this one decides CORRECTNESS rather
   * than courtesy: a reader who started on page 41 and whose rewind gave up at
   * page 30 would get a scan missing a third of the history, reported as a
   * complete one. Restoration giving up only costs them a scroll.
   */
  maxRewindPages: 200,
});

/** Why a scan stopped. Every one of these is a normal ending. */
export const STOP_REASONS = Object.freeze({
  feed_end: "Reached the end of the feed.",
  pagination_end: "Reached the last page.",
  no_new_reviews: "No new reviews for three passes.",
  max_cycles: "Stopped at the scan-step limit.",
  max_runtime: "Stopped at the time limit.",
  cancelled: "Cancelled.",
  no_feed_controls: "The feed could not be scrolled or paged.",
  rewind_incomplete: "Could not get back to the first page.",
});

/* ------------------------------------------------------------- the cancel -- */

/**
 * A cancel flag the caller flips and the loop reads.
 *
 * A plain object rather than `AbortController`, because the loop checks it at
 * defined points — between cycles and around every wait — and a rejected
 * promise mid-scroll would lose the reviews already banked. Cancelling this
 * scan must KEEP what it found; that is the whole point of pressing Cancel on
 * something that has been running for ninety seconds.
 */
export function createScanSignal() {
  return { cancelled: false, cancel() { this.cancelled = true; } };
}

/* -------------------------------------------------------- the accumulator -- */

/**
 * What "this review changed" means.
 *
 * Only the fields ASK Sunny stores and could disagree about. Notably the OWNER
 * RESPONSE: a review parsed on Monday with no reply and re-parsed on Tuesday
 * with one is the same review with new facts, and has to be re-sent. Feed
 * position is deliberately absent — it moves whenever anything above it is
 * answered, and treating that as a change would re-send the whole page.
 */
export function reviewFingerprint(review) {
  return JSON.stringify([
    review.storeCode ?? null,
    review.rating ?? null,
    review.reviewText ?? null,
    review.relativeDateText ?? null,
    review.hasOwnerResponse ?? false,
    review.ownerResponseText ?? null,
    review.ownerResponseDateText ?? null,
  ]);
}

/**
 * Every review seen across every cycle of a scan, keyed on Google's review id.
 *
 * INSERTION ORDER IS FEED ORDER. The scan runs top to bottom, so the order a
 * review is first seen in is the order Google showed it in — which is what
 * `toApiPayload` turns into `feedPosition`, and what the server's anchor logic
 * measures against. A Map preserves that; a plain object would not.
 */
export class ReviewAccumulator {
  constructor() {
    this.byId = new Map();
    this.fingerprints = new Map();
    /** Ids whose content changed since they were first banked. */
    this.changed = new Set();
    this.unreadableById = new Map();
  }

  /**
   * Banks one cycle's parse.
   *
   * A review already held is REPLACED when its content changed and left alone
   * when it did not — so a re-parse of the same card costs nothing, and an
   * owner response added between cycles is not lost.
   */
  merge(reviews) {
    let added = 0;
    let updated = 0;

    for (const review of reviews ?? []) {
      const id = review?.externalReviewId;
      if (!id) continue;

      const fingerprint = reviewFingerprint(review);

      if (!this.byId.has(id)) {
        this.byId.set(id, review);
        this.fingerprints.set(id, fingerprint);
        added += 1;
        continue;
      }

      if (this.fingerprints.get(id) !== fingerprint) {
        this.byId.set(id, review);
        this.fingerprints.set(id, fingerprint);
        this.changed.add(id);
        updated += 1;
      }
    }

    return { added, updated };
  }

  /** Cards that could not be read, also deduplicated by id across cycles. */
  mergeUnreadable(entries) {
    for (const entry of entries ?? []) {
      if (!entry?.externalReviewId) continue;
      this.unreadableById.set(entry.externalReviewId, entry);
    }
  }

  get size() {
    return this.byId.size;
  }

  /** Every review, in the order Google showed it. */
  all() {
    return [...this.byId.values()];
  }

  /** `{ missing_rating: 2 }` over everything unreadable in the whole scan. */
  unreadableReasons() {
    const counts = {};
    for (const entry of this.unreadableById.values()) {
      for (const reason of entry.reasons ?? [entry.reason]) {
        if (!reason) continue;
        counts[reason] = (counts[reason] ?? 0) + 1;
      }
    }
    return counts;
  }

  get unreadableCount() {
    return this.unreadableById.size;
  }
}

/* ------------------------------------------------------------- the driver -- */

/** True when the container cannot usefully be scrolled any further. */
function atBottom(metrics, limits) {
  return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - limits.bottomSlackPx;
}

/** Text that means "show me the next batch". */
const NEXT_CONTROL_PATTERN =
  /^\s*(next(\s+page)?|older(\s+reviews)?|show\s+more(\s+reviews)?|load\s+more(\s+reviews)?|more\s+reviews)\s*$/i;

/** Text that means "take me back one". */
const PREVIOUS_CONTROL_PATTERN = /^\s*(previous(\s+page)?|prev|newer(\s+reviews)?|back)\s*$/i;

/**
 * Text that means "take me to the beginning in one step".
 *
 * DELIBERATELY NARROW, AND "NEWEST" IS NOT ON IT. Google's Reviews page has a
 * sort control offering "Newest", and clicking that is not a navigation — it
 * changes the order the whole feed is in, which is the one thing the anchor
 * logic depends on. A paginator's first-page control says "First", not the name
 * of a sort order.
 */
const FIRST_CONTROL_PATTERN = /^\s*(first(\s+page)?|page\s*1|go\s+to\s+(the\s+)?first(\s+page)?)\s*$/i;

function controlLabel(element) {
  const label = element.getAttribute?.("aria-label") ?? element.textContent ?? "";
  return String(label).replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function controlEnabled(element) {
  if (element.disabled === true) return false;
  if (element.getAttribute?.("aria-disabled") === "true") return false;
  if (element.getAttribute?.("disabled") !== null && element.hasAttribute?.("disabled")) {
    return false;
  }
  return true;
}

function findControl(root, pattern) {
  const controls = root.querySelectorAll('button, [role="button"], a[href], a[role="link"]');
  for (const element of controls) {
    if (pattern.test(controlLabel(element))) {
      return { element, enabled: controlEnabled(element) };
    }
  }
  return null;
}

/**
 * The real page driver. The only part of this module that touches a document.
 *
 * FINDING THE SCROLLABLE CONTAINER IS THE WHOLE TRICK. On a virtualized feed
 * the window does not scroll — a `div` somewhere above the reviews does, and
 * scrolling the window instead moves nothing and looks exactly like "the feed
 * has ended". So it is found from a review card upward: the first ancestor that
 * actually overflows. The document is the fallback, for a feed that scrolls the
 * page normally.
 */
export function createPageDriver(document, options = {}) {
  const limits = { ...SCAN_LIMITS, ...(options.limits ?? {}) };
  const view = document.defaultView ?? globalThis;

  function overflows(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return false;
    }
    if (element.scrollHeight <= element.clientHeight + limits.bottomSlackPx) return false;

    try {
      const style = view.getComputedStyle?.(element);
      const overflow = `${style?.overflowY ?? ""} ${style?.overflow ?? ""}`;
      return /auto|scroll|overlay/.test(overflow);
    } catch {
      /* jsdom and exotic documents. Treat a real overflow as scrollable. */
      return true;
    }
  }

  return {
    scrollContainer() {
      const card = document.querySelector("[data-lid]");
      let node = card?.parentElement ?? null;
      for (let depth = 0; node && depth < 40; depth += 1) {
        if (overflows(node)) return node;
        node = node.parentElement;
      }
      return document.scrollingElement ?? document.documentElement ?? null;
    },

    metrics(container) {
      return {
        scrollTop: container?.scrollTop ?? 0,
        scrollHeight: container?.scrollHeight ?? 0,
        clientHeight: container?.clientHeight ?? 0,
      };
    },

    scrollTo(container, top) {
      if (!container) return;
      container.scrollTop = Math.max(0, top);
    },

    nextControl() {
      return findControl(document, NEXT_CONTROL_PATTERN);
    },

    previousControl() {
      return findControl(document, PREVIOUS_CONTROL_PATTERN);
    },

    firstControl() {
      return findControl(document, FIRST_CONTROL_PATTERN);
    },

    /*
     * A CLICK ON A CONTROL GOOGLE PUT THERE FOR A PERSON, and nothing else.
     * The extension does not type, submit, navigate or touch a form. Pressing
     * "Next" is the same gesture the reader would make.
     */
    activate(element) {
      element?.click?.();
    },

    wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    savePosition() {
      const container = this.scrollContainer();
      return {
        container,
        scrollTop: container?.scrollTop ?? 0,
        windowScrollY: view.scrollY ?? 0,
      };
    },

    restorePosition(saved) {
      if (!saved) return;
      if (saved.container) saved.container.scrollTop = saved.scrollTop;
      try {
        view.scrollTo?.(0, saved.windowScrollY ?? 0);
      } catch {
        /* Not every environment implements it. The container is what matters. */
      }
    },
  };
}

/* --------------------------------------------------------------- the loop -- */

function emptyProgress() {
  return {
    phase: "scanning",
    cycle: 0,
    observed: 0,
    stcFound: 0,
    ignoredOther: 0,
    unknownStore: 0,
    unreadable: 0,
    storeCodes: [],
    pagesAdvanced: 0,
    pagesRewound: 0,
    pagesScanned: 1,
  };
}

/**
 * ============================================================================
 * GETTING TO THE START OF THE FEED BEFORE READING IT
 * ============================================================================
 *
 * The bug this exists for: a full scan began wherever the reader happened to be
 * standing. Somebody browsing reviews 41–50 pressed Sync, the scan read page 5
 * forward, found ten locations and reported a complete scan. Pages 1 to 4 were
 * never opened and nothing said so — "Pages advanced: 1" was the only trace,
 * and it reads like a short feed rather than a scan that started in the middle.
 *
 * "The whole feed" cannot mean "the whole feed from here". So the scan now
 * establishes the beginning first, and only then moves forward.
 *
 * TWO WAYS BACK, and the difference matters afterwards:
 *
 *   A FIRST CONTROL, where Google offers one. One click instead of forty — but
 *   it jumps an unknown distance, so the reader's page can no longer be counted
 *   back to. That is reported rather than guessed at.
 *
 *   PREVIOUS, REPEATEDLY, until it is disabled or gone. Slower, and it counts:
 *   the number of steps back IS the page the reader was on, which is what lets
 *   them be put back on it afterwards.
 *
 * BOUNDED AND CANCELLABLE. A paginator whose Previous never disables would walk
 * forever; the cap stops it, and a rewind that did not reach the start says so
 * rather than letting a partial scan be reported as a whole one.
 */
async function rewindToStart({ driver, limits, signal, now, startedAt, report }) {
  let pages = 0;
  let reachedStart = false;
  /* Whether the reader's original page can be counted back to afterwards. */
  let startPageKnown = true;

  const first = driver.firstControl?.() ?? null;
  if (first && first.enabled) {
    driver.activate(first.element);
    startPageKnown = false;
    await driver.wait(limits.settleMs);
    report(pages);
  }

  for (let step = 0; step <= limits.maxRewindPages; step += 1) {
    if (signal.cancelled) break;
    if (now() - startedAt >= limits.maxRuntimeMs) break;

    const previous = driver.previousControl?.() ?? null;
    /*
     * NO PREVIOUS, OR A DISABLED ONE, IS THE FIRST PAGE. It is also what a feed
     * with no pagination at all looks like, which is the same answer: there is
     * nothing behind where we are standing.
     */
    if (!previous || !previous.enabled) {
      reachedStart = true;
      break;
    }

    if (step === limits.maxRewindPages) break;

    driver.activate(previous.element);
    pages += 1;
    await driver.wait(limits.settleMs);
    report(pages);
  }

  return { pages, reachedStart, startPageKnown };
}

/**
 * Reads the whole available feed, banking every review as it goes.
 *
 * ============================================================================
 * THE ALGORITHM, IN FULL
 * ============================================================================
 *
 *   1. Parse what is mounted and merge it into the Map.
 *   2. Report progress.
 *   3. Stop if a stop condition is met.
 *   4. Advance: scroll a step, or if already at the bottom press Next, and if
 *      neither is available the feed is finished.
 *   5. Wait for Google to render, and go back to 1.
 *
 * STEP 1 COMES FIRST, BEFORE ANY SCROLLING, so a feed that needs no scrolling
 * at all is read correctly and a cancel pressed immediately still returns what
 * was on screen.
 *
 * SCROLLING IS TRIED BEFORE PAGINATION because a page that does both loads
 * lazily WITHIN a page: paging first would skip most of page one.
 */
export async function scanFeed({
  parse,
  driver,
  classify,
  onProgress = () => {},
  limits: overrides = {},
  signal = createScanSignal(),
  now = () => Date.now(),
}) {
  const limits = { ...SCAN_LIMITS, ...overrides };
  const accumulator = new ReviewAccumulator();

  const startedAt = now();
  const saved = driver.savePosition?.() ?? null;

  let cycle = 0;
  let quiet = 0;
  let bottomStreak = 0;
  let pagesAdvanced = 0;
  let pagesRewound = 0;
  let stopReason = null;
  let parserVersion = null;

  const snapshot = (phase) => {
    const reviews = accumulator.all();
    const sorted = classify ? classify(reviews) : { send: reviews, ignoredOther: [], unknownStore: [] };
    const storeCodes = [
      ...new Set(sorted.send.map((review) => review.storeCode).filter(Boolean)),
    ].sort();

    return {
      ...emptyProgress(),
      phase,
      cycle,
      observed: accumulator.size,
      stcFound: sorted.send.length,
      ignoredOther: sorted.ignoredOther.length,
      unknownStore: sorted.unknownStore.length,
      unreadable: accumulator.unreadableCount,
      unreadableReasons: accumulator.unreadableReasons(),
      storeCodes,
      pagesAdvanced,
      pagesRewound,
      /* Pages actually READ. One more than the number of Next presses. */
      pagesScanned: pagesAdvanced + 1,
    };
  };

  /* --------------------------------------------------------------- rewind -- */

  /*
   * THE BEGINNING IS ESTABLISHED BEFORE ANYTHING IS READ. Reading forward from
   * wherever the reader was standing is not a scan of the feed, and it reports
   * itself as one — which is exactly how a scan that skipped pages 1 to 4 came
   * back looking complete.
   */
  const rewind = await rewindToStart({
    driver,
    limits,
    signal,
    now,
    startedAt,
    report: (pages) => {
      pagesRewound = pages;
      onProgress(snapshot("preparing"));
    },
  });

  pagesRewound = rewind.pages;

  /*
   * AND THE TOP OF WHATEVER IS ON SCREEN. On a virtualized feed this is the
   * whole rewind: there are no pages, and "the start" is the top of the
   * container the reader may have scrolled halfway down.
   */
  const startContainer = signal.cancelled ? null : (driver.scrollContainer?.() ?? null);
  if (startContainer) {
    driver.scrollTo(startContainer, 0);
    await driver.wait(limits.settleMs);
  }

  if (!signal.cancelled) onProgress(snapshot("preparing"));

  /* --------------------------------------------------------------- scan --- */

  while (true) {
    if (signal.cancelled) {
      stopReason = "cancelled";
      break;
    }

    cycle += 1;

    const parsed = parse();
    parserVersion = parsed.parserVersion ?? parserVersion;
    const { added } = accumulator.merge(parsed.reviews);
    accumulator.mergeUnreadable(parsed.unreadable);

    onProgress(snapshot("scanning"));

    quiet = added === 0 ? quiet + 1 : 0;
    if (quiet >= limits.quietCycles) {
      stopReason = "no_new_reviews";
      break;
    }
    if (cycle >= limits.maxCycles) {
      stopReason = "max_cycles";
      break;
    }
    if (now() - startedAt >= limits.maxRuntimeMs) {
      stopReason = "max_runtime";
      break;
    }

    /* ------------------------------------------------------------ advance -- */

    const container = driver.scrollContainer?.() ?? null;
    let moved = false;

    if (container) {
      const metrics = driver.metrics(container);
      if (!atBottom(metrics, limits)) {
        const step = Math.max(
          limits.minScrollStepPx,
          Math.round(metrics.clientHeight * limits.scrollStepRatio),
        );
        driver.scrollTo(container, metrics.scrollTop + step);
        bottomStreak = 0;
        moved = true;
      } else {
        bottomStreak += 1;
      }
    }

    if (!moved) {
      const next = driver.nextControl?.() ?? null;

      if (next && next.enabled) {
        driver.activate(next.element);
        /* A new page starts at the top, and its own lazy loading starts again. */
        if (container) driver.scrollTo(container, 0);
        pagesAdvanced += 1;
        bottomStreak = 0;
        moved = true;
      } else if (next) {
        stopReason = "pagination_end";
        break;
      } else if (container) {
        /*
         * At the bottom with nothing to page to. ONE MORE CYCLE before calling
         * it finished, because a lazy feed extends its own scroll height a beat
         * after you reach the end of it — and stopping on the first reading
         * would cut the scan short by exactly one batch.
         */
        if (bottomStreak >= 2) {
          stopReason = "feed_end";
          break;
        }
        moved = true;
      } else {
        stopReason = "no_feed_controls";
        break;
      }
    }

    await driver.wait(limits.settleMs);
  }

  /*
   * A REWIND THAT DID NOT REACH THE START MEANS THE SCAN MISSED PAGES, and that
   * matters more than however it happened to finish. Said here rather than
   * silently, because "reached the end of the feed" after starting in the
   * middle of it is the exact wrong answer this whole change exists to stop.
   */
  if (!rewind.reachedStart && !signal.cancelled) stopReason = "rewind_incomplete";

  /* ------------------------------------------------------------- restore -- */

  const restored = await restorePosition({
    driver,
    saved,
    /*
     * HOW FAR BACK TO WALK. The reader was on page `pagesRewound`; the scan
     * finished on page `pagesAdvanced`, both counted from the first page. The
     * difference is the distance home — and when a First control did the
     * rewinding, the distance is unknown and no amount of clicking will find it.
     */
    pagesToUnwind: rewind.startPageKnown ? Math.max(0, pagesAdvanced - pagesRewound) : 0,
    pageRestorable: rewind.startPageKnown,
    pagesMoved: pagesAdvanced,
    limits,
    signal,
  });

  const result = {
    ...snapshot(signal.cancelled ? "cancelled" : "complete"),
    parserVersion,
    stopReason,
    stopMessage: STOP_REASONS[stopReason] ?? "Stopped.",
    cancelled: signal.cancelled,
    reviews: accumulator.all(),
    elapsedMs: now() - startedAt,
    returnedToStart: restored,
    /** Whether the scan actually began at the first page. */
    startedAtFeedStart: rewind.reachedStart,
  };

  onProgress(result);
  return result;
}

/**
 * Puts the reader back where they were.
 *
 * SCROLL ALWAYS, PAGES WHERE IT IS SAFE. Being left at the bottom of a
 * three-minute scroll is a rude thing to do to somebody who pressed a button
 * once. Walking back through pagination is bounded — a `Previous` control that
 * exists and is enabled, at most as many times as the scan advanced, and never
 * past the cap — because clicking through somebody's page is the one thing here
 * that has a cost if it goes wrong.
 */
async function restorePosition({
  driver,
  saved,
  pagesToUnwind,
  pageRestorable,
  pagesMoved,
  limits,
  signal,
}) {
  let wentBack = 0;

  if (pageRestorable && pagesToUnwind > 0 && typeof driver.previousControl === "function") {
    const steps = Math.min(pagesToUnwind, limits.maxRestorePages);
    for (let step = 0; step < steps; step += 1) {
      if (signal.cancelled && step > 0) break;
      const previous = driver.previousControl();
      if (!previous || !previous.enabled) break;
      driver.activate(previous.element);
      wentBack += 1;
      await driver.wait(Math.min(limits.settleMs, 300));
    }
  }

  driver.restorePosition?.(saved);

  if (pagesMoved === 0) return true;
  if (!pageRestorable) return false;
  return wentBack >= pagesToUnwind;
}

/* ------------------------------------------------- the lightweight pass --- */

/**
 * ONE PASS OVER WHAT IS MOUNTED. No scrolling, no pagination, no waiting.
 *
 * This is what Auto Sync runs, and what the popup runs to say how many reviews
 * are on screen. The distinction matters more than it looks: a full historical
 * scan every two minutes would drive somebody's page around under them all day
 * and re-post a year of backlog each time. Auto Sync's job is to notice what
 * ARRIVED, which is a different job with a different cost.
 *
 * `known` carries the ids and fingerprints the last pass banked, so what comes
 * back is only what is NEW or CHANGED — an owner response added since the last
 * look counts as changed and is re-sent; an untouched review is not.
 */
export function scanVisible(parse, known = new Map()) {
  const parsed = parse();
  const accumulator = new ReviewAccumulator();

  const fresh = [];
  for (const review of parsed.reviews ?? []) {
    const id = review?.externalReviewId;
    if (!id) continue;
    const fingerprint = reviewFingerprint(review);
    if (known.get(id) !== fingerprint) fresh.push(review);
  }

  accumulator.merge(parsed.reviews);
  accumulator.mergeUnreadable(parsed.unreadable);

  return {
    parserVersion: parsed.parserVersion ?? null,
    observed: accumulator.size,
    /** Everything mounted, for the popup's "on screen" count. */
    all: accumulator.all(),
    /** Only what the server has not already been told. */
    fresh,
    unreadable: accumulator.unreadableCount,
    unreadableReasons: accumulator.unreadableReasons(),
    fingerprints: accumulator.fingerprints,
  };
}
