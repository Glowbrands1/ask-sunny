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
 * IT DOES NOT NAVIGATE, CLICK, SUBMIT, SCROLL OR TYPE. There is no automation
 * of any kind. It does not touch cookies, storage, tokens or form fields, and
 * there is no code path that could — `document.cookie` appears nowhere in this
 * extension.
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

/** Auto Sync's rescan interval. Two minutes, per the Phase 1 brief. */
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000;

let modules = null;
let autoSyncTimer = null;
let syncInFlight = false;

async function loadModules() {
  if (modules) return modules;
  const [parser, allowlist] = await Promise.all([
    import(PARSER_URL),
    import(ALLOWLIST_URL),
  ]);
  modules = { parser, allowlist };
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

/** Reads the page and asks the background worker to file what it found. */
async function sync(trigger) {
  if (syncInFlight) return { ok: false, code: "busy", message: "A sync is already running." };
  syncInFlight = true;
  try {
    const found = await scan();
    if (!found.ok) return found;

    const response = await chrome.runtime.sendMessage({
      type: "ASK_SUNNY_UPLOAD",
      trigger,
      parserVersion: found.parserVersion,
      reviews: found.payload,
    });

    return { ...found, upload: response };
  } finally {
    syncInFlight = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_SUNNY_SCAN") {
    scan()
      .then((result) => sendResponse(stripPayload(result)))
      .catch((error) => sendResponse({ ok: false, code: "scan_failed", message: String(error) }));
    return true;
  }

  if (message?.type === "ASK_SUNNY_SYNC") {
    sync("manual")
      .then((result) => sendResponse(stripPayload(result)))
      .catch((error) => sendResponse({ ok: false, code: "sync_failed", message: String(error) }));
    return true;
  }

  return false;
});

/** The popup never needs the reviews themselves, so they do not travel to it. */
function stripPayload(result) {
  if (!result || typeof result !== "object") return result;
  const { payload, ...rest } = result;
  return { ...rest, payloadSize: Array.isArray(payload) ? payload.length : 0 };
}

/* ------------------------------------------------------------ auto sync -- */

/**
 * AUTO SYNC, AND WHAT IT DELIBERATELY IS NOT.
 *
 * While the Reviews page is open, rescan every two minutes. That is all. It
 * does not scroll, does not paginate, does not refresh the page, does not open
 * tabs, and does not run when the tab is hidden — a timer firing in a
 * background tab for hours is how a well-meant convenience turns into traffic
 * nobody asked for.
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
  if (!autoSync) return;

  autoSyncTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void sync("auto");
  }, AUTO_SYNC_INTERVAL_MS);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.autoSync) void applyAutoSyncSetting();
});

void applyAutoSyncSetting();
