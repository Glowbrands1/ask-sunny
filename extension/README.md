# ASK Sunny Review Sync — Brave extension

Reads the Sun Tan City reviews Google has **already rendered** on your Google
Business Profile Reviews page and files them in ASK Sunny.

---

## It never touches your Google sign-in

This is the constraint the whole design is built around, so it is first.

The extension **never asks for, collects, stores, transmits or handles** your
Google email, password, cookies, session tokens, OAuth tokens, MFA codes or any
other authentication material. There is no Google login form in it, no Google
credential field, and no code path that reads one — `document.cookie` does not
appear anywhere in this directory.

You sign in to Google in Brave exactly as you always do. The extension reads a
page you are already looking at. If Google signs you out, the popup says:

> Google Business Profile is not available. Please sign in to Google normally,
> then return to the Reviews page.

Sign in as normal, come back to the Reviews page, and press Sync again.

---

## Installing it in Brave

1. Open **`brave://extensions`**
2. Turn on **Developer mode** (top right)
3. Press **Load unpacked**
4. Choose this `extension/` folder
5. Pin **ASK Sunny Review Sync** to the toolbar

Brave is Chromium, so this is a standard Manifest V3 unpacked load. Nothing is
installed from a store and nothing auto-updates.

> **If you already had the Reviews page open**, reload it once after loading the
> extension. Content scripts are only injected on navigation, so the popup will
> otherwise say "Reload the Reviews page once."

---

## Setting it up (once)

Open the extension's **Options** page (from the popup, or via the Details button
on `brave://extensions`) and fill in two fields:

| Field | What to put in it |
| --- | --- |
| **ASK Sunny URL** | The **Vercel Preview** URL for the `feature/google-reviews-sync` deployment during Phase 1 QA. |
| **Review-sync token** | The token from `GOOGLE_REVIEW_SYNC_SECRET` on that deployment. |

Then press **Test connection**. It sends a real, empty sync — the same request
path a real sync uses — so a pass proves the URL, the token and the
deployment's own configuration, rather than proving that a test button works.

**Only `https://….vercel.app` addresses are accepted** (plus `http://localhost`
for local development). The token decides what ASK Sunny will accept, so the
extension will not send it to an address somebody pasted from an email.

**Do not point it at production** until the preview QA is signed off. The
extension ships with no default URL precisely so that cannot happen by accident.

---

## Using it

1. Open your Google Business Profile Reviews page
   (`https://business.google.com/reviews`)
2. Click the ASK Sunny Review Sync toolbar button
3. The popup reports what it can see:
   `✓ Reviews page detected — 8 Sun Tan City reviews on screen`
4. Press **Sync Sun Tan City Reviews**

It then reports:

| Line | What it means |
| --- | --- |
| Reviews discovered | Every review element on the page, after nested duplicates are collapsed |
| Sun Tan City reviews found | Of those, the ones belonging to the fifteen allowlisted store codes |
| New reviews imported | Created in ASK Sunny by this sync |
| Existing reviews updated | Already held, and something changed — usually a new owner response |
| Duplicates ignored | Already held, unchanged. **Syncing twice is safe and is meant to be.** |
| Counted into this reporting week | How many of them raise this week's number |
| Stored as history | How many do not, because their place in the feed could not be proven |
| Non-Sun-Tan-City reviews ignored | Buff City Soap and anything else on the same Google account. Expected, not a fault |
| Unreadable on the page | The parser could not read a rating or a name. Worth reporting |
| Sun Tan City reviews with no usable store code | **One of ours being dropped.** Worth reporting immediately |
| Failures | Records ASK Sunny refused as malformed |

### "Imported 40, counted 0" is a correct first sync

A salon counts reviews from its **reporting anchor** — the last review already
counted — upward. Until an anchor is set, a sync stores everything and counts
nothing, which is exactly what stops a year of backlog landing in the week you
imported it.

The popup says which listings counted nothing and why, and ASK Sunny&rsquo;s
Google Reviews page names every unanchored salon at the top. To start counting,
set each salon&rsquo;s anchor once — either the last review your old spreadsheet
counted, or "everything held so far is history, count from the next one". See
`docs/google-reviews-phase-1.md` §5b.

You will also see "counted nothing" if Google&rsquo;s review sort is not set to
**Newest**, or if the last counted review was not on the page you synced. Both
are safe: nothing is lost, and the next sync picks it up.

**Auto Sync** (optional) rescans every two minutes while the Reviews page is
open and visible. It does not scroll, paginate, refresh or open tabs, and it
stops when the tab is hidden. Phase 1 is the manual click; this is a small
convenience on top of it.

---

## Scrolling and what one sync captures

A sync reads **what is currently rendered on the page**. Google's reviews feed
loads more as you scroll, so to capture a backlog, scroll down until the reviews
you want are on screen and then press Sync. There is deliberately no automatic
infinite scrolling in Phase 1.

Because Google's own review id is the deduplication key, scrolling further and
syncing again only adds what is new.

---

## What the files do

| File | Role |
| --- | --- |
| `manifest.json` | Manifest V3. Permissions: `storage`, `activeTab`, and `https://*.vercel.app/*` |
| `parser.js` | **The only place Google's markup is understood.** Every selector, pattern and colour lives in `PARSER_CONFIG` at the top |
| `store-codes.js` | The fifteen allowlisted store codes, and the sort into send / ignore / needs-a-look |
| `content.js` | Runs on the Reviews page. Reads it, and holds **no token** |
| `background.js` | Holds the token and makes the one network request. The token never enters Google's page |
| `config.js` | Which ASK Sunny addresses the token may be sent to |
| `popup.*`, `options.*`, `ui.css` | The two screens |
| `fixtures.mjs`, `parser.test.mjs` | Fake-data DOM fixtures and the parser suite (`npm test`) |

### When Google changes its markup

Symptoms: the popup reports reviews discovered but zero Sun Tan City reviews
found, or a rating comes back wrong.

Everything to change is in **`PARSER_CONFIG` in `parser.js`**. Nothing else in
the extension, the API or the dashboard needs to move. Bump `PARSER_VERSION` in
the same edit — it is stored on every review, and it is what says which records
a broken parser wrote.

The parser reads each field by a ladder of strategies, most durable first:
semantic attributes (`data-lid`, `aria-label`, `alt`), then rendered state (a
filled star computes to `rgb(251, 188, 4)`), then structure and text. **There is
not one minified Google class name in the file**, because those rotate.

---

## What leaves your machine

Only business review facts, and only for the fifteen allowlisted stores: the
Google review id, the store code, the reviewer's display name as Google shows
it, the rating, the review text, the relative date, and the owner response if
there is one.

Not sent: the business name of any other company, the parser's diagnostics, or
anything about your Google session.

Stored on your machine in the extension's own storage: the ASK Sunny URL, the
token, the Auto Sync switch, and the **counts** from the last sync. No review
content is ever stored by the extension.
