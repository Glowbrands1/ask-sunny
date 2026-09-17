/**
 * THE CONTENT SCRIPT — the only code that touches Google's page, and it reads.
 *
 * ============================================================================
 * WHAT IT DOES, IN FULL
 * ============================================================================
 *
 * It calls `parseReviewsFromDocument` over the document already rendered in the
 * tab, drops anything that is not one of the fifteen Sun Tan City listings, and
 * hands the rest to the background service worker.
 *
 * ============================================================================
 * TWO MODES, AND THE DIFFERENCE BETWEEN THEM IS THE POINT
 * ============================================================================
 *
 * FULL SYNC — the manual button. Scrolls and pages through the WHOLE available
 * feed, banking every review as it goes, and reports coverage over the fifteen
 * at the end. This is what the initial historical import needs, and it used to
 * be a job somebody did by hand: scroll, click, scroll, click.
 *
 * LIGHT SYNC — Auto Sync and the mutation watcher. One pass over what is
 * mounted, sending only what is new or changed. It does not scroll and does not
 * page, because a full historical scan every two minutes would move the
 * reader's page under them all day and re-post a year of backlog each time.
 *
 * ============================================================================
 * WHAT IT CANNOT DO, BY CONSTRUCTION
 * ============================================================================
 *
 * IT HOLDS NO TOKEN. The ASK Sunny sync token lives in the background service
 * worker and is never sent into this script — so a page Google controls cannot
 * reach it, whatever that page does. This is the single most important line in
 * the file and it is a structural property rather than a promise: the token is
 * never read here, so there is nothing here to steal.
 *
 * IT MAKES NO NETWORK REQUEST. Uploading is the background worker's job. A
 * `fetch` from this script would run as business.google.com and would be
 * subject to that origin's rules; more to the point, it would mean the token
 * had to be here.
 *
 * IT DOES NOT NAVIGATE, SUBMIT OR TYPE. It does not touch cookies, storage,
 * tokens or form fields, and there is no code path that could —
 * `document.cookie` appears nowhere in this extension.
 *
 * IT DOES SCROLL AND PRESS "NEXT", and only during a full sync the reader
 * asked for by pressing a button. Both are gestures the reader would make
 * themselves to see the same reviews; nothing is opened, nothing is submitted,
 * and the reader is put back where they started afterwards. Auto Sync does
 * neither.
 *
 * ============================================================================
 * WHY THE PARSER ARRIVES BY DYNAMIC IMPORT
 * ============================================================================
 *
 * A Manifest V3 content script is a classic script and cannot use `import`. It
 * can `await import()` a module declared in `web_accessible_resources`, which
 * is what happens below — and the payoff is that the file running here is
 * byte-for-byte the file the tests exercise under jsdom, rather than a copy
 * that drifts.
 */

const PARSER_URL = chrome.runtime.getURL("parser.js");
const ALLOWLIST_URL = chrome.runtime.getURL("store-codes.js");
const SCANNER_URL = chrome.runtime.getURL("scanner.js");

/** Auto Sync's rescan interval. Two minutes, per the Phase 1 brief. */
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000;

/** How long to let the DOM settle after Google inserts cards, before parsing. */
const MUTATION_DEBOUNCE_MS = 1200;

/** Ids remembered locally, so Auto Sync can tell "new" from "seen". */
const MAX_REMEMBERED_IDS = 5000;

let modules = null;
let autoSyncTimer = null;
let syncInFlight = false;
let observer = null;
let mutationTimer = null;

/**
 * WHAT THIS TAB HAS ALREADY TOLD ASK SUNNY: id -> content fingerprint.
 *
 * Auto Sync's whole economy. A review already sent with the same content is not
 * sent again; one whose owner response appeared since is, because that is a new
 * fact. It is a CACHE and never an authority — Supabase decides what exists,
 * keyed on the Google review id, and a wrong guess here costs a redundant POST
 * the server deduplicates rather than a lost review.
 */
let reported = new Map();

async function loadModules() {
  if (modules) return modules;
  const [parser, allowlist, scanner] = await Promise.all([
    import(PARSER_URL),
    import(ALLOWLIST_URL),
    import(SCANNER_URL),
  ]);
  modules = { parser, allowlist, scanner };
  return modules;
}

/**
 * Reads the page and reports what is on it, without sending anything.
 *
 * Used by the popup to say "8 Sun Tan City reviews found" BEFORE the manager
 * commits to a sync, and by the diagnostics view. A dry run that cannot write
 * is a safe thing to offer.
 */
async function scan() {
  const { parser, allowlist } = await loadModules();

  if (!parser.looksLikeReviewsPage(document)) {
    return {
      ok: false,
      code: "not_reviews_page",
      /*
       * THE TWO FAILURES THIS MESSAGE HAS TO TELL APART. A page with no review
       * elements is either the wrong page or the right page with an expired
       * Google session — and the fix differs. The wording covers both and names
       * the only action that helps, which is to sign in to Google normally.
       */
      message:
        "Google Business Profile is not available. Please sign in to Google normally, then return to the Reviews page.",
    };
  }

  const parsed = parser.parseReviewsFromDocument(document);
  const { send, ignoredOther, unknownStore } = allowlist.classifyReviews(parsed.reviews);

  return {
    ok: true,
    parserVersion: parsed.parserVersion,
    discovered: parsed.discovered,
    duplicatesCollapsed: parsed.duplicatesCollapsed,
    unreadable: parsed.unreadable.length,
    /*
     * WHY each one was unreadable, as counts by reason. "Unreadable on the
     * page: 3" is the number that sent this build back from QA without ever
     * saying which field broke; "missing rating: 3" names the rung to look at.
     */
    unreadableReasons: parsed.unreadableReasons,
    stcFound: send.length,
    ignoredOther: ignoredOther.length,
    unknownStore: unknownStore.length,
    /*
     * ========================================================================
     * WHAT THE PARSER ACTUALLY READ OFF THIS PAGE
     * ========================================================================
     *
     * Added after live QA, where a broken store-code read reported itself as
     * "none of these are Sun Tan City" — the one sentence that makes a parser
     * defect look like the normal case of another business on the same Google
     * account. These three fields tell those apart at a glance:
     *
     *   `storeCodes` — every code the page yielded. Empty beside a non-zero
     *   `discovered` means the association broke, not that the salons are
     *   somebody else's.
     *
     *   `allowedStoreCodes` — which of them are on the fifteen.
     *
     *   `unresolvedStoreCodes` — reviews the parser could not place at all.
     *
     * DIAGNOSTICS CARRY COUNTS, STORE CODES AND STRATEGY NAMES, NEVER CONTENT.
     * No review id, no reviewer name, no review text, no business name — a
     * diagnostics panel is exactly where somebody's words must not end up, and
     * a store code is a fact about a shop rather than about a person.
     */
    storeCodes: parsed.storeCodes,
    allowedStoreCodes: [...new Set(send.map((review) => review.storeCode))].sort(),
    unresolvedStoreCodes: parsed.unresolvedStoreCodes,
    /*
     * WHICH OF THE FIFTEEN THIS PAGE SHOWS. A location absent here has not gone
     * away — it may simply have no review in the part of the feed on screen,
     * which is exactly what a full scan is for.
     */
    coverage: allowlist.coverageReport(
      send.map((review) => review.storeCode).filter(Boolean),
    ),
    strategies: summariseStrategies(send),
    payload: allowlist.toApiPayload(send),
  };
}

function summariseStrategies(reviews) {
  const counts = {};
  for (const review of reviews) {
    for (const [field, strategy] of Object.entries(review.strategies ?? {})) {
      const key = `${field}:${strategy}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/* ------------------------------------------------------------ full sync -- */

/**
 * ============================================================================
 * THE MANUAL BUTTON NOW MEANS "READ THE WHOLE FEED"
 * ============================================================================
 *
 * It used to mean "read what is mounted", which on a lazy-loading page is four
 * reviews out of dozens. It now scrolls and pages through the feed, banking
 * every review as it goes, and reports coverage over the fifteen at the end.
 *
 * ONE UPLOAD AT THE END, not one per cycle. The accumulated Map is already
 * deduplicated, the server deduplicates again on `(source, external_review_id)`,
 * and a POST per scroll step would turn one sync into a hundred requests
 * against a rate limiter that exists for good reasons.
 */
let activeScan = null;

async function fullSync(trigger) {
  if (syncInFlight) {
    return { ok: false, code: "busy", message: "A sync is already running." };
  }
  syncInFlight = true;

  const { parser, allowlist, scanner } = await loadModules();

  try {
    if (!parser.looksLikeReviewsPage(document)) return notReviewsPage();

    const signal = scanner.createScanSignal();
    activeScan = signal;

    const scan = await scanner.scanFeed({
      parse: () => parser.parseReviewsFromDocument(document),
      driver: scanner.createPageDriver(document),
      classify: (reviews) => allowlist.classifyReviews(reviews),
      signal,
      /*
       * PROGRESS IS BROADCAST, NOT RETURNED. A scan can run for minutes and the
       * popup closes the moment the reader looks away from it, so each update
       * is sent and the failure to deliver one is ignored. The scan does not
       * depend on anybody watching.
       */
      onProgress: (progress) => {
        void chrome.runtime
          .sendMessage({ type: "ASK_SUNNY_PROGRESS", progress: publicProgress(progress, allowlist) })
          .catch(() => {});
      },
    });

    const { send, ignoredOther, unknownStore } = allowlist.classifyReviews(scan.reviews);
    const payload = allowlist.toApiPayload(send);

    const upload = await chrome.runtime.sendMessage({
      type: "ASK_SUNNY_UPLOAD",
      trigger,
      parserVersion: scan.parserVersion ?? parser.PARSER_VERSION,
      reviews: payload,
    });

    /*
     * BANKED ONLY ONCE ASK SUNNY HAS THEM. Remembering before the upload would
     * mean a refused token or a dropped connection left these reviews marked as
     * reported, and Auto Sync would never offer them again — a sync that failed
     * loudly would have quietly lost the feed.
     */
    if (upload?.ok) remember(send, scanner);

    const result = {
      ok: true,
      mode: "full",
      parserVersion: scan.parserVersion ?? parser.PARSER_VERSION,
      discovered: scan.observed,
      cycles: scan.cycle,
      pagesAdvanced: scan.pagesAdvanced,
      pagesRewound: scan.pagesRewound,
      pagesScanned: scan.pagesScanned,
      startedAtFeedStart: scan.startedAtFeedStart,
      elapsedMs: scan.elapsedMs,
      stopReason: scan.stopReason,
      stopMessage: scan.stopMessage,
      cancelled: scan.cancelled,
      returnedToStart: scan.returnedToStart,
      unreadable: scan.unreadable,
      unreadableReasons: scan.unreadableReasons,
      stcFound: send.length,
      ignoredOther: ignoredOther.length,
      unknownStore: unknownStore.length,
      storeCodes: scan.storeCodes,
      allowedStoreCodes: scan.storeCodes,
      unresolvedStoreCodes: send.filter((review) => review.storeCode === null).length,
      coverage: allowlist.coverageReport(scan.storeCodes),
      strategies: summariseStrategies(send),
      upload,
    };

    await rememberScan(result);
    return result;
  } finally {
    activeScan = null;
    syncInFlight = false;
  }
}

/** Counts and store codes only. Never a review id, a name or a comment. */
function publicProgress(progress, allowlist) {
  return {
    phase: progress.phase,
    cycle: progress.cycle,
    observed: progress.observed,
    stcFound: progress.stcFound,
    ignoredOther: progress.ignoredOther,
    unknownStore: progress.unknownStore,
    unreadable: progress.unreadable,
    pagesAdvanced: progress.pagesAdvanced,
    pagesRewound: progress.pagesRewound,
    pagesScanned: progress.pagesScanned,
    coverage: allowlist.coverageReport(progress.storeCodes ?? []),
  };
}

/* ------------------------------------------------------------ auto sync -- */

/**
 * ============================================================================
 * AUTO SYNC IS A GLANCE, NOT A SCAN
 * ============================================================================
 *
 * One pass over what is mounted. It does NOT scroll, does not paginate and does
 * not walk the history — a full historical scan every two minutes would drive
 * somebody's page around under them all day and re-post a year of backlog each
 * time, which is the opposite of a background convenience.
 *
 * ONLY WHAT IS NEW OR CHANGED IS SENT. `reported` holds a fingerprint per review
 * this tab has already filed, so an untouched card costs nothing and an owner
 * response added since the last look is re-sent as an update.
 */
async function lightSync(trigger) {
  if (syncInFlight) return { ok: false, code: "busy", message: "A sync is already running." };
  syncInFlight = true;

  try {
    const { parser, allowlist, scanner } = await loadModules();
    if (!parser.looksLikeReviewsPage(document)) return notReviewsPage();

    const pass = scanner.scanVisible(
      () => parser.parseReviewsFromDocument(document),
      reported,
    );

    const { send, ignoredOther, unknownStore } = allowlist.classifyReviews(pass.all);
    const fresh = allowlist.classifyReviews(pass.fresh).send;

    /* Nothing new on screen is the normal outcome and is not a failure. */
    let upload = null;
    if (fresh.length > 0) {
      upload = await chrome.runtime.sendMessage({
        type: "ASK_SUNNY_UPLOAD",
        trigger,
        parserVersion: pass.parserVersion ?? parser.PARSER_VERSION,
        reviews: allowlist.toApiPayload(fresh),
      });
      /* Same rule: a review is only "reported" once ASK Sunny has accepted it. */
      if (upload?.ok) remember(fresh, scanner);
    }

    return {
      ok: true,
      mode: "light",
      parserVersion: pass.parserVersion ?? parser.PARSER_VERSION,
      discovered: pass.observed,
      unreadable: pass.unreadable,
      unreadableReasons: pass.unreadableReasons,
      stcFound: send.length,
      freshCount: fresh.length,
      ignoredOther: ignoredOther.length,
      unknownStore: unknownStore.length,
      storeCodes: [...new Set(send.map((review) => review.storeCode).filter(Boolean))].sort(),
      allowedStoreCodes: [...new Set(fresh.map((review) => review.storeCode).filter(Boolean))].sort(),
      unresolvedStoreCodes: 0,
      coverage: allowlist.coverageReport(send.map((review) => review.storeCode)),
      strategies: summariseStrategies(send),
      upload,
    };
  } finally {
    syncInFlight = false;
  }
}

function notReviewsPage() {
  return {
    ok: false,
    code: "not_reviews_page",
    message:
      "Google Business Profile is not available. Please sign in to Google normally, then return to the Reviews page.",
  };
}

/* ------------------------------------------------------------- the memory -- */

/** Banks what has been filed, so the next glance can tell new from seen. */
function remember(reviews, scanner) {
  for (const review of reviews) {
    if (!review?.externalReviewId) continue;
    reported.set(review.externalReviewId, scanner.reviewFingerprint(review));
  }

  /*
   * BOUNDED. A tab left open for a week across a large estate must not grow a
   * map without end; the oldest entries are dropped and, at worst, a review is
   * sent once more and deduplicated by the server.
   */
  if (reported.size > MAX_REMEMBERED_IDS) {
    const keep = [...reported.entries()].slice(-MAX_REMEMBERED_IDS);
    reported = new Map(keep);
  }

  void chrome.storage.local
    .set({ observedReviewIds: [...reported.keys()].slice(-MAX_REMEMBERED_IDS) })
    .catch(() => {});
}

/**
 * The last scan's COVERAGE, kept locally so the popup can answer "what did the
 * last full sync find?" without re-reading the page.
 *
 * COUNTS AND STORE CODES. No reviewer, no comment, no review id — the same rule
 * the diagnostics panel keeps, for the same reason.
 */
async function rememberScan(result) {
  try {
    await chrome.storage.local.set({
      lastScan: {
        at: new Date().toISOString(),
        observed: result.discovered,
        stcFound: result.stcFound,
        ignoredOther: result.ignoredOther,
        unreadable: result.unreadable,
        cycles: result.cycles,
        pagesAdvanced: result.pagesAdvanced,
        pagesRewound: result.pagesRewound,
        pagesScanned: result.pagesScanned,
        startedAtFeedStart: result.startedAtFeedStart,
        stopReason: result.stopReason,
        cancelled: result.cancelled,
        coverage: result.coverage,
      },
    });
  } catch {
    /* Storage is a convenience here. A scan that cannot be recorded still ran. */
  }
}

async function restoreMemory() {
  try {
    const { observedReviewIds } = await chrome.storage.local.get({ observedReviewIds: [] });
    /*
     * IDS ONLY, WITHOUT FINGERPRINTS. A previous session's ids are remembered
     * so a reopened tab does not re-post everything it can see — but an empty
     * fingerprint would make every one of them look CHANGED, so they are seeded
     * with a sentinel that no real fingerprint equals and the first pass after a
     * reload re-sends them once. Cheap, and the server deduplicates.
     */
    for (const id of observedReviewIds ?? []) {
      if (!reported.has(id)) reported.set(id, "\u0000restored");
    }
  } catch {
    /* No memory is a slower first pass, never a wrong one. */
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  /* A dry look at what is mounted. Writes nothing; used by the popup on open. */
  if (message?.type === "ASK_SUNNY_SCAN") {
    scan()
      .then((result) => sendResponse(stripPayload(result)))
      .catch((error) => sendResponse({ ok: false, code: "scan_failed", message: String(error) }));
    return true;
  }

  /* THE BUTTON. Reads the whole available feed. */
  if (message?.type === "ASK_SUNNY_SYNC") {
    fullSync("manual")
      .then((result) => sendResponse(stripPayload(result)))
      .catch((error) => sendResponse({ ok: false, code: "sync_failed", message: String(error) }));
    return true;
  }

  /*
   * CANCEL. Flips the flag the scan loop reads between cycles; the scan then
   * finishes the cycle it is in, keeps everything already banked, puts the
   * reader back where they were and returns normally. Nothing is torn down
   * mid-flight and no promise is left running.
   */
  if (message?.type === "ASK_SUNNY_CANCEL") {
    activeScan?.cancel();
    sendResponse({ ok: true, cancelling: Boolean(activeScan) });
    return false;
  }

  return false;
});

/** The popup never needs the reviews themselves, so they do not travel to it. */
function stripPayload(result) {
  if (!result || typeof result !== "object") return result;
  const { payload, ...rest } = result;
  return { ...rest, payloadSize: Array.isArray(payload) ? payload.length : 0 };
}

/* ------------------------------------------------ auto sync and observing -- */

/**
 * AUTO SYNC, AND WHAT IT DELIBERATELY IS NOT.
 *
 * While the Reviews page is open, take a light look every two minutes and
 * whenever Google inserts cards. That is all. It does not scroll, does not
 * paginate, does not walk the history, does not refresh the page, does not open
 * tabs, and does not run when the tab is hidden — a full historical scan firing
 * in a background tab every two minutes is how a well-meant convenience turns
 * into traffic nobody asked for.
 *
 * Phase 1 is a manual click with this as a small convenience on top. Real
 * always-on synchronisation is Phase 2's problem and belongs on a server, not
 * in somebody's browser tab.
 */
async function applyAutoSyncSetting() {
  const { autoSync } = await chrome.storage.local.get({ autoSync: false });

  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  stopObserving();
  if (!autoSync) return;

  autoSyncTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void lightSync("auto");
  }, AUTO_SYNC_INTERVAL_MS);

  startObserving();
}

/**
 * ============================================================================
 * WATCHING THE READER MOVE THROUGH THE FEED
 * ============================================================================
 *
 * The two-minute timer catches reviews that ARRIVE. This catches reviews that
 * the reader reaches: scrolling down, clicking to page two, or Google inserting
 * a batch on its own. Without it, browsing to a part of the feed the extension
 * has never seen does nothing until the next tick, and reopening the popup to
 * make something happen is exactly the manual step this build exists to remove.
 *
 * DEBOUNCED HARD, because Google mutates this page constantly — a hover, a
 * tooltip and a lazy image are all mutations, and parsing on each would be a
 * parse per animation frame. A batch of cards lands in one burst, so the work
 * happens once the burst stops.
 *
 * FILTERED TO REVIEW CARDS. A mutation that adds no `[data-lid]` is not
 * interesting, and checking that is far cheaper than a parse.
 */
function startObserving() {
  if (observer || typeof MutationObserver !== "function") return;

  observer = new MutationObserver((records) => {
    if (document.visibilityState !== "visible") return;
    if (!records.some(addsReviewCard)) return;

    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      /* Never while the full scan is driving the page: it parses every cycle. */
      if (syncInFlight) return;
      void lightSync("observed");
    }, MUTATION_DEBOUNCE_MS);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function addsReviewCard(record) {
  for (const node of record.addedNodes ?? []) {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;
    if (node.hasAttribute?.("data-lid")) return true;
    if (node.querySelector?.("[data-lid]")) return true;
  }
  return false;
}

function stopObserving() {
  observer?.disconnect();
  observer = null;
  clearTimeout(mutationTimer);
  mutationTimer = null;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.autoSync) void applyAutoSyncSetting();
});

void restoreMemory().then(applyAutoSyncSetting);
