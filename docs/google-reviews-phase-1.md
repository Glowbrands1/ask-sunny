# Google Reviews — Phase 1

Real Google review data from all fifteen Sun Tan City locations, feeding the
ASK Sunny Google Reviews dashboard.

```
Google Business Profile Reviews page (authorized user, already signed in, Brave)
  → ASK Sunny Review Sync extension (Manifest V3)
      content script reads the rendered page   — holds no token
      background worker posts the records      — holds the token
  → POST /api/reviews/ingest                   — machine credential, allowlist, validation
  → public.ingest_google_reviews(...)          — one transaction, idempotent
  → Supabase
  → /reviews                                   — summaries, the review feed, and the drill-down between them
```

---

## 1. Why a browser extension

Google Business Profile API approval could not be obtained, and
`docs/architecture-constraints.md` §1 already settles that no required step may
depend on getting access from anybody. An authorized company account does have
`business.google.com/reviews` open in Brave, and the reviews are rendered there.

So the extension reads what is already on the screen. It is not an
authentication workaround: there is no Google credential anywhere in this
system, no login form, no cookie read, no session token, and no code path that
could add one. If the Google session expires, the extension says so and asks the
person to sign in normally.

Phase 2 can replace the transport without touching anything downstream — the
parser, the endpoint, the schema and the dashboard are independent of how the
records arrive.

---

## 2. A Google store code is not an ASK Sunny salon number

**Read this before writing any code that touches either.**

The two numbering systems overlap *without agreeing*:

| Google store code | is | ASK Sunny salon |
| --- | --- | --- |
| 306 | KS Manhattan | 0462 |
| 307 | KS Shawnee Mission Pkwy | 0463 |
| 314 | KS Lawrence | 0468 |

and meanwhile ASK Sunny's `0306` is MO Kansas City Wornall (Google **140**),
`0307` is NE Grand Island (Google **141**), and `0314` is NE Omaha 144th and
Center (Google **148**).

So `` `0${storeCode}` `` compiles, runs, and files three salons' reviews against
three different salons with nothing on the dashboard looking wrong. There is no
transformation between the systems and there never will be — only the mapping
table `public.google_review_locations`, whose `salon_id` is a real foreign key.

The full mapping:

| Store code | Salon | ASK Sunny salon number | District |
| --- | --- | --- | --- |
| 140 | MO Kansas City Wornall | 0306 | Patterson, Madeline |
| 141 | NE Grand Island | 0307 | Dugan, Rachael |
| 143 | NE Kearney | 0309 | Dugan, Rachael |
| 144 | NE Lincoln 27th Street | 0310 | Dugan, Rachael |
| 145 | NE Lincoln O Street | 0311 | Dugan, Rachael |
| 146 | NE Lincoln Pine Lake | 0312 | Dugan, Rachael |
| 147 | NE Omaha 132nd and Maple | 0313 | Cotton, Sarah |
| 148 | NE Omaha 144th and Center | 0314 | Cotton, Sarah |
| 231 | MO Kansas City Liberty | 0394 | Patterson, Madeline |
| 254 | NE Omaha Pacific | 0410 | Cotton, Sarah |
| 306 | KS Manhattan | 0462 | Patterson, Madeline |
| 307 | KS Shawnee Mission Pkwy | 0463 | Patterson, Madeline |
| 314 | KS Lawrence | 0468 | Patterson, Madeline |
| 373 | KS Overland Park | 0476 | Patterson, Madeline |
| 409 | MO St Joseph | 0495 | Cotton, Sarah |

All fifteen resolve cleanly into the **existing** district structure — three
districts, named after the managers who run them, read from
`salon_period_attributes` through `public.salon_directory`. No second district
taxonomy was created, and the district is joined at read time rather than copied
onto a review row, so it cannot drift when a salon changes manager.

### Verification-required listings

Google currently shows a verification problem on **314 KS Lawrence** and
**140 MO Kansas City Wornall**. Both are kept in the allowlist, the roster, the
leaderboard and every total — that is a fact about the Google *listing*, not
about the salon. It is recorded as `listing_state = 'verification_required'` and
the dashboard says so, so a quiet week at either one is not silently read as the
salon underperforming.

---

## 3. The reporting rule, in the database

Only **3-, 4- and 5-star** reviews count toward the official weekly Google
Review total. 1- and 2-star reviews are still stored, still shown, still worked
in the response queue — and never raise that number.

`google_reviews.eligible_for_weekly_count` is a **generated column**
(`rating >= 3`), so no query can disagree with the rule and no ingestion path
can forget it.

### Deduplication

`unique (source, external_review_id)` — Google's own `data-lid`, never the
reviewer's name. Two customers called "Sarah M." at one salon in one week are
two reviews here and one in the legacy process.

### The reporting period, and the anchor that decides it

**A review counts only where it sat above its listing's anchor.** The anchor is
`google_review_locations.counted_through_external_review_id` — the newest review
already counted, held as a **Google review id**, never a reviewer name.

When a sync arrives, the server finds the anchor's **position** in the submitted
feed for that listing. Everything above it is new and joins the open period; the
anchor itself and everything below it do not. The anchor then advances to the
top of the page, so the next sync starts from there.

**If the boundary cannot be proven, nothing is counted.** Four cases, all of
which store the reviews and assign them to no period:

| Finding | What happened | What to do |
| --- | --- | --- |
| `no_anchor` | First sync of a listing. Nothing above an unknown boundary is new. | Set the anchor — see §5b |
| `anchor_not_in_feed` | The feed did not reach back far enough, or the anchored review was deleted. | Scroll further and sync again |
| `feed_order_unreliable` | The submitted order disagrees with the relative dates — a page sorted by rating. | Set Google's sort back to Newest |
| `feed_position_missing` | The caller sent no feed order. | Update the extension |

That is the whole safety property: **`historical` is the default**, and a review
is only counted when the boundary above it is known. An import of a year's
backlog raises this week's number by zero.

`first_seen_at` and `first_seen_week` are **ingestion metadata only**. The column
was called `reporting_week_start` and *did* decide the period; it was renamed
precisely because a column named for reporting that reporting must not read is a
trap with a countdown on it.

`google_estimated_at` is an approximate posting time derived from Google's own
relative text ("7 hours ago" → seven hours before the read). It orders a backlog
on screen and checks that a feed really is newest-first. **It is never a period
key** — Google's buckets are too coarse — and the original wording is always
kept verbatim beside it.

`public.google_review_period_summary` answers the audit question the manual
process answered by hand: per period and listing, how many counted and which
review **opened** and **closed** the run, by Google review id, with the reviewer
names kept as the human-readable label. Closing a period with
`google_review_close_period` freezes those anchors into
`google_review_period_anchors`, so they survive the live anchor moving on.

---

## 4. Schema

`supabase/migrations/20260917002000_google_reviews.sql`
`supabase/migrations/20260917002100_google_review_rollups.sql`
`supabase/migrations/20260917002200_google_review_reporting_periods.sql`

| Object | What it is |
| --- | --- |
| `google_review_periods` | The weekly reporting calendar, Sunday to Saturday |
| `google_review_period_anchors` | Per listing per closed period: the frozen ending anchor |
| `google_review_locations` | The allowlist. Store code → salon, the reporting anchor, website (nullable), listing state |
| `google_reviews` | One row per review. Unique on `(source, external_review_id)` |
| `google_review_sync_runs` | One row per accepted sync. Counts and refusal codes only |
| `google_reviews_enriched` | A review with its salon, district and reporting period resolved |
| `google_review_period_summary` | Per period and listing: the counted run and its opening/closing anchors |
| `google_review_location_directory` | The fifteen listings, their anchor and their backlog size |
| `google_review_location_periods` | Listing × **period** counts, over assigned reviews only |
| `google_review_location_backlog` | Listing counts over reviews assigned to **no** period |
| `ingest_google_reviews(jsonb, text, text, timestamptz, jsonb)` | The idempotent batch upsert |
| `google_review_set_anchor(...)` / `google_review_baseline_anchor(...)` | The manual anchor process |
| `google_review_close_period(uuid)` | Freezes a period's ending anchors |
| `google_review_current_period(timestamptz)` | Get-or-create the open week |
| `google_review_estimate_from_relative(text, timestamptz)` | Google's wording as an approximate instant |
| `google_review_week_start(timestamptz, text)` | The Sunday of the business week |

RLS is enabled and **forced** on all three tables with **no policy**, and
`anon`/`authenticated` are revoked on the tables and the views. That is the same
posture `20260916001000_reporting_tables_server_only.sql` records: every read
goes through `getSupabaseAdmin()` inside a `server-only` module, so the
publishable key in the browser bundle cannot reach a review through PostgREST.

The views publish **sums, not averages**, because every district and chain
figure is a re-aggregation and an average of averages is wrong the moment two
listings have different volumes.

---

## 5. The endpoint

`POST /api/reviews/ingest`, authenticated with `GOOGLE_REVIEW_SYNC_SECRET` —
a machine credential of the same construction as `REPORTING_INGEST_SECRET`
(`docs/architecture-constraints.md` §2), reusing its constant-time comparison,
its `id:secret` rotation format, its minimum strength and its failure-only rate
limit.

**A separate variable from the reporting one**, because the two must be
revocable independently: a token typed into an Options page on a laptop is a
different exposure from a scheduled pipeline's, and sharing one value would mean
pulling the extension's token takes report ingestion down with it.

`GET /api/reviews/ingest` reports readiness — which variables are configured (by
name, never by value), the allowlisted store codes, and the batch limit.

Check order, which is the security model:

1. Supabase configured — a runtime that cannot store refuses rather than accepts
2. The credential: configuration → rate limit → constant-time comparison,
   **before the body is read**
3. Payload shape, bounded at 500 reviews per sync
4. The store-code allowlist — here, and again in the database

Response: `received`, `created`, `updated`, `duplicates`, `ignoredNonStc`,
`invalid`, `problems[]` (refusal **codes** only — never a reviewer name, never
review text).

## 5b. Setting an anchor

`POST /api/reviews/anchor`, same machine credential. Two shapes per listing:

```jsonc
{ "anchors": [
  // The old spreadsheet's last-counted review. Everything held above it, on the
  // page where it was seen, joins the open period.
  { "storeCode": "306", "externalReviewId": "0389…" },

  // "Everything we hold is history; count from the next one." Assigns nothing,
  // and is the safe way to start a listing from scratch.
  { "storeCode": "143", "fromNewestHeld": true }
]}
```

Each listing reports its own outcome, so anchoring fourteen and being told the
fifteenth named a review we do not hold is a usable answer.

**Why position and not time.** Reviews already held are promoted only when they
were seen in the *same sync run* as the anchor, at a smaller feed position.
Google's relative text cannot separate two reviews from the same Tuesday, and a
timestamp comparison would miscount in both directions; anything not comparable
is left historical and reported.

**Moving an anchor cannot uncount anything.** `reporting_period_id` is write-once
once set, enforced by a trigger.

**An existing anchor is never replaced silently.** A listing that already has one
is refused with `anchor_exists`, and its current anchor is reported back, unless
the request carries `"replace": true` for that listing. The refusal lives in
`applyAnchors`, so it holds for every caller — a stale browser tab, the bulk
button, and the machine credential alike.

### CORS is deliberately absent

The extension calls from its **background service worker** under a host
permission, which is not subject to CORS. Because the endpoint sends no
`Access-Control-Allow-Origin`, no ordinary web page — including the Google page
the content script runs in — can reach it with a token even if one leaked.

---

## 5c. Setting a baseline from ASK Sunny

`/reviews/setup` — the screen that makes 5b unnecessary for an operator. Nobody
should need Postman, curl, SQL or a Google review id to tell ASK Sunny where a
salon starts counting, and after the first sync that is the only thing standing
between a correct system and a working one.

**Gated on `manage_integrations`**, checked by `requirePagePermission` on the
server before a row is read, with `PermissionGate` behind it for the mode where
page guards do not enforce. That is Administration only — `admin`, `owner`,
`developer`. `view_google_reviews`, which most of the org chart holds, reads the
dashboard and gets nowhere near this screen.

It posts to **`POST /api/admin/reviews/anchor`**, a session-authenticated twin of
5b's machine endpoint. Both end in `applyAnchors`, so the store-code allowlist,
the replace refusal and the promotion rule are stated once. The audit label in
`counted_through_set_by` is `admin:<email>`, taken from the verified session —
there is no body field that can put somebody else's name on a change.

### What it shows, per listing

Name · Google store code · **ASK Sunny salon number** · district · whether
counting is active · the anchor's reviewer and Google's wording for its date ·
how many reviews are held and counted nowhere. This is the one screen where the
two numbering systems appear side by side, which is how somebody confirms that
Google's 306 is salon 0462 before anchoring it.

### The two options

1. **Start counting after the newest review currently held** (`fromNewestHeld`).
   Everything imported stays historical; counting begins with the next review
   received. Confirmed in a dialog.
2. **Choose the last review already counted.** The held reviews, newest first in
   Google's own feed order, each showing reviewer, rating, a comment preview,
   Google's relative date and whether it has been responded to — and how many
   reviews picking it would promote. The person picks a face and a sentence; the
   `external_review_id` is submitted internally and **never rendered**, not in
   text, not in a title, not in a data attribute.

### The bulk run

**Baseline all unconfigured locations** sends `fromNewestHeld` and no `replace`
for exactly the listings with no anchor that hold at least one review. The
confirmation names them; listings that already count are excluded from the list
and refused by the server regardless. Results come back per location.

### Changing one that is already set

A different act, deliberately. The panel shows the current anchor, states what
moving it does and what it cannot undo, and holds both buttons shut behind a
checkbox before it will send `replace: true`.

### From the dashboard

`No anchor — counting nothing` on the leaderboard is a link to that listing's
setup, and the notice above the tiles links each unanchored salon by name — for
somebody who holds `manage_integrations`. Everybody else sees the same sentence
as plain text, because the fact explains the zero and the link would only bounce
them. Once anchored the row reads `Tracking active · counting after <reviewer>`.
No dashboard control can move an anchor: every one of these is a `GET` to a page
that reads.

---

## 6. The dashboard

`/reviews` reads persisted reviews from Supabase and renders both halves:

**Summaries** — qualifying this week, all new this week, 1–2 star needing
attention, unanswered, average rating, reviews by rating, twelve-week trend
(stacked: qualifying vs 1–2 star), month to date, **historical (counted
nowhere)**, salon leaderboard, district totals.

Every weekly figure reads `reporting_period_id`. The rollup view joins the
periods table, so a historical review is *absent from the input* rather than
filtered out of the output — a backlog cannot reach a weekly number even if a
future query forgets to exclude it. Month to date is stated over **the reporting
weeks that began this month**, because periods straddle month boundaries and
"counted between the 1st and today" is not a figure this model can produce
honestly.

The backlog keeps its own tile, its own filter (`?assignment=historical`) and
its own drill-down, and its unanswered reviews stay in the response queue —
those are real customers waiting, whatever week they count in.

**The records** — reviewer name, stars, comment (or "Rating only — no written
comment."), salon, store code, district, relative date, response status, owner
response, and whether it counts toward the weekly total. Clicking one opens a
detail panel with first/last seen, the reporting period, the Google review id
and the source.

**Drill-down is filtering.** Every figure is a link into the same feed carrying
the same filter vocabulary — `?week=current&qualifying=yes` behind "Qualifying
this week", `?store=306&week=current` behind a leaderboard row. There is no
second query written to resemble the first, so a number and the list behind it
cannot disagree. It also means a filtered view is a link somebody can send.

The page does **not** consult demo mode. It falls back to the seeded screen only
when Supabase is unconfigured — a configured deployment with nothing ingested
shows honest zeroes and says how to sync, because falling back to invented
figures there is exactly how a demo number gets quoted as a real one.

### Two things the seeded screen had that the live one does not

**A weekly goal per salon.** It was invented; nothing in Supabase holds one. A
progress bar against a number nobody agreed to is a figure a manager would quote
in a meeting. When the business sets goals they arrive as data and the meter
comes back with them.

**Google's lifetime review count.** The Reviews page does not expose a
per-listing lifetime total this parser can read, so the leaderboard's "Held"
column means *reviews ASK Sunny holds* and is labelled that way.

---

## 7. The parser

`extension/parser.js`. Every selector, pattern and colour is in `PARSER_CONFIG`
at the top of the file, so a Google markup change is one object to edit.

Each field is read by a ladder, most durable first:

1. **Semantic attributes** — `data-lid`, `aria-label`, `role`, `alt`. They exist
   for assistive technology, so Google can restyle freely and cannot quietly
   drop them.
2. **Rendered state** — a filled star computes to `rgb(251, 188, 4)` (#FBBC04),
   confirmed in Brave DevTools against real reviews. This survives a class
   rename because it is what the class *does*.
3. **Structure and text** — glyphs, label phrases, element relationships.
4. **Minified class names: never.** There is not one in the file.

Nested elements sharing one `data-lid` are collapsed to the **outermost**
element, because Google's own markup repeats the attribute and a naive pass
would post every review twice.

Each review records which strategy answered (`strategies`), which is what says
which rung broke when a field starts coming back wrong. `PARSER_VERSION` is
stored on every review.

### 7a. Which listing owns a review (rewritten after live QA)

The first live run reported *"none of the 8 reviews on screen belong to the
fifteen Sun Tan City stores"* on a page that visibly showed KS Manhattan (306)
and NE Lincoln 27th Street (144). Every fixture passed, because every fixture
put a one-leaf `Store code: 306` exactly one element above the review. Four
things about the real page were different, and all four are now closed:

| What the live page does | What the old pass did | What it does now |
| --- | --- | --- |
| Nests a review a dozen wrappers below its header | Gave up after 8 ancestors → no code at all | Walks up to 30, and stops at the first ancestor holding a header |
| Splits the code across a label and a value element | Read leaf text only, so no leaf carried both halves | A marker is an element whose **whole text** is short and contains the labelled code |
| Carries an address and a phone number ending in `-1417` | Took the first candidate matching *any* pattern, so a ZIP+4 could become the store code | Labelled codes win across the whole document; the bare `· 306` chip form is reached only on a page with no `Store code:` anywhere |
| Can put headers and review runs side by side as siblings | Stopped at the shared container and gave every review the first code in it | Ownership is decided by document order — a review belongs to the **last header above it** |

`findStoreCodeMarkers` returns the innermost element stating each code, in
document order; `extractListing` walks up from the review to the first ancestor
containing any marker and picks the owner from there. The business name is read
from a bounded **header scope** around the marker rather than from the review
card, so a customer who writes "Sun Tan City" in a review of another shop cannot
turn that shop into one of ours.

**The store code is a string and is never transformed.** `normaliseStoreCode`
trims and shape-checks; it does not pad, parse as a number, or touch leading
zeroes. Google's `306` stays `"306"` and is never compared against ASK Sunny's
salon `0306`, which is a different shop (§2).

### 7b. What makes a review readable (rewritten after the second live run)

The store-code fix shipped and the next live run reported **`Reviews
discovered: 3 · Parsed store codes: none · Unreadable on the page: 3`** — three
real Lincoln reviews (145 O Street, 144 27th Street, 146 Pine Lake) discovered
and discarded *before* a store code was ever looked for. The association work
was right; the readability gate was rejecting real reviews.

**The failure was the rating rung, and the cause was SVG.** Google draws each
star as `<svg class="NhWcyb"><path fill="#FBBC04"/></svg>`. Two things about
that the old ladder could not see:

- The glyph rung filtered candidates on `typeof node.className === "string"`.
  On an SVG element `className` is an `SVGAnimatedString`, **not** a string, so
  every star on the page was skipped by the filter that was meant to find them.
- The paint rung then read `color`. An SVG star is painted by `fill`, and by a
  `fill` **attribute** rather than a style.

So no rung answered, `rating` came back `null`, and a review with no readable
rating is refused — correctly, since a guessed rating moves the weekly count.

**The rating ladder now asks about paint and nothing else at the rung that
matters.** Nothing about a live star element names a star: the class is
minified, there is no `aria-label`, and there is no text. The one thing it still
states is Google's own yellow. `paintedStarSlots` finds every element painted
`#FBBC04` (reading computed `color`, computed `fill`, inline `color`, inline
`fill` and the `fill` attribute), grows each one upward into the outermost
ancestor that still holds only it — so a `<path>` inside an `<svg>` inside a
wrapper counts as one star, not three — and keeps only the first run of slots
sharing a parent, so a card carrying the business's own aggregate rating does
not add a sixth star.

Two other rungs were widened at the same time: a written rating is now read from
`aria-label`, `alt`, `title` or `aria-valuetext` and matches `4 stars`,
`Rated 4.0`, `4 out of 5 stars` and `4/5`; and a reviewer name is now read from
a small element as well as a leaf, because Google splits a name across spans
inside a link (`<a><span>Abbi</span> <span>Tuma</span></a>`) with no avatar
`img` and no `role="heading"` to fall back on.

**Google's rating-only sentence is not the customer's comment.** The live page
prints *"The user didn't write a review, and has left just a rating."* exactly
where a comment would go, and it is long enough to win the longest-text contest
in `extractReviewText`. It is now recognised as interface copy: the review
stores `reviewText: null`, which the dashboard already renders as "Rating only —
no written comment." It is also excluded from the reviewer-name ladder.

#### What a review must have

Exactly what `google_reviews` refuses to store without, and not one field more:

| Required | Why |
| --- | --- |
| `external_review_id` | The dedup key and the unique constraint |
| `rating` 1–5 | `rating smallint not null check (rating between 1 and 5)`, and `eligible_for_weekly_count` is generated from it |
| `reviewer_name` | `text not null check (length(btrim(reviewer_name)) > 0)` |

Everything else is optional, and this is where the live failure was:
`review_text` is nullable and **null is a real answer**; `google_relative_date_text`
is nullable; `has_owner_response` defaults to `false`, which is the honest
reading of "no reply was found". A **store code** is required to ingest but is
not decided here — a review with no code is reported as *unresolved*, which is a
different finding from *unreadable*, and the popup keeps them apart.

The reviewer name is required because the record cannot exist without it, not
because the parser prefers it. Sending `null` would trade a visible "unreadable"
for a silent rejection at the API, which is worse. It is the one place the
parser's gate is wider than "id and rating", and the schema is the reason.

One card can no longer take the page down with it: extraction runs in a
`try`/`catch` per review and a throw is recorded as `extraction_failed` rather
than losing every review after it.

### 7c. QA diagnostics in the popup

When reviews are found and none match the fifteen, the popup now shows its
working instead of one misleading sentence:

```
Reviews discovered      8
Parsed store codes      144, 236, 306
Allowed STC matches     144, 306
Store code unresolved   0 reviews
Unreadable on the page  2
— missing rating        2
Parser version          2026.09.17-3
```

The breakdown by reason is the line the second QA round needed and did not have.
"Unreadable: 3" is true and useless; "missing rating: 3" names the extraction
rung to go and look at. The reason codes are `missing_review_id`,
`missing_rating`, `invalid_rating`, `missing_reviewer` and `extraction_failed`.
The panel also appears when *some* reviews matched and others were lost, because
a page where two of ten could not be read is not a clean page and `✓ 8 reviews
on screen` would bury that.

And where nothing could be placed at all it says so in those words — *"Store
code unresolved: 8 of 8 reviews … this is a parser problem, not a Sun Tan City
one"* — because "not Sun Tan City" is the normal case and a manager would
believe it.

**Store codes and counts only.** No review id, no reviewer name, no comment, no
business name reaches this panel, and a test asserts it against the source.

---

## 8. Known limitations

- **The fixtures cannot prove Google's markup still carries these signals.** The
  parser suite proves the *logic* against markup carrying the signals confirmed
  in DevTools; only a run against the live page proves the selectors still find
  them. That is why QA starts with one real location — and §7a is what that
  first run cost. The suite now carries live-shaped fixtures (deep nesting,
  a split store code, sibling headers, ZIP+4 addresses) alongside the original
  ones, but the limitation stands: a fixture is a hypothesis about the page.
- **A sync captures what is rendered.** Google's feed lazy-loads; scroll to the
  reviews you want before pressing Sync. No automatic infinite scrolling in
  Phase 1, by design.
- **Auto Sync is a convenience, not real-time sync.** It rescans every two
  minutes while the page is open and visible. Always-on synchronisation is Phase
  2 and belongs on a server.
- **Nothing counts until a listing is anchored.** That is the design, not a
  gap — but it means the first sync of each salon shows a large "imported" and
  a zero "counted", and somebody has to set fifteen anchors before Monday's
  number is live. The dashboard names every unanchored listing at the top of
  the page so this cannot be missed, and `/reviews/setup` (§5c) sets all
  fifteen without a terminal.
- **A backlog imported before its anchor was set stays historical** unless the
  anchor names a review from the same sync run. Re-syncing the page and then
  anchoring, in that order, is the reliable sequence.
- **The feed-order check depends on Google's relative dates.** A page of
  reviews whose dates are all unreadable would pass the check on silence. In
  practice Google always renders them.
- **No weekly goal and no Google lifetime count**, per §6.
- **The rate limiter is per server instance**, as `lib/api/rate-limit.ts`
  already documents — a guard against a runaway client, not a distributed
  attacker.

---

## 9. Security review

| Concern | Position |
| --- | --- |
| Google credentials | Never requested, read, stored or transmitted. No login form. `document.cookie` appears nowhere in `extension/` |
| Token exposure to Google's page | The token lives in the background service worker. The content script never receives it |
| Supabase credentials in the client | None. The extension knows one URL and one token; it has no database URL and no Supabase key |
| Token destination | Restricted to `https://*.vercel.app` (plus loopback for local dev) in both the manifest and `config.js` |
| Credential strength | Minimum 24 characters, enforced against the configuration; a weaker value is dropped and the endpoint refuses everybody |
| Credential comparison | SHA-256 digests, branchless XOR, every entry checked — no prefix oracle and no position leak |
| Rate limiting | Failure-only, 10 per 10 minutes per caller; a success clears the record |
| Browser read access to reviews | Revoked. RLS forced with no policy on every new table and view |
| Logging | No reviewer name, no review text, no owner response, and no credential value is ever logged. `google_review_sync_runs` has no column that could hold one |
| Refusal messages | One answer for every authentication failure, so a prober is not told which half to fix |
| Committed data | Fixtures use invented names and `FIXTURE-…` ids. The real `data-lid` observed during DOM discovery is deliberately not committed |
| Who may move a reporting boundary | `manage_integrations` — Administration only. Checked on the server by `authorizeRequest` before the privileged Supabase client is touched, and by `requirePagePermission` before the setup screen reads a row |
| Browser holding a machine token | Never. The setup screen posts to a session-authenticated route rather than being handed the review-sync credential |
| Silent anchor replacement | Refused in `applyAnchors` without an explicit `replace: true` per listing, so the bulk baseline and a stale tab both fail closed |
| Google review ids in the UI | Never rendered on the dashboard or the setup screen — asserted against the whole markup, not just the visible text |
