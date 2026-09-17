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
 * The four reasons a listing counts nothing, said plainly.
 *
 * Mirrors `STORE_FINDING_LABEL` in `src/lib/reviews/period-assignment.ts`. It is
 * restated rather than imported because an extension cannot import from the
 * application — and it is only ever a MESSAGE: nothing here decides anything,
 * so the two drifting costs a wording, not a number.
 */
const FINDING_LABEL = {
  no_anchor:
    "no reporting anchor yet, so nothing is being counted — set the anchor in ASK Sunny to start",
  anchor_not_in_feed:
    "the last counted review was not on this page — scroll further back and sync again",
  feed_position_missing: "the sync carried no feed order",
  feed_order_unreliable:
    "this page is not sorted newest-first — change Google's sort back to Newest and sync again",
};

function describeFindings(findings) {
  const counted = findings.length;
  const first = findings[0];
  const reason = FINDING_LABEL[first.finding] ?? "the reporting boundary could not be proven";
  return counted === 1
    ? `Imported. Store ${first.storeCode} counted nothing: ${reason}.`
    : `Imported. ${counted} listings counted nothing — store ${first.storeCode}: ${reason}.`;
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

  setState(
    `✓ Reviews page detected — ${scan.stcFound} Sun Tan City ${
      scan.stcFound === 1 ? "review" : "reviews"
    } on screen`,
    "ok",
  );
  syncButton.disabled = scan.stcFound === 0;

  if (scan.stcFound === 0) {
    setState(
      `Reviews page detected, but none of the ${scan.discovered} reviews on screen belong to the fifteen Sun Tan City stores.`,
      "warn",
    );
  }
}

syncButton.addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;

  syncButton.disabled = true;
  syncButton.textContent = "Syncing…";

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "ASK_SUNNY_SYNC" });

    if (!result?.ok) {
      setState(result?.message ?? "The sync could not run.", "warn");
      return;
    }

    const upload = result.upload ?? {};
    if (!upload.ok) {
      setState(upload.message ?? "ASK Sunny did not accept the sync.", "warn");
      render([
        ["Reviews discovered", result.discovered],
        ["Sun Tan City reviews found", result.stcFound],
        ["Failures", "Upload refused"],
      ]);
      return;
    }

    render([
      ["Reviews discovered", result.discovered],
      ["Sun Tan City reviews found", result.stcFound],
      ["New reviews imported", upload.created],
      ["Existing reviews updated", upload.updated],
      ["Duplicates ignored", upload.duplicates],
      /*
       * THE LINE THAT ANSWERS "DID MONDAY'S NUMBER MOVE?".
       *
       * Importing and counting are different things, and conflating them is the
       * defect this build corrects: a first sync pulls in a year of backlog and
       * must raise this week's total by nothing. So the popup reports both, and
       * a zero here beside a large "imported" is a correct sync rather than a
       * broken one.
       */
      ["Counted into this reporting week", upload.countedIntoPeriod],
      ["Stored as history (counts toward nothing)", upload.storedAsHistorical],
      ["Non-Sun-Tan-City reviews ignored", result.ignoredOther + upload.ignoredNonStc],
      /*
       * TWO SEPARATE FAILURE LINES, because they mean different things. A
       * review whose page could not be read is a parser problem; a Sun Tan City
       * review with an unreadable store code is one of OURS being dropped, and
       * that is the one worth chasing.
       */
      ["Unreadable on the page", result.unreadable],
      ["Sun Tan City reviews with no usable store code", result.unknownStore],
      ["Failures", upload.invalid],
    ]);

    /*
     * WHY A LISTING COUNTED NOTHING, in the manager's own words. Without this
     * the common first-run state — "everything imported, nothing counted,
     * because no salon has an anchor yet" — looks like a bug.
     */
    const findings = Array.isArray(upload.storeFindings) ? upload.storeFindings : [];
    if (findings.length > 0) {
      setState(describeFindings(findings), "warn");
    } else {
      setState("✓ Sync complete", "ok");
    }
    describeLastSync(upload);
  } finally {
    syncButton.textContent = "Sync Sun Tan City Reviews";
    syncButton.disabled = false;
  }
});

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
