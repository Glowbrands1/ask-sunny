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

### The reporting period, and the anchors

A review belongs to the week it was **first seen** by ASK Sunny, frozen at
insert by a trigger that refuses any later change. That is deliberate and it is
what the legacy process actually measures: opening each listing, finding the
reviewer last counted, and counting everything above them measures reviews that
*appeared* since the last count. Google's interface gives "7 hours ago" rather
than a timestamp, so a posting time is not reliably available at all.

`google_absolute_date` exists for when one becomes available. It is display and
audit only; filling it in later cannot move a review between weeks.

`public.google_review_week_anchors` answers the audit question the manual
process answered by hand — for each week and listing: how many reviews counted,
and which review **opened** and **closed** the counted run, by Google review id,
with the reviewer names kept as the human-readable label.

---

## 4. Schema

`supabase/migrations/20260917002000_google_reviews.sql`
`supabase/migrations/20260917002100_google_review_rollups.sql`

| Object | What it is |
| --- | --- |
| `google_review_locations` | The allowlist. Store code → salon, with website (nullable) and listing state |
| `google_reviews` | One row per review. Unique on `(source, external_review_id)` |
| `google_review_sync_runs` | One row per accepted sync. Counts and refusal codes only |
| `google_reviews_enriched` | A review with its salon name and district resolved through `salon_directory` |
| `google_review_week_anchors` | Per week and listing: the counted run and its opening/closing anchors |
| `google_review_location_directory` | The fifteen listings, whether or not they hold any review |
| `google_review_location_weeks` | Listing × week counts: all, qualifying, critical, unanswered, per-star, rating **sum** |
| `ingest_google_reviews(jsonb, text, text, timestamptz)` | The idempotent batch upsert |
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

### CORS is deliberately absent

The extension calls from its **background service worker** under a host
permission, which is not subject to CORS. Because the endpoint sends no
`Access-Control-Allow-Origin`, no ordinary web page — including the Google page
the content script runs in — can reach it with a token even if one leaked.

---

## 6. The dashboard

`/reviews` reads persisted reviews from Supabase and renders both halves:

**Summaries** — qualifying this week, all new this week, 1–2 star needing
attention, unanswered, average rating, reviews by rating, twelve-week trend
(stacked: qualifying vs 1–2 star), month to date, salon leaderboard, district
totals.

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

---

## 8. Known limitations

- **The fixtures cannot prove Google's markup still carries these signals.** The
  parser suite proves the *logic* against markup carrying the signals confirmed
  in DevTools; only a run against the live page proves the selectors still find
  them. That is why QA starts with one real location.
- **A sync captures what is rendered.** Google's feed lazy-loads; scroll to the
  reviews you want before pressing Sync. No automatic infinite scrolling in
  Phase 1, by design.
- **Auto Sync is a convenience, not real-time sync.** It rescans every two
  minutes while the page is open and visible. Always-on synchronisation is Phase
  2 and belongs on a server.
- **Weekly periods are keyed on first-seen**, so a backlog imported today all
  lands in today's week. Correct for "reviews gained since the last count",
  and worth knowing before comparing the first week against a manual count.
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
