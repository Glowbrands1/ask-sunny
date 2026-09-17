/**
 * THE POPUP — one button, and enough state around it to know whether pressing
 * it will do anything.
 *
 * Phase 1's brief asks for a one-click sync and warns against complicated
 * configuration, so this screen answers three questions and stops: is ASK Sunny
 * configured, is this the Reviews page, and what did the last sync do.
 *
 * NO REVIEW CONTENT REACHES THIS WINDOW. The content script strips the payload
 * before replying, so the popup receives counts and never a reviewer's name.
 */

const target = document.getElementById("target");
const pageState = document.getElementById("page-state");
const syncButton = document.getElementById("sync");
const autoSyncToggle = document.getElementById("auto-sync");
const results = document.getElementById("results");
const resultList = document.getElementById("result-list");
const lastSyncLine = document.getElementById("last-sync");
const cancelButton = document.getElementById("cancel");
const coveragePanel = document.getElementById("coverage");
const coverageCount = document.getElementById("coverage-count");
const coverageMissing = document.getElementById("coverage-missing");

/** The tab the action was clicked on. `activeTab` covers exactly this one. */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function setState(text, tone = "neutral") {
  pageState.textContent = text;
  pageState.dataset.tone = tone;
}

function render(rows) {
  resultList.replaceChildren();
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = String(value);
    resultList.append(term, detail);
  }
  results.hidden = false;
}

/**
 * ============================================================================
 * WHICH OF THE FIFTEEN THIS SCAN SAW — AND WHY AN ABSENCE IS NOT A PROBLEM
 * ============================================================================
 *
 * The sentence this panel has to get right. A salon missing from a scan has NOT
 * gone away and is not misconfigured: it may simply have no review in the
 * history Google loaded, Google may not have exposed it this time, or it may be
 * one of the listings awaiting verification. All fifteen stay in ASK Sunny's
 * roster, on the dashboard and in every total either way.
 *
 * So the wording is "not observed in this scan" rather than "missing", and the
 * list is printed plainly rather than in an alarm colour.
 */
function renderCoverage(coverage) {
  if (!coverage || typeof coverage.represented !== "number") {
    coveragePanel.hidden = true;
    return;
  }

  coverageCount.textContent = `${coverage.represented} / ${coverage.total}`;
  coverageCount.dataset.tone = coverage.represented === coverage.total ? "ok" : "neutral";

  if (coverage.missing?.length > 0) {
    coverageMissing.textContent = `Not observed in this Google review scan:\n${coverage.missing.join(
      "\n",
    )}\n\nThese locations are still tracked in ASK Sunny. Google may simply not have shown a review for them.`;
  } else {
    coverageMissing.textContent = "Every location was seen in this scan.";
  }

  coveragePanel.hidden = false;
}

/**
 * The live counter while a full scan is running.
 *
 * A scan can take a couple of minutes, and a button that says "Syncing…" for
 * two minutes is indistinguishable from one that has hung. These numbers climb,
 * which is the difference.
 */
function renderProgress(progress) {
  const lines = [
    `Reviews observed: ${progress.observed}`,
    `Sun Tan City reviews: ${progress.stcFound}`,
    `Non-STC ignored: ${progress.ignoredOther}`,
    `Locations represented: ${progress.coverage?.represented ?? 0} / ${
      progress.coverage?.total ?? 15
    }`,
  ];
  if (progress.pagesAdvanced > 0) lines.push(`Pages advanced: ${progress.pagesAdvanced}`);

  setState(`Scanning Google Reviews…\n\n${lines.join("\n")}\n\nLoading more reviews…`, "neutral");
  renderCoverage(progress.coverage);
}

/**
 * The four reasons a listing counts nothing, said plainly.
 *
 * Mirrors `STORE_FINDING_LABEL` in `src/lib/reviews/period-assignment.ts`. It is
 * restated rather than imported because an extension cannot import from the
 * application — and it is only ever a MESSAGE: nothing here decides anything,
 * so the two drifting costs a wording, not a number.
 */
const FINDING_LABEL = {
  anchor_not_in_feed:
    "the last counted review was not on this page — scroll further back and sync again",
  feed_position_missing: "the sync carried no feed order",
  feed_order_unreliable:
    "this page is not sorted newest-first — change Google's sort back to Newest and sync again",
};

/**
 * ============================================================================
 * "SYNCED" AND "COUNTED" ARE TWO DIFFERENT SENTENCES
 * ============================================================================
 *
 * This message used to read "Imported. 5 listings counted nothing", in the
 * colour reserved for problems — and a manager reading it after a successful
 * sync of thirty-four reviews concluded, reasonably, that nothing had arrived.
 * Both halves were true and the wording made them one alarming fact.
 *
 * They are separated now, and the order is deliberate:
 *
 *   WHAT ARRIVED comes first and is stated plainly. The reviews ARE in ASK
 *   Sunny; they are in the feed; they can be read, searched and answered.
 *
 *   WHAT HAS NOT STARTED comes second. A location with no baseline is not
 *   broken and is not losing anything — weekly counting simply has not been
 *   switched on for it, which is a setup step somebody does once.
 *
 * NO ANCHOR IS NOT A FAULT AND IS NO LONGER COLOURED LIKE ONE. The other three
 * findings are: they each name something that went wrong with this sync and
 * that a person can put right, so they keep the warning colour.
 *
 * NOTHING ABOUT THE REPORTING RULE CHANGES HERE. Default-deny still holds and
 * a review still counts only where its place in the feed was proven. This is
 * the wording, not the rule.
 */
function describeOutcome(result, upload) {
  const findings = Array.isArray(upload.storeFindings) ? upload.storeFindings : [];
  const waiting = findings.filter((entry) => entry.finding === "no_anchor");
  const problems = findings.filter((entry) => entry.finding !== "no_anchor");

  const synced = result.stcFound ?? upload.received ?? 0;
  const arrived = `${synced} ${synced === 1 ? "review" : "reviews"} synced to ASK Sunny.`;

  /* Something actually went wrong with the sync. That still reads as a warning. */
  if (problems.length > 0) {
    const first = problems[0];
    const reason = FINDING_LABEL[first.finding] ?? "the reporting boundary could not be proven";
    return {
      tone: "warn",
      text: `${arrived} Store ${first.storeCode} counted nothing: ${reason}.`,
    };
  }

  if (waiting.length === 0) {
    return { tone: "ok", text: `✓ ${arrived}` };
  }

  const where =
    waiting.length === 1
      ? `Weekly counting has not started for store ${waiting[0].storeCode} yet. Set its baseline in ASK Sunny when ready.`
      : `Weekly counting has not started for ${waiting.length} locations yet (${waiting
          .map((entry) => entry.storeCode)
          .join(", ")}). Set their baselines in ASK Sunny when ready.`;

  return { tone: "ok", text: `${arrived}\n${where}` };
}

function describeLastSync(lastSync) {
  if (!lastSync?.at) {
    lastSyncLine.textContent = "No sync yet on this machine.";
    return;
  }
  const when = new Date(lastSync.at);
  lastSyncLine.textContent = `Last successful sync: ${when.toLocaleString()}`;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "ASK_SUNNY_STATE" });

  autoSyncToggle.checked = Boolean(state?.autoSync);
  describeLastSync(state?.lastSync);

  if (!state?.baseUrl || !state?.hasToken) {
    target.textContent = "Not configured";
    setState(
      "Open Options and set the ASK Sunny URL and sync token before syncing.",
      "warn",
    );
    syncButton.disabled = true;
    return;
  }

  /* Shown so nobody can sync into the wrong deployment without noticing. */
  target.textContent = state.baseUrl;

  const tab = await activeTab();
  if (!tab?.id || !/^https:\/\/business\.google\.com\//.test(tab.url ?? "")) {
    setState(
      "Open your Google Business Profile Reviews page, then click the extension again.",
      "warn",
    );
    syncButton.disabled = true;
    return;
  }

  let scan;
  try {
    scan = await chrome.tabs.sendMessage(tab.id, { type: "ASK_SUNNY_SCAN" });
  } catch {
    /*
     * The content script is not in this tab — almost always because the page
     * was already open when the extension was loaded, and content scripts are
     * only injected on navigation.
     */
    setState("Reload the Reviews page once, then click the extension again.", "warn");
    syncButton.disabled = true;
    return;
  }

  if (!scan?.ok) {
    setState(scan?.message ?? "This page could not be read.", "warn");
    syncButton.disabled = true;
    return;
  }

  /*
   * ==========================================================================
   * THE BUTTON IS NOW ENABLED WHATEVER IS ON SCREEN
   * ==========================================================================
   *
   * It used to be disabled when the mounted DOM held none of the fifteen, which
   * made sense when pressing it only read the mounted DOM. It now scrolls and
   * pages through the whole feed — so "nothing visible right now" is precisely
   * the situation where pressing it is worth doing, and refusing would leave
   * the reader scrolling by hand to earn the right to click.
   */
  syncButton.disabled = false;

  setState(
    `✓ Reviews page detected — ${scan.stcFound} Sun Tan City ${
      scan.stcFound === 1 ? "review" : "reviews"
    } on screen. Sync reads the whole feed.`,
    "ok",
  );

  renderCoverage(scan.coverage);

  if (scan.stcFound === 0 && scan.discovered > 0) {
    setState(`${describeNoMatches(scan)} Sync will scroll the feed and look further.`, "warn");
    render(diagnosticRows(scan));
    return;
  }

  /*
   * SOME MATCHED AND SOME WERE LOST. The button still works and should still be
   * pressed — but a page where two of ten reviews could not be read is not a
   * clean page, and saying "✓ 8 reviews on screen" would bury that.
   */
  if (scan.unreadable > 0) {
    render(diagnosticRows(scan));
    return;
  }

  results.hidden = true;
}

/**
 * ============================================================================
 * WHY "NONE OF THESE ARE SUN TAN CITY" NEEDS ITS WORKING SHOWN
 * ============================================================================
 *
 * That sentence used to be the only thing the popup said when zero of the
 * fifteen matched, and live QA proved how badly it misleads: the page visibly
 * showed KS Manhattan and NE Lincoln 27th Street, the parser had failed to read
 * their store codes, and the message reported it as the ordinary case of
 * another business on the same Google account. A manager would have believed
 * it.
 *
 * So the two situations are now said differently, and the codes the parser
 * actually read are printed beside them. STORE CODES AND COUNTS ONLY — no
 * review id, no reviewer name, no comment, no business name.
 */
function describeNoMatches(scan) {
  const parsed = Array.isArray(scan.storeCodes) ? scan.storeCodes : [];
  const unresolved = scan.unresolvedStoreCodes ?? 0;

  if (parsed.length === 0 && unresolved > 0) {
    /* The parser defect, named as one. This is not "somebody else's shop". */
    return `Store code unresolved: ${unresolved} of ${scan.discovered} ${
      unresolved === 1 ? "review" : "reviews"
    }. The page was read but no location could be identified — this is a parser problem, not a Sun Tan City one.`;
  }

  return `Reviews page detected, but none of the ${scan.discovered} reviews on screen belong to the fifteen Sun Tan City stores.`;
}

/**
 * Why a card could not be read, in the words somebody would use to look.
 *
 * Mirrors the reason codes `parseReviewsFromDocument` emits. A code with no
 * entry here is still shown — an unlabelled reason is better than a missing
 * line, because the point of this panel is that nothing fails silently.
 */
const UNREADABLE_LABEL = {
  missing_review_id: "missing review id",
  missing_rating: "missing rating",
  invalid_rating: "rating outside 1–5",
  missing_reviewer: "missing reviewer",
  extraction_failed: "extraction threw",
};

/** The QA panel. Shown whenever reviews were found and none of them matched. */
function diagnosticRows(scan) {
  const parsed = Array.isArray(scan.storeCodes) ? scan.storeCodes : [];
  const allowed = Array.isArray(scan.allowedStoreCodes) ? scan.allowedStoreCodes : [];
  const unresolved = scan.unresolvedStoreCodes ?? 0;

  const rows = [
    ["Reviews discovered", scan.discovered],
    ["Parsed store codes", parsed.length > 0 ? parsed.join(", ") : "none"],
    ["Allowed STC matches", allowed.length > 0 ? allowed.join(", ") : "none"],
    ["Store code unresolved", `${unresolved} ${unresolved === 1 ? "review" : "reviews"}`],
    ["Unreadable on the page", scan.unreadable],
  ];

  /*
   * THE BREAKDOWN, AND WHY IT EARNS ITS SPACE. "Unreadable: 3" is true and
   * useless; it cost two QA rounds. "missing rating: 3" says which extraction
   * rung to go and look at, which is the whole difference between a bug report
   * and a bug fix.
   */
  for (const [reason, count] of Object.entries(scan.unreadableReasons ?? {})) {
    rows.push([`— ${UNREADABLE_LABEL[reason] ?? reason}`, count]);
  }

  rows.push(["Parser version", scan.parserVersion]);
  return rows;
}

/*
 * ============================================================================
 * PROGRESS ARRIVES WHILE THE SCAN RUNS, NOT WHEN IT FINISHES
 * ============================================================================
 *
 * The content script broadcasts a snapshot each cycle. The popup may not be
 * open — that is fine and expected, and the scan does not depend on anybody
 * listening. When it IS open, these are the numbers that climb.
 *
 * COUNTS AND STORE CODES ONLY. The content script strips everything else before
 * it sends, so no reviewer name, comment or review id can arrive here.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "ASK_SUNNY_PROGRESS") return false;
  if (message.progress?.phase === "scanning") renderProgress(message.progress);
  return false;
});

function scanRunning(running) {
  syncButton.disabled = running;
  syncButton.textContent = running ? "Scanning…" : "Sync Sun Tan City Reviews";
  cancelButton.hidden = !running;
  autoSyncToggle.disabled = running;
}

cancelButton.addEventListener("click", async () => {
  cancelButton.disabled = true;
  cancelButton.textContent = "Cancelling…";
  const tab = await activeTab();
  if (tab?.id) {
    /*
     * A REQUEST, NOT A KILL. The scan finishes the cycle it is in, keeps every
     * review it has already banked, puts the reader back where they were and
     * returns normally — so cancelling ninety seconds in costs the rest of the
     * feed and nothing else.
     */
    await chrome.tabs.sendMessage(tab.id, { type: "ASK_SUNNY_CANCEL" }).catch(() => {});
  }
});

syncButton.addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;

  scanRunning(true);
  cancelButton.disabled = false;
  cancelButton.textContent = "Cancel";
  setState("Scanning Google Reviews…", "neutral");

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "ASK_SUNNY_SYNC" });

    if (!result?.ok) {
      setState(result?.message ?? "The sync could not run.", "warn");
      return;
    }

    renderCoverage(result.coverage);

    const upload = result.upload ?? {};
    if (!upload.ok) {
      setState(upload.message ?? "ASK Sunny did not accept the sync.", "warn");
      render([
        ["Reviews observed", result.discovered],
        ["Sun Tan City reviews found", result.stcFound],
        ["Failures", "Upload refused"],
      ]);
      return;
    }

    render(scanResultRows(result, upload));

    /*
     * WHAT ARRIVED, THEN WHAT HAS NOT STARTED. The common first-run state —
     * every review imported and nothing counted, because no salon has a
     * baseline yet — is a correct sync and now reads as one.
     */
    const outcome = describeOutcome(result, upload);

    if (result.cancelled) {
      setState(
        `Scan cancelled. The ${result.stcFound} Sun Tan City ${
          result.stcFound === 1 ? "review" : "reviews"
        } already found were kept and synced to ASK Sunny.`,
        "warn",
      );
    } else {
      setState(`${outcome.text}\n\n${result.stopMessage}`, outcome.tone);
    }

    describeLastSync(upload);
  } finally {
    scanRunning(false);
  }
});

/** The full-scan summary, in the order somebody reads it. */
function scanResultRows(result, upload) {
  const rows = [
    ["Reviews observed", result.discovered],
    ["Sun Tan City reviews found", result.stcFound],
    ["Locations represented", `${result.coverage?.represented ?? 0} / ${result.coverage?.total ?? 15}`],
    ["New reviews imported", upload.created],
    ["Existing reviews updated", upload.updated],
    ["Duplicates ignored", upload.duplicates],
    /*
     * THE TWO FIGURES THAT SAY WHETHER A NUMBER MOVED. `created` counts rows;
     * these count what the business will report. A first import shows a large
     * `created` and a `countedIntoPeriod` of zero — which is correct, and is
     * the thing a manager has to be able to see rather than infer.
     */
    ["Counted into this reporting week", upload.countedIntoPeriod],
    ["Stored as history (counts toward nothing)", upload.storedAsHistorical],
    ["Non-Sun-Tan-City reviews ignored", result.ignoredOther + upload.ignoredNonStc],
    /*
     * TWO SEPARATE FAILURE LINES, because they mean different things. A review
     * whose page could not be read is a parser problem; a Sun Tan City review
     * with an unreadable store code is one of OURS being dropped, and that is
     * the one worth chasing.
     */
    ["Unreadable on the page", result.unreadable],
    ...Object.entries(result.unreadableReasons ?? {}).map(([reason, count]) => [
      `— ${UNREADABLE_LABEL[reason] ?? reason}`,
      count,
    ]),
    ["Sun Tan City reviews with no usable store code", result.unknownStore],
    [
      "Store codes on this page",
      Array.isArray(result.storeCodes) && result.storeCodes.length > 0
        ? result.storeCodes.join(", ")
        : "none",
    ],
    ["Failures", upload.invalid],
    /* How far the scan went, so a short result can be told from a short feed. */
    ["Scan passes", result.cycles],
    ["Pages advanced", result.pagesAdvanced],
    ["Parser version", result.parserVersion],
  ];

  if (!result.returnedToStart) {
    rows.push(["Page position", "could not be fully restored"]);
  }
  return rows;
}

autoSyncToggle.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoSync: autoSyncToggle.checked });
});

document.getElementById("open-options").addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("open-dashboard").addEventListener("click", async (event) => {
  event.preventDefault();
  const state = await chrome.runtime.sendMessage({ type: "ASK_SUNNY_STATE" });
  if (!state?.baseUrl) {
    chrome.runtime.openOptionsPage();
    return;
  }
  await chrome.tabs.create({ url: `${state.baseUrl.replace(/\/+$/, "")}/reviews` });
});

void refresh();
