/**
 * THE SETUP SCREEN — an ASK Sunny URL and a sync token, and nothing else.
 *
 * THERE IS NO GOOGLE FIELD ON THIS PAGE AND THERE NEVER WILL BE. No email, no
 * password, no "connect your Google account". The person signs in to Google in
 * Brave exactly as they always do; this extension reads a page they are already
 * looking at.
 *
 * THE TOKEN IS WRITE-ONLY IN THE UI. Once saved it is never read back into the
 * field — the input shows a placeholder saying one is stored, and the only
 * operations are replace and clear. A settings screen that redisplays a
 * credential is a settings screen that leaks it to whoever walks past.
 */

import { baseUrlProblem, isAllowedBaseUrl } from "./config.js";

const form = document.getElementById("setup");
const baseUrlInput = document.getElementById("base-url");
const tokenInput = document.getElementById("sync-token");
const status = document.getElementById("status");

function say(message, tone = "neutral") {
  status.textContent = message;
  status.dataset.tone = tone;
}

async function load() {
  const stored = await chrome.storage.local.get({ baseUrl: "", syncToken: "" });
  baseUrlInput.value = stored.baseUrl;
  tokenInput.value = "";
  tokenInput.placeholder = stored.syncToken
    ? "A token is saved. Paste a new one to replace it."
    : "Paste the token you were given";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const baseUrl = baseUrlInput.value.trim();
  const problem = baseUrlProblem(baseUrl);
  if (problem) {
    say(problem, "warn");
    return;
  }

  const update = { baseUrl };

  /*
   * AN EMPTY TOKEN FIELD MEANS "LEAVE IT ALONE", not "delete it". Saving a URL
   * change should not silently unauthenticate the extension, and Clear token is
   * the deliberate way to remove one.
   */
  const token = tokenInput.value.trim();
  if (token.length > 0) {
    if (token.length < 24) {
      say("That token is too short to be one of ours. Check what you pasted.", "warn");
      return;
    }
    update.syncToken = token;
  }

  await chrome.storage.local.set(update);
  tokenInput.value = "";
  await load();
  say("Saved.", "ok");
});

document.getElementById("test").addEventListener("click", async () => {
  const baseUrl = baseUrlInput.value.trim();
  if (!isAllowedBaseUrl(baseUrl)) {
    say(baseUrlProblem(baseUrl) ?? "Enter a valid ASK Sunny URL first.", "warn");
    return;
  }

  say("Testing…");
  /*
   * THE REAL REQUEST PATH, WITH AN EMPTY BATCH. The route authenticates it,
   * finds nothing to store and answers with zeroes — so a passing test proves
   * the URL, the token and the deployment's own configuration, rather than
   * proving that a separate test code path works.
   */
  const result = await chrome.runtime.sendMessage({ type: "ASK_SUNNY_TEST_CONNECTION" });

  if (result?.ok) {
    say(
      `Connected. ASK Sunny accepted the token${
        result.credentialId ? ` as “${result.credentialId}”` : ""
      }.`,
      "ok",
    );
    return;
  }
  say(result?.message ?? "The connection test failed.", "warn");
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.set({ syncToken: "" });
  await load();
  say("Token cleared. The extension cannot sync until a new one is saved.", "ok");
});

void load();
