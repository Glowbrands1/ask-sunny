/**
 * THE BACKGROUND SERVICE WORKER — the only place the ASK Sunny token exists,
 * and the only place that talks to the network.
 *
 * ============================================================================
 * WHY THE UPLOAD HAPPENS HERE AND NOT IN THE CONTENT SCRIPT
 * ============================================================================
 *
 * TWO REASONS, AND THE FIRST IS THE ONE THAT MATTERS.
 *
 *   THE TOKEN NEVER ENTERS GOOGLE'S PAGE. A content script shares a document
 *   with whatever else is running there. Putting a credential in it — even in
 *   an isolated world — puts it one bug away from a page this project does not
 *   control. Here it is read from `chrome.storage.local`, attached to one
 *   request, and never sent anywhere else.
 *
 *   NO CORS IS INVOLVED. A service-worker `fetch` under a declared host
 *   permission is not a cross-origin request from a page, so the ASK Sunny API
 *   needs no `Access-Control-Allow-Origin` — and because it has none, no
 *   ordinary web page can reach that endpoint with a token even if one leaked.
 *
 * ============================================================================
 * WHAT IS STORED, AND WHERE
 * ============================================================================
 *
 * `chrome.storage.local`, on this machine, holding: the ASK Sunny base URL, the
 * sync token, the Auto Sync switch and the last sync's COUNTS.
 *
 * NO REVIEW CONTENT IS EVER STORED BY THE EXTENSION. The last-sync record holds
 * numbers and a timestamp. Reviews pass through memory on their way to the API
 * and are not kept.
 *
 * NOTHING GOOGLE-RELATED IS STORED, READ OR TOUCHED — no cookie, no token, no
 * session. The extension does not know Google has accounts.
 */

import { endpointFor, isAllowedBaseUrl } from "./config.js";

const DEFAULTS = {
  /*
   * NO DEFAULT PRODUCTION URL, ON PURPOSE. Phase 1 QA runs against a Vercel
   * Preview, and an extension that silently defaults to production is one
   * mis-click away from filing test data into the live dashboard. The Options
   * page refuses to sync until somebody has said which deployment they mean.
   */
  baseUrl: "",
  syncToken: "",
  autoSync: false,
  lastSync: null,
};

async function settings() {
  return chrome.storage.local.get(DEFAULTS);
}

/**
 * Posts one batch and returns a result the popup can render.
 *
 * FAILURES ARE DESCRIBED, NEVER GUESSED AT. A 401 means the token; a 503 means
 * the deployment is not configured; a network error means the URL or the
 * connection. Collapsing them into "sync failed" is what turns a two-minute fix
 * into a support call.
 */
async function upload({ reviews, parserVersion }) {
  const { baseUrl, syncToken } = await settings();

  if (!baseUrl || !isAllowedBaseUrl(baseUrl)) {
    return {
      ok: false,
      code: "no_base_url",
      message:
        "Set the ASK Sunny URL in the extension's Options page first. It must be an https Vercel URL.",
    };
  }
  if (!syncToken) {
    return {
      ok: false,
      code: "no_token",
      message: "Paste the ASK Sunny review-sync token in the extension's Options page first.",
    };
  }

  let response;
  try {
    response = await fetch(endpointFor(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        /* A header, never a query string: a secret in a URL is written to every log. */
        Authorization: `Bearer ${syncToken}`,
      },
      body: JSON.stringify({ parserVersion, reviews }),
    });
  } catch (error) {
    return {
      ok: false,
      code: "network",
      message: `ASK Sunny could not be reached at ${baseUrl}. Check the URL and your connection.`,
      detail: String(error),
    };
  }

  const body = await response.json().catch(() => null);

  if (response.status === 401) {
    return {
      ok: false,
      code: "unauthorized",
      message: "ASK Sunny refused this token. Check the token in Options, or ask for a new one.",
    };
  }
  if (response.status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      message: body?.reason ?? "Too many attempts. Wait a few minutes and try again.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "server",
      message:
        body?.reason ?? body?.error ?? `ASK Sunny answered ${response.status}. Nothing was stored.`,
    };
  }

  const result = {
    ok: true,
    at: new Date().toISOString(),
    received: body?.received ?? 0,
    created: body?.created ?? 0,
    updated: body?.updated ?? 0,
    duplicates: body?.duplicates ?? 0,
    ignoredNonStc: body?.ignoredNonStc ?? 0,
    invalid: body?.invalid ?? 0,
    /*
     * THE TWO FIGURES THAT SAY WHETHER A NUMBER MOVED. `created` counts rows;
     * these count what the business will report. A first import shows a large
     * `created` and a `countedIntoPeriod` of zero — which is correct, and is
     * the thing a manager has to be able to see rather than infer.
     */
    countedIntoPeriod: body?.countedIntoPeriod ?? 0,
    storedAsHistorical: body?.storedAsHistorical ?? 0,
    storeFindings: Array.isArray(body?.storeFindings) ? body.storeFindings : [],
    credentialId: body?.credentialId ?? null,
  };

  /* Counts and a timestamp. Never a review. */
  await chrome.storage.local.set({ lastSync: result });
  return result;
}

/**
 * Proves the URL and token work without filing anything.
 *
 * An EMPTY batch is a complete, valid request: the route authenticates it,
 * finds nothing to store, and answers with zeroes. So "Test connection" is the
 * real request path rather than a separate code path that could pass while the
 * real one fails.
 */
async function testConnection() {
  return upload({ reviews: [], parserVersion: "connection-test" });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_SUNNY_UPLOAD") {
    upload({ reviews: message.reviews ?? [], parserVersion: message.parserVersion })
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, code: "unexpected", message: String(error) }),
      );
    return true;
  }

  if (message?.type === "ASK_SUNNY_TEST_CONNECTION") {
    testConnection()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, code: "unexpected", message: String(error) }),
      );
    return true;
  }

  if (message?.type === "ASK_SUNNY_STATE") {
    settings()
      .then((state) =>
        sendResponse({
          /* The token itself never leaves storage — only whether one is set. */
          baseUrl: state.baseUrl,
          hasToken: Boolean(state.syncToken),
          autoSync: state.autoSync,
          lastSync: state.lastSync,
        }),
      )
      .catch(() => sendResponse({ baseUrl: "", hasToken: false, autoSync: false, lastSync: null }));
    return true;
  }

  return false;
});
