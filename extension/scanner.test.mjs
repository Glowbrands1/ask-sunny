// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPageDriver,
  createScanSignal,
  ReviewAccumulator,
  reviewFingerprint,
  SCAN_LIMITS,
  scanFeed,
  scanVisible,
} from "./scanner.js";
import { classifyReviews, coverageReport, describeStoreCodes } from "./store-codes.js";

/**
 * ============================================================================
 * READING THE WHOLE FEED, NOT THE PART OF IT THAT IS MOUNTED
 * ============================================================================
 *
 * A sync captured four reviews out of a feed that visibly held dozens. Nothing
 * had failed: four was what existed in the DOM at the instant the button was
 * pressed, because Google lazy-loads the feed and virtualizes what scrolls out
 * of view.
 *
 * The property that matters most here, and the one a careless implementation
 * loses: A REVIEW SEEN IN CYCLE 3 AND GONE BY CYCLE 9 MUST STILL BE IN THE
 * RESULTS. Scrolling to the bottom and then calling `querySelectorAll` returns
 * the last few reviews and silently loses everything in between — a worse
 * answer than not scrolling at all, because it looks like it worked.
 *
 * The loop is driven through a fake page here, which is the only way to script
 * "these cards are mounted now, and these ones are not any more" deterministically.
 *
 * Every review id below is a `FIXTURE-…` string. No real customer data.
 */

function review(id, storeCode, overrides = {}) {
  return {
    externalReviewId: id,
    storeCode,
    businessName: storeCode === "236" ? "Buff City Soap - Lincoln" : "Sun Tan City",
    reviewerName: "Fixture Person",
    rating: 5,
    reviewText: null,
    relativeDateText: "1 hour ago",
    hasOwnerResponse: false,
    ownerResponseText: null,
    ownerResponseDateText: null,
    ...overrides,
  };
}

function parsed(reviews, unreadable = []) {
  return {
    parserVersion: "2026.09.17-3",
    discovered: reviews.length + unreadable.length,
    reviews,
    unreadable,
    storeCodes: [...new Set(reviews.map((entry) => entry.storeCode).filter(Boolean))].sort(),
    unresolvedStoreCodes: reviews.filter((entry) => entry.storeCode === null).length,
    unreadableReasons: {},
  };
}

/**
 * A scripted page.
 *
 * `pages[n]` is what is mounted on the nth parse. `scrollPages` decides whether
 * advancing scrolls or pages, so the same batches can be replayed through both
 * of Google's loading patterns.
 */
function fakePage({ batches, mode = "scroll", height = 1000 }) {
  const state = {
    index: 0,
    scrollTop: 0,
    clientHeight: height,
    scrolls: 0,
    pages: 0,
    restored: false,
    nextEnabled: true,
    previousClicks: 0,
    waits: [],
  };

  const driver = {
    scrollContainer: () => (mode === "paginate" ? null : { id: "feed" }),
    metrics: () => ({
      scrollTop: state.scrollTop,
      /*
       * The container grows as Google appends. The scan is at the bottom only
       * when it has consumed every scripted batch.
       */
      scrollHeight:
        state.index >= batches.length - 1
          ? state.scrollTop + state.clientHeight
          : state.scrollTop + state.clientHeight + height,
      clientHeight: state.clientHeight,
    }),
    scrollTo: (_container, top) => {
      state.scrolls += 1;
      state.scrollTop = top;
      state.index = Math.min(state.index + 1, batches.length - 1);
    },
    nextControl: () => {
      if (mode === "scroll") return null;
      const more = state.index < batches.length - 1;
      return { element: { id: "next" }, enabled: more && state.nextEnabled };
    },
    previousControl: () => ({ element: { id: "prev" }, enabled: true }),
    activate: (element) => {
      if (element.id === "next") {
        state.pages += 1;
        state.index = Math.min(state.index + 1, batches.length - 1);
      }
      if (element.id === "prev") state.previousClicks += 1;
    },
    wait: async (ms) => {
      state.waits.push(ms);
    },
    savePosition: () => ({ scrollTop: 0 }),
    restorePosition: () => {
      state.restored = true;
    },
  };

  return {
    state,
    driver,
    parse: () => parsed(batches[state.index] ?? []),
  };
}

const options = (page, extra = {}) => ({
  parse: page.parse,
  driver: page.driver,
  classify: classifyReviews,
  ...extra,
});

/* ---------------------------------------------------------- accumulating -- */

describe("accumulating across DOM batches", () => {
  it("collects reviews from every batch, not just the last one", async () => {
    const page = fakePage({
      batches: [
        [review("FIXTURE-A", "306"), review("FIXTURE-B", "306")],
        [review("FIXTURE-C", "144")],
        [review("FIXTURE-D", "145"), review("FIXTURE-E", "145")],
      ],
    });

    const result = await scanFeed(options(page));

    expect(result.observed).toBe(5);
    expect(result.stcFound).toBe(5);
  });

  it("keeps a review that Google virtualized out of the DOM", async () => {
    /*
     * THE TEST THIS FILE EXISTS FOR. Batch 1's reviews are gone by batch 2 and
     * never come back — exactly what a virtualized list does. Scrolling to the
     * bottom and reading once would return two reviews and call it a complete
     * scan of six.
     */
    const page = fakePage({
      batches: [
        [review("FIXTURE-OLD-1", "306"), review("FIXTURE-OLD-2", "306")],
        [review("FIXTURE-MID-1", "144"), review("FIXTURE-MID-2", "144")],
        [review("FIXTURE-NEW-1", "145"), review("FIXTURE-NEW-2", "145")],
      ],
    });

    const result = await scanFeed(options(page));

    const ids = result.reviews.map((entry) => entry.externalReviewId);
    expect(ids).toHaveLength(6);
    expect(ids).toContain("FIXTURE-OLD-1");
    expect(ids).toContain("FIXTURE-MID-1");
    expect(ids).toContain("FIXTURE-NEW-1");
  });

  it("keeps one record for a review seen in five consecutive cycles", async () => {
    const same = [review("FIXTURE-REPEAT", "306")];
    const page = fakePage({ batches: [same, same, same, same, same] });

    const result = await scanFeed(options(page));

    expect(result.observed).toBe(1);
    expect(result.reviews).toHaveLength(1);
  });

  it("holds reviews in the order Google showed them, which is the feed order", async () => {
    /*
     * `toApiPayload` turns array order into `feedPosition`, and the server's
     * anchor logic measures against it. A Map preserves insertion order; an
     * object would reorder numeric-looking keys.
     */
    const page = fakePage({
      batches: [
        [review("FIXTURE-1", "306")],
        [review("FIXTURE-2", "306")],
        [review("FIXTURE-3", "306")],
      ],
    });

    const result = await scanFeed(options(page));
    expect(result.reviews.map((entry) => entry.externalReviewId)).toEqual([
      "FIXTURE-1",
      "FIXTURE-2",
      "FIXTURE-3",
    ]);
  });

  it("accumulates several locations at once", async () => {
    const page = fakePage({
      batches: [
        [review("FIXTURE-A", "306"), review("FIXTURE-B", "144")],
        [review("FIXTURE-C", "145"), review("FIXTURE-D", "146")],
        [review("FIXTURE-E", "409")],
      ],
    });

    const result = await scanFeed(options(page));
    expect(result.storeCodes).toEqual(["144", "145", "146", "306", "409"]);
  });

  it("ignores Buff City Soap without losing it from the observed count", async () => {
    const page = fakePage({
      batches: [
        [review("FIXTURE-STC-1", "306"), review("FIXTURE-BCS-1", "236")],
        [review("FIXTURE-BCS-2", "236")],
      ],
    });

    const result = await scanFeed(options(page));

    expect(result.observed).toBe(3);
    expect(result.stcFound).toBe(1);
    expect(result.ignoredOther).toBe(2);
    /* And nothing of theirs is in the store-code list ASK Sunny is told about. */
    expect(result.storeCodes).toEqual(["306"]);
  });
});

/* --------------------------------------------------------- the accumulator -- */

describe("ReviewAccumulator", () => {
  it("adds once and updates only when the content changed", () => {
    const accumulator = new ReviewAccumulator();

    expect(accumulator.merge([review("FIXTURE-A", "306")])).toEqual({ added: 1, updated: 0 });
    expect(accumulator.merge([review("FIXTURE-A", "306")])).toEqual({ added: 0, updated: 0 });

    const answered = review("FIXTURE-A", "306", {
      hasOwnerResponse: true,
      ownerResponseText: "Thanks for the five stars!",
    });
    expect(accumulator.merge([answered])).toEqual({ added: 0, updated: 1 });
    expect(accumulator.size).toBe(1);
    expect(accumulator.all()[0].hasOwnerResponse).toBe(true);
    expect(accumulator.changed.has("FIXTURE-A")).toBe(true);
  });

  it("does not treat a moved feed position as a change", () => {
    /*
     * Feed position shifts whenever anything above a review is answered.
     * Counting that as a change would re-send the whole page on every pass.
     */
    const first = { ...review("FIXTURE-A", "306"), feedPosition: 4 };
    const later = { ...review("FIXTURE-A", "306"), feedPosition: 9 };
    expect(reviewFingerprint(first)).toBe(reviewFingerprint(later));
  });

  it("deduplicates unreadable cards too, and counts their reasons", () => {
    const accumulator = new ReviewAccumulator();
    const entry = { externalReviewId: "FIXTURE-X", reason: "missing_rating", reasons: ["missing_rating"] };

    accumulator.mergeUnreadable([entry]);
    accumulator.mergeUnreadable([entry]);
    accumulator.mergeUnreadable([
      { externalReviewId: "FIXTURE-Y", reason: "missing_reviewer", reasons: ["missing_reviewer"] },
    ]);

    expect(accumulator.unreadableCount).toBe(2);
    expect(accumulator.unreadableReasons()).toEqual({
      missing_rating: 1,
      missing_reviewer: 1,
    });
  });

  it("ignores a review with no id rather than banking it under undefined", () => {
    const accumulator = new ReviewAccumulator();
    expect(accumulator.merge([{ storeCode: "306" }])).toEqual({ added: 0, updated: 0 });
    expect(accumulator.size).toBe(0);
  });
});

/* -------------------------------------------------------------- coverage -- */

describe("coverage over the fifteen", () => {
  it("reports which locations a scan saw and which it did not", async () => {
    const page = fakePage({
      batches: [[review("FIXTURE-A", "306")], [review("FIXTURE-B", "144")]],
    });

    const result = await scanFeed(options(page));
    const coverage = coverageReport(result.storeCodes);

    expect(coverage.represented).toBe(2);
    expect(coverage.total).toBe(15);
    expect(coverage.seen).toEqual(["144 — NE Lincoln 27th Street", "306 — KS Manhattan"]);
    expect(coverage.missingCodes).toHaveLength(13);
  });

  it("names a missing location rather than dropping it", () => {
    /*
     * A LOCATION NOT SEEN IS NOT A LOCATION THAT HAS GONE AWAY. It may have no
     * review in the history Google loaded, or Google may not have exposed it.
     * All fifteen stay in ASK Sunny either way, so the report says which were
     * absent and never shortens the roster.
     */
    const coverage = coverageReport(["306"]);

    expect(coverage.total).toBe(15);
    expect(coverage.represented).toBe(1);
    expect(coverage.missing).toContain("314 — KS Lawrence");
    expect(coverage.missing).toContain("409 — MO St Joseph");
    expect(coverage.missing).toHaveLength(14);
  });

  it("reports full coverage when every location was seen", () => {
    const every = [
      "140", "141", "143", "144", "145", "146", "147", "148",
      "231", "254", "306", "307", "314", "373", "409",
    ];
    const coverage = coverageReport(every);

    expect(coverage.represented).toBe(15);
    expect(coverage.missing).toEqual([]);
  });

  it("does not count a store code that is not one of the fifteen", () => {
    const coverage = coverageReport(["306", "236", "999"]);
    expect(coverage.represented).toBe(1);
    expect(coverage.seenCodes).toEqual(["306"]);
  });

  it("prints codes with the salon name beside them", () => {
    /* In allowlist order, which is how every other list of the fifteen reads. */
    expect(describeStoreCodes(["306", "146"])).toEqual([
      "146 — NE Lincoln Pine Lake",
      "306 — KS Manhattan",
    ]);
  });
});

/* ------------------------------------------------------------ pagination -- */

describe("pagination", () => {
  it("advances through pages and accumulates each one", async () => {
    const page = fakePage({
      mode: "paginate",
      batches: [
        [review("FIXTURE-P1", "306")],
        [review("FIXTURE-P2", "144")],
        [review("FIXTURE-P3", "145")],
      ],
    });

    const result = await scanFeed(options(page));

    expect(page.state.pages).toBe(2);
    expect(result.observed).toBe(3);
    expect(result.pagesAdvanced).toBe(2);
  });

  it("stops when the next control is present but disabled", async () => {
    const page = fakePage({
      mode: "paginate",
      batches: [[review("FIXTURE-P1", "306")], [review("FIXTURE-P2", "144")]],
    });
    page.state.nextEnabled = false;

    const result = await scanFeed(options(page));

    expect(result.stopReason).toBe("pagination_end");
    expect(page.state.pages).toBe(0);
    /* And what page one held is still banked. */
    expect(result.observed).toBe(1);
  });

  it("stops when there is neither a scroll container nor a paginator", async () => {
    const page = fakePage({ mode: "paginate", batches: [[review("FIXTURE-P1", "306")]] });
    page.driver.nextControl = () => null;

    const result = await scanFeed(options(page));
    expect(result.stopReason).toBe("no_feed_controls");
    expect(result.observed).toBe(1);
  });
});

/* ------------------------------------------------------------- stopping --- */

describe("stop conditions", () => {
  it("stops after three consecutive passes that find nothing new", async () => {
    const same = [review("FIXTURE-ONLY", "306")];
    const page = fakePage({ batches: [same, same, same, same, same, same] });

    const result = await scanFeed(options(page));

    expect(result.stopReason).toBe("no_new_reviews");
    /* First pass adds it; three more find nothing. */
    expect(result.cycle).toBe(4);
  });

  it("stops at the bottom of a feed that has nothing further to load", async () => {
    const page = fakePage({ batches: [[review("FIXTURE-A", "306")], [review("FIXTURE-B", "144")]] });
    const result = await scanFeed(options(page));

    expect(["feed_end", "no_new_reviews"]).toContain(result.stopReason);
    expect(result.observed).toBe(2);
  });

  it("stops at the cycle cap", async () => {
    /*
     * A feed that yields one new review per pass forever. The cap is a safety
     * bound on driving somebody else's page, not a target — and hitting it is
     * reported rather than disguised as the end of the feed.
     */
    let counter = 0;
    const page = fakePage({ batches: [[]] });
    page.parse = () => parsed([review(`FIXTURE-ENDLESS-${counter++}`, "306")]);
    page.driver.metrics = () => ({ scrollTop: 0, scrollHeight: 10000, clientHeight: 500 });

    const result = await scanFeed(options(page, { limits: { maxCycles: 7 } }));

    expect(result.stopReason).toBe("max_cycles");
    expect(result.cycle).toBe(7);
    expect(result.observed).toBe(7);
  });

  it("stops at the runtime cap", async () => {
    let counter = 0;
    let clock = 0;
    const page = fakePage({ batches: [[]] });
    page.parse = () => parsed([review(`FIXTURE-SLOW-${counter++}`, "306")]);
    page.driver.metrics = () => ({ scrollTop: 0, scrollHeight: 10000, clientHeight: 500 });

    const result = await scanFeed(
      options(page, {
        limits: { maxRuntimeMs: 5000, maxCycles: 500 },
        /* Each pass costs two seconds of scripted time. */
        now: () => (clock += 1000),
      }),
    );

    expect(result.stopReason).toBe("max_runtime");
    expect(result.cycle).toBeLessThan(500);
    /* Everything found before the cap is still returned. */
    expect(result.observed).toBe(result.cycle);
  });

  it("uses conservative defaults", () => {
    expect(SCAN_LIMITS.quietCycles).toBe(3);
    expect(SCAN_LIMITS.maxCycles).toBe(100);
    expect(SCAN_LIMITS.maxRuntimeMs).toBeLessThanOrEqual(3 * 60 * 1000);
  });
});

/* --------------------------------------------------------------- cancel --- */

describe("cancel", () => {
  it("stops scanning and keeps everything already found", async () => {
    const signal = createScanSignal();
    let counter = 0;

    const page = fakePage({ batches: [[]] });
    page.parse = () => {
      const batch = [review(`FIXTURE-CANCEL-${counter}`, "306")];
      counter += 1;
      /* The reader presses Cancel after the third pass. */
      if (counter === 3) signal.cancel();
      return parsed(batch);
    };
    page.driver.metrics = () => ({ scrollTop: 0, scrollHeight: 10000, clientHeight: 500 });

    const result = await scanFeed(options(page, { signal }));

    expect(result.cancelled).toBe(true);
    expect(result.stopReason).toBe("cancelled");
    /* Three passes ran; three reviews were banked and none was discarded. */
    expect(result.observed).toBe(3);
    expect(result.reviews).toHaveLength(3);
  });

  it("does not keep driving the page after it is cancelled", async () => {
    const signal = createScanSignal();
    signal.cancel();

    const page = fakePage({ batches: [[review("FIXTURE-A", "306")]] });
    const result = await scanFeed(options(page, { signal }));

    expect(result.cycle).toBe(0);
    expect(page.state.scrolls).toBe(0);
    expect(page.state.pages).toBe(0);
    expect(result.cancelled).toBe(true);
  });

  it("still puts the reader back where they were", async () => {
    const signal = createScanSignal();
    let counter = 0;
    const page = fakePage({ batches: [[]] });
    page.parse = () => {
      counter += 1;
      if (counter === 2) signal.cancel();
      return parsed([review(`FIXTURE-C-${counter}`, "306")]);
    };
    page.driver.metrics = () => ({ scrollTop: 0, scrollHeight: 10000, clientHeight: 500 });

    await scanFeed(options(page, { signal }));
    expect(page.state.restored).toBe(true);
  });
});

/* ------------------------------------------------------------- position --- */

describe("putting the reader back", () => {
  it("restores the scroll position after a scrolling scan", async () => {
    const page = fakePage({
      batches: [[review("FIXTURE-A", "306")], [review("FIXTURE-B", "144")]],
    });

    const result = await scanFeed(options(page));

    expect(page.state.restored).toBe(true);
    expect(result.returnedToStart).toBe(true);
  });

  it("walks back through pagination as far as it advanced", async () => {
    const page = fakePage({
      mode: "paginate",
      batches: [
        [review("FIXTURE-P1", "306")],
        [review("FIXTURE-P2", "144")],
        [review("FIXTURE-P3", "145")],
      ],
    });

    const result = await scanFeed(options(page));

    expect(page.state.pages).toBe(2);
    expect(page.state.previousClicks).toBe(2);
    expect(result.returnedToStart).toBe(true);
  });

  it("says so when it could not walk all the way back", async () => {
    const page = fakePage({
      mode: "paginate",
      batches: [
        [review("FIXTURE-P1", "306")],
        [review("FIXTURE-P2", "144")],
        [review("FIXTURE-P3", "145")],
      ],
    });
    /* A feed with no Previous control: forward only. */
    page.driver.previousControl = () => null;

    const result = await scanFeed(options(page));

    expect(result.pagesAdvanced).toBe(2);
    expect(result.returnedToStart).toBe(false);
  });
});

/* ------------------------------------------------------------- progress --- */

describe("progress", () => {
  it("reports climbing counts as it goes, and never a reviewer or a comment", async () => {
    const seen = [];
    const page = fakePage({
      batches: [
        [review("FIXTURE-A", "306")],
        [review("FIXTURE-B", "144")],
        [review("FIXTURE-C", "145")],
      ],
    });

    await scanFeed(options(page, { onProgress: (progress) => seen.push(progress) }));

    const scanning = seen.filter((entry) => entry.phase === "scanning");
    expect(scanning.length).toBeGreaterThan(1);
    expect(scanning[0].observed).toBe(1);
    expect(scanning.at(-1).observed).toBeGreaterThanOrEqual(3);

    /* Counts and store codes only. */
    for (const entry of seen) {
      const text = JSON.stringify(entry.storeCodes ?? []);
      expect(text).not.toMatch(/Fixture Person/);
      expect(entry).not.toHaveProperty("reviewerName");
    }
  });

  it("ends with one final snapshot marked complete", async () => {
    const seen = [];
    const page = fakePage({ batches: [[review("FIXTURE-A", "306")]] });

    const result = await scanFeed(options(page, { onProgress: (p) => seen.push(p) }));

    expect(seen.at(-1).phase).toBe("complete");
    expect(result.phase).toBe("complete");
  });
});

/* ----------------------------------------------------- the lightweight pass -- */

describe("scanVisible — what Auto Sync runs", () => {
  it("does not scroll, paginate or wait", () => {
    /*
     * ASSERTED BY CONSTRUCTION: it takes no driver, so it has nothing to drive.
     * A full historical scan every two minutes would move somebody's page under
     * them all day and re-post the backlog each time.
     */
    expect(scanVisible.length).toBeLessThanOrEqual(2);
    const pass = scanVisible(() => parsed([review("FIXTURE-A", "306")]));
    expect(pass.observed).toBe(1);
    expect(pass.fresh).toHaveLength(1);
  });

  it("returns only what has not been reported before", () => {
    const known = new Map();
    const first = scanVisible(() => parsed([review("FIXTURE-A", "306")]), known);
    expect(first.fresh).toHaveLength(1);

    for (const [id, fingerprint] of first.fingerprints) known.set(id, fingerprint);

    const second = scanVisible(
      () => parsed([review("FIXTURE-A", "306"), review("FIXTURE-B", "144")]),
      known,
    );

    expect(second.observed).toBe(2);
    expect(second.fresh.map((entry) => entry.externalReviewId)).toEqual(["FIXTURE-B"]);
  });

  it("re-sends a review whose owner response appeared since", () => {
    const known = new Map();
    const before = scanVisible(() => parsed([review("FIXTURE-A", "306")]), known);
    for (const [id, fingerprint] of before.fingerprints) known.set(id, fingerprint);

    const after = scanVisible(
      () =>
        parsed([
          review("FIXTURE-A", "306", {
            hasOwnerResponse: true,
            ownerResponseText: "Thank you!",
          }),
        ]),
      known,
    );

    expect(after.fresh).toHaveLength(1);
    expect(after.fresh[0].hasOwnerResponse).toBe(true);
  });

  it("sends nothing at all when nothing changed", () => {
    const known = new Map();
    const first = scanVisible(() => parsed([review("FIXTURE-A", "306")]), known);
    for (const [id, fingerprint] of first.fingerprints) known.set(id, fingerprint);

    const again = scanVisible(() => parsed([review("FIXTURE-A", "306")]), known);
    expect(again.fresh).toEqual([]);
  });
});

/* ------------------------------------------------------- the real driver -- */

describe("createPageDriver against a real document", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function mount(html) {
    document.body.innerHTML = html;
    return createPageDriver(document);
  }

  it("finds the scrolling ancestor of a review card, not the window", () => {
    /*
     * THE WHOLE TRICK ON A VIRTUALIZED FEED. The window does not scroll — a div
     * above the reviews does — and scrolling the window instead moves nothing
     * and looks exactly like "the feed has ended".
     */
    const driver = mount(
      `<div id="outer"><div id="feed" style="overflow-y: auto"><div data-lid="FIXTURE-A"></div></div></div>`,
    );

    const feed = document.getElementById("feed");
    Object.defineProperty(feed, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(feed, "clientHeight", { value: 600, configurable: true });

    expect(driver.scrollContainer()?.id).toBe("feed");
  });

  it("falls back to the document when the page itself scrolls", () => {
    const driver = mount(`<div><div data-lid="FIXTURE-A"></div></div>`);
    const container = driver.scrollContainer();
    expect(container === document.scrollingElement || container === document.documentElement).toBe(
      true,
    );
  });

  it("finds a Next control by its words, not by a class name", () => {
    const driver = mount(
      `<div data-lid="FIXTURE-A"></div><button class="VfPpkd-x">Next page</button>`,
    );
    expect(driver.nextControl()?.enabled).toBe(true);
  });

  it.each(["Next", "Next page", "Show more reviews", "Load more", "Older reviews"])(
    "recognises %s as a way forward",
    (label) => {
      const driver = mount(`<div data-lid="FIXTURE-A"></div><button>${label}</button>`);
      expect(driver.nextControl()).not.toBeNull();
    },
  );

  it("reads a disabled Next as the end of the feed", () => {
    const driver = mount(
      `<div data-lid="FIXTURE-A"></div><button disabled>Next page</button>`,
    );
    expect(driver.nextControl()?.enabled).toBe(false);
  });

  it("reads aria-disabled as disabled, which is how a link says it", () => {
    const driver = mount(
      `<div data-lid="FIXTURE-A"></div><a href="#" role="button" aria-disabled="true">Next</a>`,
    );
    expect(driver.nextControl()?.enabled).toBe(false);
  });

  it("clicks rather than navigating, submitting or typing", () => {
    const driver = mount(`<div data-lid="FIXTURE-A"></div><button id="next">Next</button>`);
    const button = document.getElementById("next");
    const clicked = vi.fn();
    button.addEventListener("click", clicked);

    driver.activate(driver.nextControl().element);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("restores the scroll position it saved", () => {
    const driver = mount(
      `<div id="feed" style="overflow-y: scroll"><div data-lid="FIXTURE-A"></div></div>`,
    );
    const feed = document.getElementById("feed");
    Object.defineProperty(feed, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(feed, "clientHeight", { value: 600, configurable: true });

    feed.scrollTop = 120;
    const saved = driver.savePosition();
    feed.scrollTop = 4000;

    driver.restorePosition(saved);
    expect(feed.scrollTop).toBe(120);
  });
});

/* ------------------------------------------- how the extension wires it up -- */

describe("the content script keeps the two modes apart", () => {
  const content = readFileSync("extension/content.js", "utf8");

  it("runs the full scan only from the manual button", () => {
    /*
     * THE LINE THAT MUST NOT MOVE. A full historical scan on the two-minute
     * timer would drive the reader's page around all day and re-post the whole
     * backlog each time.
     */
    const manual = content.slice(
      content.indexOf('message?.type === "ASK_SUNNY_SYNC"'),
      content.indexOf('message?.type === "ASK_SUNNY_CANCEL"'),
    );
    expect(manual).toContain("fullSync");

    const auto = content.slice(content.indexOf("function applyAutoSyncSetting"));
    expect(auto).toContain("lightSync");
    expect(auto).not.toContain("fullSync(");
  });

  it("watches the page for newly rendered review cards while Auto Sync is on", () => {
    expect(content).toContain("MutationObserver");
    expect(content).toContain("startObserving");
    /* Only started with Auto Sync, and torn down when it is switched off. */
    const apply = content.slice(
      content.indexOf("async function applyAutoSyncSetting"),
      content.indexOf("function startObserving"),
    );
    expect(apply).toContain("stopObserving()");
    expect(apply).toContain("startObserving()");
  });

  it("does not run an observed pass while the full scan is driving the page", () => {
    const observing = content.slice(
      content.indexOf("function startObserving"),
      content.indexOf("function addsReviewCard"),
    );
    expect(observing).toContain("if (syncInFlight) return;");
  });

  it("sends progress with counts only, never review content", () => {
    const progress = content.slice(
      content.indexOf("function publicProgress"),
      content.indexOf("/* ------------------------------------------------------------ auto sync -- */"),
    );
    expect(progress.length).toBeGreaterThan(0);
    for (const forbidden of ["reviewerName", "reviewText", "externalReviewId", "businessName"]) {
      expect(progress, forbidden).not.toContain(forbidden);
    }
  });

  it("marks a review as reported only once ASK Sunny has accepted it", () => {
    /*
     * Remembering before the upload would mean a refused token or a dropped
     * connection left these reviews marked as sent, and Auto Sync would never
     * offer them again — a sync that failed loudly would have quietly lost the
     * feed.
     */
    for (const call of [...content.matchAll(/remember\((send|fresh), scanner\)/g)]) {
      const before = content.slice(Math.max(0, call.index - 200), call.index);
      expect(before, call[0]).toMatch(/upload\?\.ok/);
    }
    expect(content.match(/remember\((send|fresh), scanner\)/g)).toHaveLength(2);
  });

  it("does not colour a missing baseline as a problem", () => {
    /*
     * ==========================================================================
     * "SYNCED" AND "COUNTED" ARE TWO DIFFERENT SENTENCES
     * ==========================================================================
     *
     * The popup used to read "Imported. 5 listings counted nothing", in the
     * colour reserved for faults — and a manager reading that after a
     * successful sync of thirty-four reviews concluded, reasonably, that
     * nothing had arrived. Both halves were true; the wording made them one
     * alarming fact.
     *
     * A location with no baseline is not broken. The other three findings name
     * something that went wrong with the sync and a person can put right, so
     * those keep the warning colour.
     */
    const popup = readFileSync("extension/popup.js", "utf8");
    const describe_ = popup.slice(
      popup.indexOf("function describeOutcome"),
      popup.indexOf("function describeLastSync"),
    );

    expect(describe_.length).toBeGreaterThan(0);
    /* What arrived is said first, and in its own sentence. */
    expect(describe_).toContain("synced to ASK Sunny");
    expect(describe_).toContain("Weekly counting has not started");
    expect(describe_).toContain("Set its baseline in ASK Sunny when ready");

    /* `no_anchor` is separated from the findings that keep the warning tone. */
    expect(describe_).toContain('entry.finding === "no_anchor"');
    expect(describe_).toContain('tone: "warn"');
    expect(describe_).toContain('tone: "ok"');

    /*
     * And the alarming phrasing is gone from the CODE. It survives in a comment
     * on purpose — the sentence this replaced is worth keeping a record of, and
     * a comment is not something a manager reads.
     */
    const code = popup.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("listings counted nothing");
    expect(code).not.toContain("Imported.");

    /*
     * "Counted nothing" survives in exactly one place: the branch for a sync
     * that really did go wrong, where it is followed by what to do about it.
     * That sentence is still worth saying, and still in the warning colour.
     */
    const problems = code.slice(code.indexOf("if (problems.length > 0)"));
    expect(problems.slice(0, 600)).toContain("counted nothing:");
  });

  it("never stores review content locally, only ids and counts", () => {
    /*
     * `chrome.storage.local` is a convenience and never the source of truth:
     * Supabase is, keyed on the Google review id. What is kept here is the ids
     * already reported and the last scan's counts — never a name or a comment.
     */
    const stored = [...content.matchAll(/chrome\.storage\.local\s*\.?\s*set\(\{([\s\S]*?)\}\)/g)]
      .map((match) => match[1])
      .join(" ");
    expect(stored.length).toBeGreaterThan(0);
    for (const forbidden of ["reviewerName", "reviewText", "ownerResponseText"]) {
      expect(stored, forbidden).not.toContain(forbidden);
    }
  });
});
