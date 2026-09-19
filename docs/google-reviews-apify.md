# Google Reviews — Phase 2: the server-side Apify source

Reviews that keep arriving with the laptop shut.

```
Vercel Cron (or the admin button)
  → POST/GET /api/reviews/apify/cron          — CRON_SECRET, constant-time
  → google_review_apify_claim_run(...)        — the single-run lock + daily budget
  → Apify Actor run                           — Apify's compute, not ours
      input built HERE from the verified mapping
      ad-hoc webhook attached to THIS run
  → POST /api/reviews/apify/webhook           — APIFY_WEBHOOK_SECRET
  → Apify API, server-side, with APIFY_TOKEN  — the run, then its dataset
  → normaliseApifyDataset(...)                — place id → store code, verified only
  → ingestGoogleReviews(...)                  — THE SAME function the extension uses
  → public.google_reviews                     — THE SAME rows, THE SAME dedup key
  → /reviews                                  — THE SAME dashboard
```

Nothing in that path needs a browser, a Google tab, a Google login session or
anybody at a desk.

---

## 0. What this phase changes, and what it deliberately does not

**Changed:** the transport. A scheduled server-side run replaces a person
pressing Sync in Brave.

**Unchanged, and this is the point:** the fifteen-location roster, the Google
store code → ASK Sunny salon mapping, the district structure, the `google_reviews`
table, the `(source, external_review_id)` deduplication key, the anchor-based
reporting model, the 3-star qualifying rule, the response queue, the dashboard,
the review detail panel and the baseline setup screen. Apify feeds the existing
ingestion function; it does not get its own tables, its own totals or its own
idea of what a review means.

**The Brave extension is not deleted and is not required.** See §11.

---

## 1. The Actors researched, and the one chosen

> **Read this first.** `apify.com`, `api.apify.com`, `docs.apify.com` and every
> third-party Apify review site are blocked by this workspace's egress policy
> (403 at the proxy), so none of the pages below could be opened directly.
> Everything in §1 and §2 comes from web search results dated **September 2026**
> and is recorded as an assumption to confirm, not as a fact. **Open the Actor's
> own page and confirm the price and the field names before the first paid run.**
> The integration is written so that being wrong here costs a configuration
> change rather than a rewrite — see "what happens if this is wrong" at the end
> of this section.

| | `compass/google-maps-reviews-scraper` | `compass/crawler-google-places` | Third-party clones (`memo23`, `khadinakbar`, `dami_studio`, `solidcode`, …) |
| --- | --- | --- | --- |
| Maintainer | Compass — Apify's own partner for the Google Maps family | Same | Individual publishers |
| Priced on | Reviews returned (pay-per-event) | **Places** — reported around $4–5 per 1,000 places | Reviews returned |
| Reported price | $0.30–$0.60 per 1,000 reviews (sources disagree — see the note above) | $4/1,000 places, +$0.002/place for detail pages | $0.25–$0.30 per 1,000 reviews |
| Stable review id | **Yes** — `reviewId` | Yes, via its reviews block | Usually, not uniformly documented |
| Absolute publication time | **Yes** — `publishedAtDate`, an ISO instant | Yes | Varies |
| Many places per run | **Yes** — `placeIds[]` takes Place IDs, CIDs, FIDs, short URLs and full URLs | Yes | Usually |
| Newest-first | **Yes** — `reviewsSort: "newest"` | Yes | Varies |
| Date cutoff | **Yes** — `reviewsStartDate` | Yes | Varies |
| Owner response | **Yes** — `responseFromOwnerText` / `responseFromOwnerDate` | Yes | Usually |

**Chosen: `compass/google-maps-reviews-scraper`.**

Not on price — the clones are cheaper, and on this estate's volumes the
difference is cents. On the two things that decide whether this works at all:

1. **Stable review ids.** The whole design rests on `(source,
   external_review_id)`. An Actor whose id changes between runs, or which omits
   one for some records, produces a new row per run: the same customer,
   endlessly, in the response queue. Compass documents `reviewId` and it is a
   Google-shaped token.
2. **A real publication timestamp.** `publishedAtDate` is what lets the backlog
   sort correctly, lets the feed-order check use an exact instant instead of
   "2 days ago", and gives the review detail panel a date that is Google's
   rather than ours.

Beyond those: it is the actor the platform's own partner maintains, which is the
one most likely to still work in six months, and the `compass/crawler-google-places`
alternative is priced per *place* — the wrong axis entirely for a job that reads
fifteen places over and over.

**What happens if this is wrong.** `APIFY_ACTOR_ID` is configuration, not a
constant. The normaliser accepts the two or three spellings the reviews
marketplace has settled on for each field (`reviewId`/`review_id`,
`stars`/`rating`, `publishedAtDate`/`published_at`), so a swap is usually a
variable change. The one thing it will not do is accept a record with **no**
stable review id — that is refused and counted, because there is no substitute
worth keying on.

---

## 2. What this will cost, and why the default schedule is conservative

**Apify's free allowance** (September 2026, from search results, unverified
against the pricing page for the reason in §1): **$5 of platform credits per
month, no card, and they do not roll over.** Paid tiers start around $39/month.

**The Actor's charging model** is pay-per-event, charged on **reviews returned**.
So the monthly bill is: `runs per month × reviews returned per run × price`.

Two things bound reviews-per-run:

* `APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION` — 15 by default.
* `reviewsStartDate`, the date cutoff, which is the oldest "newest review we
  hold" across the fifteen listings, less `APIFY_INCREMENTAL_OVERLAP_HOURS`.

**Estimates at $0.50 per 1,000 reviews** — a deliberately pessimistic reading of
the $0.30–$0.60 range:

| Frequency | Runs / month | Worst case (every location returns its full 15) | Realistic (≈3 per location per run) |
| --- | --- | --- | --- |
| Hourly | 720 | 162,000 reviews — **$81.00** | 32,400 — $16.20 |
| Every 3 hours | 240 | 54,000 — $27.00 | 10,800 — $5.40 |
| Every 6 hours | 120 | 27,000 — **$13.50** | 5,400 — $2.70 |
| **Twice daily** | 60 | 13,500 — **$6.75** | 2,700 — **$1.35** |
| Daily | 30 | 6,750 — $3.38 | 1,350 — $0.68 |

**Recommended for QA and the demo: twice daily**, which is what `vercel.json`
ships with (06:00 and 18:00 UTC). It sits inside the free allowance in the
realistic column with a wide margin, and inside it in the worst case too. Move
to every 6 hours once the first fortnight's **actual** usage is on the source
screen — the run ledger records what Apify says each run cost, so this stops
being an estimate after the first run.

**Hourly is not free-tier viable** at these limits and is not recommended until
somebody has decided to pay for it.

### The guardrails, so a bug cannot spend the month

Three, in increasing order of how much they matter:

1. **`APIFY_REVIEW_*_LIMIT_PER_LOCATION`** bounds what one run asks for. Read
   and range-checked in `config.ts`; an out-of-range value is **refused and
   reported**, never silently clamped.
2. **`maxItems`** is sent as a run parameter, so **Apify** stops the run at
   `limit × locations + allowance` whatever the Actor does with its own input.
3. **`APIFY_MAX_RUNS_PER_DAY`** (default 8, rolling 24 hours) is checked inside
   `google_review_apify_claim_run` — the same transaction that takes the
   single-run lock. No route, including one written later, can start a run
   without passing it. *This is the one that matters:* a wrong per-location
   limit costs a multiple; a loop that starts runs costs without bound.

Plus: **`APIFY_SYNC_ENABLED` is off unless set to `true`**, so deploying this
branch spends nothing, and **at most one run may be live at a time**, enforced by
a partial unique index in Postgres rather than by a disabled button.

---

## 2a. Two switches, because QA needs a state one switch cannot express

| Variable | Governs | QA | Production |
| --- | --- | --- | --- |
| `APIFY_SYNC_ENABLED` | **everything** — manual and scheduled alike | `true` once you are ready to spend | `true` |
| `APIFY_SCHEDULE_ENABLED` | **only** the Vercel Cron tick | `false` | `true` |

With a single flag, turning the integration on to test it for an afternoon also
arms an unattended run at 06:00 the next morning — and the first anybody knows
of it is the usage figure. So the cron route checks `APIFY_SCHEDULE_ENABLED`
**before** `startApifySync`, which is the only call on it that can spend money,
and answers `200 schedule_disabled` when it is off. A tick that correctly
declined is a successful tick, not a broken cron.

The admin routes deliberately do **not** consult it: pressing a button is
somebody deciding, and that is the distinction being drawn. Reconciliation of a
lost completion webhook also still runs while the schedule is off — it settles a
*manual* run that went quiet, and it starts nothing.

---

## 3. Why the schedule lives in ASK Sunny and not in Apify

Two designs were available.

**Rejected — Apify holds the schedule and calls us:** the Actor's input would
then live on Apify, so the fifteen-location mapping would exist in two places,
and the copy a scheduled run actually used would be the one nobody could see
from ASK Sunny. Correcting a salon here would not correct what was scraped.

**Chosen — ASK Sunny starts the run, Apify does the waiting:** a Vercel Cron
entry calls `/api/reviews/apify/cron`, which builds the input from the verified
mapping, applies the limits, and attaches an **ad-hoc webhook to that run**.
Apify calls back when it finishes.

There is **no polling loop**. Nothing sleeps, nothing retries on a timer, and no
invocation is spent waiting. The only read of a run's state outside the webhook
is `reconcileStaleRuns()`: one API read, on the next scheduled tick, over a run
that has been live longer than twenty minutes — which covers a webhook that was
lost or arrived mid-rollout. It reads; it never starts anything, so it cannot
spend a credit.

---

## 4. The webhook, and why its body is not trusted

The request is a doorbell, not a delivery.

**It carries:** a run id ASK Sunny generated, and Apify's own run id.
**It does not carry:** a review, a place id, a store code, a rating, a reviewer
name, or any dataset contents.

Three checks, in order:

1. `APIFY_WEBHOOK_SECRET` — constant-time, rate-limited on failures, the same
   machinery every other machine credential here uses. It is held by a third
   party, so it is one factor of three rather than the security model.
2. The run id must name a run **this system started and is still waiting on**. A
   replayed delivery for a settled run is a no-op, which is what makes Apify's
   at-least-once delivery safe.
3. **Apify's own API must agree**, via `APIFY_TOKEN`, that the run succeeded and
   which dataset holds the records — and the dataset is then read from there.

So the strongest thing a caller who somehow holds the secret can do is make ASK
Sunny re-read a dataset it started and already owns, which creates nothing
because deduplication is by Google's review id. **That is the answer to "do not
trust location identity from webhook input": there is no location identity in
the input to trust.**

The route answers **200** for a duplicate delivery, an unknown run, or a run
Apify says is still going — Apify retries a non-2xx and retrying any of those
would achieve nothing. A genuine fault (dataset unreadable, database down) does
return an error status, because that one *is* worth retrying.

---

## 5. One review, two transports

The failure to avoid: the same customer appearing twice because a different
piece of software found them.

**`google_review_source` is untouched.** That enum is half of the deduplication
key — the review's **identity namespace** — and Google's review id is Google's
review id however it reached us. Adding `'apify'` to it would have made every
review found by both sources into two rows.

**The transport is recorded beside the review**, in
`google_review_ingestion_source` (`brave_extension` | `apify`) on two columns:

* `first_ingestion_source` — which transport **discovered** it. Never rewritten.
* `last_ingestion_source` — which saw it most recently.

A change of transport is deliberately **not** counted as a change to the review,
so "3 new, 5 already synced" keeps meaning something once both sources run.

`reported_place_id` records what the source *said* the Google listing was. It is
audit only and never routes anything: a payload naming a different place than
the mapping does is recorded as a `place_id_mismatch` problem and the value is
dropped — the review is still filed, against the salon **the mapping** says.

### The one thing that has to be checked in QA

Everything above holds **if** Apify's `reviewId` is the same string as the
Business Profile page's `data-lid`. Both are Google-shaped base64 tokens of the
same family, and that is a strong hint, not proof. It could not be proved here
because it needs live data from both sources.

So `public.google_review_source_reconciliation` and the "Brave extension versus
Apify" table on the source screen exist to answer it with numbers:

* **`seen_by_both_sources > 0`** — the two transports report the same id. The
  key holds. This is what you want to see.
* **`suspected_duplicates > 0`** — a pair at one salon with the same reviewer,
  the same rating and publication times within a day, under two different ids,
  discovered by two different transports. The ids do **not** agree.

Nothing merges on a resemblance. It is a report for a person, because a system
that merged automatically would eventually merge two real customers. **Do not
switch the production source over until that table has been read.**

---

## 6. The review timestamp, and what it did and did not change

Apify returns `publishedAtDate` — a real ISO instant. It is persisted to
`google_reviews.google_absolute_date`, which is the column Phase 1 reserved for
exactly this and already surfaces in the review detail panel.

> **On the column name.** The brief suggested `google_published_at`. The existing
> column has that meaning, that nullability and that comment, and is already
> wired through `google_reviews_enriched`, the shared types and the detail panel.
> A second column with near-identical meaning is precisely the parallel data
> model this phase is supposed not to build, so the existing one was reused and
> its comment updated to say it is canonical where present. Say the word and it
> can be renamed.

`first_seen_at` and `last_seen_at` remain **ingestion audit fields** and are
never the review's date. `first_seen_week` remains ingestion metadata that
decides nothing. Nothing changed there.

### What the timestamp changed — and it is smaller than it looks

**It did not become the reporting period key, and the anchor model was not
rewritten.** Which period a review counts in is still decided by its **position
above the listing's anchor**, because that is what the manual process measures
and because a backlog import must not be able to disturb a week that is already
counted.

It changed **two** things, both of which make the existing model work better:

1. **The feed order is now derived from Google's clock.** The normaliser sorts
   each listing's records newest-first by `publishedAtDate` and assigns feed
   positions from that — rather than trusting the order Apify happened to write
   the dataset in. A listing where **any** record lacks a timestamp gets **no**
   positions at all, which makes `planPeriodAssignment` report
   `feed_position_missing` and count nothing for it. Fail closed: a partial
   ordering is not an ordering.
2. **The order check uses an exact instant where it has one.**
   `feedOrderLooksReliable` previously compared Google's bucketed wording, which
   cannot separate two reviews from the same Tuesday. It now prefers the real
   timestamp and falls back to the wording for the transport that has nothing
   better.

### Could the period be assigned from the timestamp instead?

Technically yes, and it is worth discussing later — a real instant would let a
period be assigned without an anchor at all. It was **not** done here, because:

* every number the business has counted so far was counted by position;
* the two models would disagree on any review near a week boundary, in ways
  nobody could reconcile after the fact;
* only Apify-sourced reviews would have a timestamp, so the estate would be
  running two rules at once until the extension is retired.

That is a reporting-architecture decision, not an integration one. **It needs
your sign-off before anybody writes it**, which is why nothing here assumes it.

---

## 7. Mapping the fifteen locations

**A scheduled run must never search by business name.** "Sun Tan City" is a
franchise brand; a name search that drifts one listing sideways files a
stranger's reviews against a real salon, permanently, with nothing on the
dashboard looking wrong.

So the identifier is resolved **once**, verified, and persisted on
`google_review_locations`:

| Column | What it is |
| --- | --- |
| `google_place_id` | Google's own Place ID. **Unique** — two salons cannot share one listing |
| `google_cid`, `google_maps_url` | Kept when supplied; never parsed at run time |
| `canonical_google_name`, `canonical_google_address` | What **Google** said, at verification time. Evidence |
| `expected_state`, `expected_city` | What the roster says the salon is. Seeded for all fifteen |
| `apify_source_status` | `unconfigured` → `pending_verification` → `verified` / `rejected` |
| `apify_last_verified_at`, `apify_verification_note` | When, and what the check found |

**Only `verified` listings take part in a run.** Unconfigured, pending and
rejected ones are skipped **and reported as skipped**, so the screen says
"13 / 15 configured" rather than a run silently covering thirteen salons.

A constraint refuses to record `verified` without the identifier, the name, the
address and the timestamp it was verified against — so "verified" cannot decay
into "somebody clicked a button".

### The operator's flow, on `/admin/integrations/google-reviews`

**The main path is one button.**

1. **Discover Google Listings for All 15 Locations.** One Apify run against a
   *places* Actor — one search per salon, built from the roster — proposes a
   candidate each. It maps nothing: proposals land in the `discovered_*`
   columns and the `discovery_status`, neither of which can make a listing
   runnable.
2. **Review the table.** Every salon is a row with both numbering systems, what
   was expected, what Google proposed, the Place ID, the status and the reason.
3. **Verify All Safe Matches (N).** Promotes only the listings whose search
   concluded `candidate_found`. **This costs no Apify call** — Google's own name
   and address were captured when the candidate was found — which is what makes
   it safe to press for fourteen locations at once.
4. Anything `ambiguous`, `not_found` or `profile_issue` stays unmapped, on
   screen, with the reason.

**Manual entry is the fallback**, behind a disclosure on the same screen, for
what discovery could not resolve and for re-pointing a salon whose listing moved:

1. **Paste** a Place ID or a Maps URL containing one. Saved as
   `pending_verification`. There is no field on any route that can write
   `verified`.
2. **Check against Google** — one cheap Apify run (one review per pending
   listing; the place facts ride along on the review record). It compares
   Google's own title and address against the salon's expected city and state
   and writes `verified` or `rejected` with a note.
3. Only then does that listing appear in a sync.

### How a candidate is matched, and when it is refused

Every candidate is checked against **every** listing, not just the one whose
query produced it. The cheap version — scope to the query, take the first that
passes — has one failure mode and it is the bad one: a candidate that fits two
salons is accepted for whichever was processed first, silently.

A listing is matched **only when exactly one candidate passes every check, and
that candidate passes no other listing's checks.** The checks:

| Check | Refusal |
| --- | --- |
| Google's title contains "sun tan city" | `not_sun_tan_city` |
| Not Buff City Soap, which shares the Google account | `excluded_business` |
| Google does not mark it closed | `closed` → `profile_issue` |
| The salon's state, as a word | `wrong_state` |
| The roster's city | `wrong_city` |
| The street hint, where the roster carries one | `wrong_street` |
| A name and an address exist to check at all | `no_name` / `no_address` |

Two candidates for one salon, or one candidate for two salons, is `ambiguous`
for everything involved. Nothing resolves it by preferring more reviews, the
first result, or the nearest to the city centre — each is right most of the time
and invisibly wrong occasionally.

### The expected address, which is what makes discovery reliable

**The street hint below was never enough, and asking for a Place ID instead was
the wrong fallback.** A Google Place ID is a value only Google holds, that
nobody can check by looking, and that an operations manager has no way to
produce — so "ambiguous" sent a person hunting for fifteen of them.

`google_review_locations` now carries the address ASK Sunny expects Google to
report, beside the `expected_city` and `expected_state` that were already there:

| Column | Notes |
| --- | --- |
| `expected_street_address` | As a person would write it, suite included |
| `expected_city` | Already seeded for all fifteen |
| `expected_state` | Already seeded; upper-cased on save |
| `expected_postal_code` | Optional, and decisive where both sides have one |
| `expected_country` | Seeded `United States`; nothing matches on it today |

**No second address record was created.** There is no address anywhere else in
ASK Sunny to reuse — `salons` and `salon_directory` carry a salon number, a
store name, a district and a region and nothing geographic below the city — so
the columns go on the table that already held the city and state. Two records
would immediately raise the question of which one discovery reads.

**The search becomes the address.** With one on record the query is
`Sun Tan City 2624 Iowa St Ste B Lawrence KS 66046` rather than
`Sun Tan City Lawrence KS`. Without one, the old brand-hint-city-state query is
used unchanged, so the six salons the hint already resolves keep working.

**The comparison normalises both sides before it compares.** "2624 Iowa St Ste
B" and "2624 Iowa Street" are the same door: the suite is dropped because Google
omits it far more often than it carries it, suffixes and directionals are
spelled out, and **the house number is compared exactly** — it is the one part
of an address with no synonyms, and two salons on the same road differ by it and
nothing else. "St" is expanded to "Street" only where it cannot be "Saint",
because St Joseph is a city this business trades in.

Four strengths, and the strength is what breaks ties:

| Strength | Means |
| --- | --- |
| `exact` | Street and postcode both agree |
| `strong` | Street agrees; no postcode on one side to confirm it |
| `weak` | City and state only — no expected street on record |
| `none` | Checked, and it is not this salon |

**A postcode contradiction is fatal, not a deduction.** Where both sides carry
one and they differ, the candidate is refused even though the street line reads
the same: two addresses in one city with different postcodes are two different
places, and "the street matched so the zip is probably a typo" is exactly the
reasoning that files one salon's customers under another salon's name.

**An address match outranks a name-only match, and a tie is still ambiguous.**
Two Sun Tan City listings in Lawrence, one at the expected door, now resolve to
the one at the door. Two listings matching that door equally well stay
`ambiguous`, because that is two profiles for one salon and a person has to
look. The same rule settles the cross-listing case: a candidate that is `exact`
for store 306 and `weak` for 307 belongs to 306.

**Saving an address maps nothing.** `google_review_apify_set_expected_address`
writes five address columns and a note. It has no access to `google_place_id`,
`apify_source_status` or the canonical fields, so no amount of address editing
can re-point a salon at a different listing or promote one nobody checked.

### Rediscovering only what is unresolved

`Rediscover Unresolved Locations` searches the listings that are still genuinely
unanswered — never searched, ambiguous, not found — and leaves alone anything
verified, already proposed as a candidate, waiting on a check of a pasted
identifier, or flagged closed by Google. The shape of the work is: search all
fifteen, type addresses for the failures, search again; searching all fifteen
the second time pays again for every answer that was already right.

It is a **scope on the same run kind**, not a new one: the ledger's `kind`
describes what a run did, and both of these searched Google Maps.

**A stranded `searching` counts as unresolved.** A discovery marks its listings
`searching` before it starts. When a run ends ABORTED the reset returns them —
but a listing that slipped through would otherwise be excluded from the one
button that exists to retry the failure, so the problem would disable its own
fix. It did, once, to all fifteen at once (2026-09-19).

### The street hint, and why discovery works at all

ASK Sunny holds **no street addresses** — the roster is names and states. Three
salons are in Lincoln and three in Omaha, so city and state alone cannot
separate them: a search for "Sun Tan City Lincoln NE" returns three genuine Sun
Tan City listings and the honest answer for all three would be `ambiguous`.

The roster **names** carry the missing information — "NE Lincoln 27th Street",
"NE Omaha 132nd and Maple" — and those tokens are seeded into
`expected_street_hint` **as data**, by the migration, rather than parsed out of
the label at run time. A parser would work until somebody renamed a salon and
then fail silently.

| Store | Hint | Store | Hint |
| --- | --- | --- | --- |
| 140 | `wornall` | 231 | — |
| 141 | — | 254 | `pacific` |
| 143 | — | 306 | — |
| 144 | `27th` | 307 | `shawnee mission` |
| 145 | `o st`, `o street` | 314 | — |
| 146 | `pine lake` | 373 | — |
| 147 | `132nd`, `maple` | 409 | — |
| 148 | `144th`, `center` | | |

A null hint is **not** a wildcard: it means the city alone identifies that salon,
which is true for the nine that are the only Sun Tan City in their city.

**307 KS Shawnee Mission Pkwy is the one to watch.** Shawnee Mission Parkway
runs through several cities, and the expected city was seeded as `Shawnee`. If
the salon is actually in Mission or Overland Park, discovery will return
`not_found` rather than guessing — which is the correct behaviour and means that
listing may need the manual fallback.

Three checks, all of which must pass: the title contains "sun tan city"; the
salon's two-letter state appears in Google's address as a word; the roster's
city appears in it. **Missing evidence is a rejection** — "could not check" and
"checked and it was fine" must never produce the same outcome. **Two candidates
matching equally well is a rejection too**, because a salon that moved and whose
old listing was never removed is a real situation and a heuristic that prefers
one is right most of the time and invisibly wrong occasionally.

### A store code is still not a salon number

Unchanged from Phase 1 and restated because this document adds a third
identifier to the pile. Google **306** is KS Manhattan, which is ASK Sunny salon
**0462** — not 0306, which is MO Kansas City Wornall (Google 140). There is no
transformation between the systems, only `google_review_locations.salon_id`,
which is a real foreign key. `store-codes.test.ts` keeps the three copies of the
list honest; `locations.test.ts` now keeps the expected-city seed honest too.

---

## 8. The initial backfill

Admin action: **"Import Google Review History via Apify"**, on the source screen.

* Bounded by `APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION` (default **100**,
  maximum **500**). The maximum is `MAX_REVIEWS_PER_SYNC`, because a listing is
  handed to the ingestion in one batch so its feed positions stay comparable —
  a listing split across two batches would have its reporting boundary fall
  inside the split.
* **Sends no date cutoff.** Its whole purpose is to reach back past what we
  hold.
* Newest-first, deduplicated by Google's review id, capturing reviewer, rating,
  comment, publication time, location, owner response and the place id, with
  `first_ingestion_source = 'apify'`.
* Takes the same single-run lock and the same daily budget as every other run.

**An import does not raise this week's number.** Every imported review is stored
as `historical` and assigned to no reporting period, because nothing above an
unproven boundary can be called new. The confirmation dialog says so in those
words, and the source screen restates it under every run — this is the exact
thing that misled a manager on the extension's first live run.

---

## 9. The recurring sync

* `APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION` newest reviews per location
  (default **15**) — comfortably more than any of these listings receives
  between runs, so the anchor stays inside the window and the boundary keeps
  being provable.
* A date cutoff of **the oldest "newest review we hold" across the listings**,
  less `APIFY_INCREMENTAL_OVERLAP_HOURS` (default 6). The *oldest*, not the
  newest: a cutoff from the newest review anywhere in the estate would silently
  skip everything a slower salon received in between. **No cutoff at all** when
  any listing holds nothing, because such a listing has no floor to measure from.
* Overlap is safe and cheap: deduplication is by Google's review id, so a
  re-fetched review costs a fetched record and creates nothing.

If the anchor falls out of the window — after a long outage, say — the listing
reports `anchor_not_in_feed`, stores everything as historical and counts
nothing, which is the same fail-closed behaviour the extension path already has.
Raise the incremental limit for one run, or re-baseline on `/reviews/setup`.

---

## 10. The source screen

`/admin/integrations/google-reviews`, gated on `manage_integrations` (admin,
owner, developer) — the same gate as the Integrations page and the baseline
setup. Deliberately **not** on the `/reviews` dashboard, which most of the org
chart can read: run ids, Place IDs and Actor limits do not belong in front of
somebody reading a one-star review.

It shows: whether the source is enabled, configuration problems **by variable
name and never by value**, locations configured (n / 15), last successful sync,
runs today against the daily cap, the recurring window, the next scheduled sync,
and for the last run — kind, status, who asked for it, locations returned,
reviews fetched, new, updated, duplicates, and **what Apify says it cost**.

**Three figures, never derived from one another:**

* **Locations configured** — how many have a verified Place ID. A setup fact.
* **Locations returned** — how many answered the last run *at all*, including
  the ones that answered "nothing new".
* **Reviews fetched** — how many records came back.

A location that was asked for and did not appear is **named by store code**
under "Locations that did not answer". *"This location had no new reviews" and
"this location's mapping is broken" both show zero; a panel that renders them
identically is how a broken mapping survives for six weeks.*

Plus: the per-location table, the mapping form, and the Brave-versus-Apify
reconciliation table from §5.

**"Sync Google Reviews Now"** starts one run. The button disables itself, which
is a courtesy — the actual lock is the partial unique index, because two tabs, a
cron tick landing at the same moment and a retried request all get past a
disabled button and none of them gets past Postgres.

---

## 11. The Brave extension

**Primary production candidate: the Apify server-side sync.**
**Fallback and manual reconciliation: the ASK Sunny Review Sync extension.**

It is not deleted, not disabled, and not required for Apify to work. It keeps
its own `GOOGLE_REVIEW_SYNC_SECRET`, which can file reviews for the fifteen
allowlisted stores and cannot spend a penny; the Apify credentials are separate
variables so either can be revoked without taking the other down. A test asserts
that no Apify identifier appears anywhere in `extension/`.

Both transports write to the same rows through the same function, so a review
found by either is one canonical record — which is exactly what makes the
extension usable as the tool that checks Apify's results by hand.

---

## 12. Environment variables

All server-only. `APIFY_TOKEN` can start runs and read every dataset on the
account, so it is never `NEXT_PUBLIC_`, never in the extension, never in a
client bundle, and never in a URL. `src/lib/reviews/apify/config.ts` imports
`server-only`, which makes a client component reaching it a build failure.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `APIFY_TOKEN` | yes | — | Apify API token |
| `APIFY_SYNC_ENABLED` | yes | `false` | The master switch. Off unless `true` |
| `APIFY_SCHEDULE_ENABLED` | yes | `false` | Whether the **cron** may start a run. Manual buttons ignore it |
| `APIFY_WEBHOOK_SECRET` | yes | — | Apify's credential on the completion webhook. ≥24 chars |
| `CRON_SECRET` | yes | — | Vercel Cron's credential. Without it the cron route refuses every call |
| `NEXT_PUBLIC_SITE_URL` | yes* | `VERCEL_URL` | Where Apify calls back. Never a request header |
| `APIFY_ACTOR_ID` | no | `compass~google-maps-reviews-scraper` | `owner/name` is accepted and converted |
| `APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION` | no | `100` | Max 500 |
| `APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION` | no | `15` | Max 200 |
| `APIFY_MAX_RUNS_PER_DAY` | no | `8` | Rolling 24 hours. Checked in the database |
| `APIFY_INCREMENTAL_OVERLAP_HOURS` | no | `6` | Cutoff overlap |
| `APIFY_RUN_TIMEOUT_SECONDS` | no | `900` | Sent to Apify |
| `APIFY_RUN_MEMORY_MBYTES` | no | `2048` | Sent to Apify |
| `APIFY_SYNC_SCHEDULE` | no | — | Free text, shown as "Next scheduled sync". Never parsed |

\* `VERCEL_URL` covers a Preview, which is where this runs first.

---

## 13. Setting it up

### In Apify

1. Create an account. The free plan is $5 of credits a month and needs no card.
2. **Settings → API & Integrations → Personal API tokens** → create one. Copy it
   once; it is not shown again.
3. Open the Actor page for `compass/google-maps-reviews-scraper` and **confirm
   the current price per 1,000 reviews and the output field names** against §1
   and §2. This is the step that could not be done from here.
4. **Nothing else.** No schedule, no standing webhook, no saved task. ASK Sunny
   builds the input and attaches a webhook to each run, so there is no
   configuration on Apify that can drift from what this code expects.

### In Vercel

1. **Settings → Environment Variables**, on **Preview only** for now:
   `APIFY_TOKEN`, `APIFY_SYNC_ENABLED=true`, `APIFY_WEBHOOK_SECRET`,
   `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, and any limit you want to override.
   Generate the two secrets — do not invent them: `openssl rand -base64 32`.
2. Apply the migration `20260918001000_google_review_apify_source.sql` to the
   Supabase project the Preview points at.
3. Deploy the branch. `vercel.json` registers the cron at 06:00 and 18:00 UTC.
   **Note:** Vercel's Hobby plan allows one cron invocation per day; on Hobby,
   change the schedule to `0 6 * * *`.
4. Open `/admin/integrations/google-reviews` and work §7 → §8 → §9.

---

## 14. Failure handling

| What happens | What the system does |
| --- | --- |
| Apify unreachable or slow | Every call has a deadline; the run slot is released, nothing is written |
| Apify refuses the run (402 usage limit, 401 credentials) | Named specifically, slot released, no review changed |
| Actor run fails, times out or is aborted | Recorded as `failed`. **The dataset is never fetched and the ingestion is never called** |
| Dataset unavailable or unreadable | Recorded as `failed`. No review changed |
| Dataset larger than any configured limit could ask for | **Refused**, not truncated — a silent partial import would hide the fault |
| A malformed record | Refused and counted; the rest of the batch is filed |
| A record with no stable review id | Refused and counted. The one refusal with no fallback |
| A record for an unknown place | Ignored and counted as unmapped. Not an error |
| A listing that did not answer | Named by store code as a **partial** run |
| A listing whose records are not all dated | Stored, counted toward nothing, reported |
| Ambiguous location mapping | Rejected with a note. Never resolved by preference |
| Budget or concurrency guard hit | Reported as `over_budget` / `already_running`, with a 200 from the cron route — a guardrail working is not a broken cron |
| Webhook never arrives | One bounded API read on the next tick; a claim older than six hours is reaped as `failed` |

**A failed run cannot erase a review.** Every write in this integration is an
insert or an update through `ingest_google_reviews`. There is no delete, no
truncate, and no "make the listing's reviews match what came back" — asserted by
a test that reads the migration and every module as text.

---

## 15. What has and has not been verified

**Verified here:** 6,646 tests pass (94 of them new and covering this
integration), `tsc --noEmit` is clean, `eslint` is clean, and `next build`
succeeds with all five new routes registered.

**Not verified here, and needing a Preview with real credentials:**

* **Any live Apify run.** `apify.com` and `api.apify.com` are blocked by this
  workspace's egress policy, and there is no Apify token in this environment.
* **The Actor's exact price and field names** (§1, §2).
* **The all-fifteen QA run** (per-location: store code, salon, Place ID, reviews
  returned, new reviews, latest review date, mapping status). The source screen
  renders exactly that table; it needs a run to fill it.
* **The Brave-versus-Apify reconciliation on store 306 (KS Manhattan).** The
  view and the screen are built and tested; the comparison itself needs both
  sources to have run against the same listing.

None of these were simulated or estimated. Run §13, then read §5 and §10.

---

## 16. Known limitations

1. **The `reviewId` / `data-lid` equivalence is assumed, not proved.** §5 says
   how to check it and what to do if it is false. This is the single most
   important thing to confirm before a cutover.
2. **The price figures in §2 are from search results, not from the Actor page.**
   The run ledger records Apify's own reported usage, so this stops being an
   estimate after the first run.
3. **One global date cutoff.** The Actor takes one `reviewsStartDate` for all
   places, so it is the oldest listing's floor. A single quiet salon therefore
   makes every run fetch a little more than it needs. Safe, slightly costly,
   and the reason the per-location limit is the real bound.
4. **The webhook's timeout is 60 seconds.** Comfortable for a backfill of
   15 × 100, and the number to raise if the backfill limit is pushed much
   higher.
5. **Rate limits and the run lock are per-instance in memory** where they apply
   to HTTP, but the run lock itself is a Postgres index, so concurrency safety
   does not depend on instance count.
6. **The reporting period is still assigned by position, not by timestamp.**
   §6 explains why, and what changing it would mean.
