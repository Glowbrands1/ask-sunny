# Google Reviews — the official Business Profile API source

Status: **implemented on a feature branch, not deployed.** Nothing here has run
against Google or against the production database. Apify is untouched and is
still the live source.

## What was built

```
Google Business Profile API ──► gbp/client.ts (OAuth refresh, retries, pagination, request budget)
                                   │
        confirmed listings only ───┤  gbp/sync.ts
        (gbp_mapping_status)       │    1. fetch newest pages per listing
                                   │    2. reconcile against stored reviews (gbp/reconcile.ts, pure)
                                   │    3. DRY RUN → report only, writes nothing
                                   │       LIVE    → ingestGoogleReviews (the SAME pipeline Apify/Brave use)
                                   │                 + gbp_apply_links (gbp_* columns only)
                                   │                 + gbp_record_review_items (manual-review queue)
                                   ▼
                       public.google_reviews  →  google_reviews_enriched  →  the dashboards (unchanged)
```

Triggers: Pub/Sub push (`POST /api/reviews/gbp/pubsub`, fast path), daily cron
(`GET /api/reviews/gbp/cron`, fallback), admin console (`/api/admin/reviews/gbp`).

## Why reconciliation is the hard part

Stored reviews are keyed `(source, external_review_id)` where the id is Brave's
`data-lid` (20 chars) or Apify's `reviewId` (68 chars). The Business Profile API
has its own id. Filing by the official id alone would duplicate all ~194
existing reviews. So:

* The official id lives **beside** the existing identity in `gbp_review_id`; the
  existing `external_review_id` is never rewritten.
* An official review is **auto-matched** to a stored row only when ALL hold:
  same listing; the stored row has a real timestamp agreeing with Google's
  `createTime` (≤ 2 min when there is no text, ≤ 48 h with identical non-empty
  text); reviewer name equal; rating equal; text equal; and exactly one stored
  row qualifies for this review **and** this stored row qualifies for no other.
* **Never name, rating or text alone.** A stored row with no timestamp
  (Brave-only history) can never be auto-matched.
* Anything resembling a stored row but not meeting that bar goes to
  `google_review_reconciliation_items` for a person. It is **not ingested**.
* "New" is declared only when nothing stored resembles the review.
* Stored rows nothing matched are **reported, never deleted**.
* Official rating/text/name/reply are stored in `gbp_*` columns; a difference
  from the Apify-derived value is a reported discrepancy, not an overwrite.
  When filing a known review, the stored name and text are sent back through
  ingestion unchanged; rating and a **missing** owner reply come from Google.

Unchanged and untouched: `first_seen_week`, `first_seen_at`,
`reporting_period_id`, `reporting_assignment_status`, the anchors, the
generated `eligible_for_weekly_count`, and `google_reviews_enriched`.
Reviews are filed newest-first through `ingestGoogleReviews`, with known reviews
under their **existing** external id so the anchor model still finds them.

## Only Sun Tan City listings, even in a mixed account

1. Discovery marks a Google location `eligible` only if its `storeCode` is one of
   the 15 allowlisted codes, is unique in the account, **and** its place id
   equals the place id already verified for that listing during the Apify
   rollout. A title that merely says "Sun Tan City" is `needs_review`, never
   mapped. Everything else is `excluded_other_brand`.
2. Only a person's `confirm` action (re-validated against a fresh discovery)
   writes `gbp_mapping_status = 'confirmed'`. Nothing syncs from a proposal.
3. The sync requests **only confirmed** listings from Google.
4. `ingestGoogleReviews` still applies the store-code allowlist, and
   `google_reviews.location_id` is a foreign key into the 15-row table.

Google store code ≠ ASK Sunny salon number (306 is KS Manhattan; salon 0306 is a
different salon). Salons are reached only through `google_review_locations.salon_id`.

## Two filing modes — why creation is OFF while Apify runs

Apify does not know the official id. If both sources could create rows, a
brand-new review would be filed twice (once under each id). So:

* **Enrich-only (default).** Official reviews are matched to rows Apify/Brave
  already created and used to add the official link, timestamps and a missing
  owner reply. Brand-new reviews are *reported* (`deferredNewReviews`) and not
  filed. Known reviews are filed with **no feed position**: the period planner
  (`planPeriodAssignment`) marks any store batch containing a null position
  `historical` and cannot advance an anchor, so this mode **cannot count a
  review or change a reporting assignment** (asserted in `sync.test.ts` against
  the real planner).
* **Full.** Requires `GBP_CREATE_NEW_REVIEWS=true` **and** `APIFY_SYNC_ENABLED`
  not `true`. Files new reviews with positions, so they count exactly as Apify's
  would (above the anchor). This is the cutover behaviour.
* The dry-run report includes `projectedIfFull` per listing — computed with the
  real planner against the real anchor, never written — so the cutover can be
  approved on evidence (how many reviews would start counting, or why none).

## Preview deployments cannot write

Preview deployments of this project use the production Supabase URL and service
key. Therefore live filing, mapping confirmation and notification setup are
refused unless `VERCEL_ENV === "production"`; elsewhere the sync is forced to a
read-only dry run (`forcedDryRunReason` in the report). Vercel cron runs only on
production, and the Pub/Sub subscription should point at the production host.

## Safety switches

| Variable | Effect |
| --- | --- |
| `GBP_SYNC_MODE` unset / `off` | Everything inert. Routes answer `disabled`; no Google call, no DB access. |
| `dry_run` | Reads Google and the DB, returns the report, **writes nothing** (not even a ledger row). Forces dry run even if `live` is requested. |
| `live` | Files reviews. Admin `sync` and cron/Pub/Sub require this. |
| `GBP_CREATE_NEW_REVIEWS=true` | Permits creating rows from the API; ignored while `APIFY_SYNC_ENABLED=true`. |
| `GBP_ALLOW_LIVE_BACKFILL=true` | Required, in addition, for a live **backfill**. Cron and Pub/Sub never run a backfill. |
| `GBP_MAX_REQUESTS_PER_RUN` | Hard ceiling on Google requests, retries included. |

## Reusing what Ask Bubbles already proved

Ask Bubbles (same Glow Brands Google account) has run the official API in
production since 14 Oct 2026: 1 Business Profile account, **22 locations seen —
7 Buff City Soap linked, 15 blocked as "Sun Tan City"** — every 6 hours, all 7
stores complete with each imported count equal to Google's own total. So, already
proven and **not** something to set up again:

* The Google Cloud project is **approved** for the Business Profile APIs, has the
  Account Management, Business Information and My Business (v4) APIs **enabled**
  (it needed enabling once: the first Bubbles run failed `api_disabled` and
  succeeded minutes after), and its quota is ample (Bubbles reads ~7 stores × a
  few pages every 6 hours).
* The authorized Google account **can see Sun Tan City's 15 listings** — the
  count equals Ask Sunny's allowlist. The store codes themselves are confirmed by
  Ask Sunny's first dry run, not assumed.
* The endpoints are the same ones used here (`GET /v1/accounts`,
  `GET /v1/{account}/locations?readMask=…`, `GET /v4/{account}/{location}/reviews`)
  and the notification setting is a `PATCH`, as corrected in this PR.

Patterns ported from Bubbles into this PR: in-app OAuth connect with PKCE and a
**sealed refresh token in the database** (no token in the environment); `api_disabled`
and zero-quota `api_access_pending` classification from Google's structured error
details; request timeouts and `redirect: "error"`; loop-proof pagination and a
**complete-read** rule (every page, nothing rejected, Google's total not larger);
a Postgres run lock; store-code **and address** corroboration; refusing any review
whose resource name is not under the requested listing; blocking the other brand
by title before any comparison.

Kept from this PR where it is stronger: Pub/Sub authentication is a Google-signed
OIDC token (Bubbles uses a shared token in the push URL, which lands in logs), and
reconciliation against the existing Brave/Apify ids (Bubbles had no legacy ids).

### Separate OAuth client and separate refresh token (recommended)

* **Do not reuse Bubbles' refresh token or client secret.** Create a **second OAuth
  client in the same approved Google Cloud project** for Ask Sunny, with its own
  redirect URI, and connect Google through Ask Sunny's own sign-in. Each app then
  has its own grant: revoking or rotating one cannot break the other, a leaked
  secret has half the blast radius, and nothing is copied between projects.
* The same Google **account** may be used for both grants (it manages all 22
  listings). A new grant does not invalidate an existing one.
* The consent screen must be **published to production**; in Testing, refresh
  tokens expire after 7 days. Confirm in Google Cloud (Bubbles' token is only days
  old, so it has not proven this).
* **Databases stay separate.** Ask Sunny's sealed token and reviews live only in
  Ask Sunny's Supabase project; nothing here reads or writes Bubbles' database.
  Brand isolation is enforced both ways (allowlist + other-brand title block +
  resource-name check here; the mirror image in Bubbles).

### Pub/Sub: one topic, two subscriptions

A Business Profile **account has exactly one notification setting**, and both
brands are in one account. The topic is therefore necessarily shared. Do **not**
point the account at a second topic (that would silently redirect Bubbles).
Instead give the existing topic a **second push subscription** for Ask Sunny, with
its own service account and audience. Events for Buff City locations are simply
acknowledged by Ask Sunny (they are not confirmed Sun Tan City listings), and Sun
Tan City events cause Bubbles to run a harmless idempotent sync. The admin
`configure_notifications` action **refuses** if the account already notifies a
different topic. Note that Bubbles has recorded **no** Pub/Sub-triggered run yet:
its 6-hourly cron is what is proven; push delivery is not.

## Google Cloud configuration required (Ask Sunny's part only)

1. In the **existing approved project** (the one Ask Bubbles uses): create a
   **second OAuth client** (Web application) named for Ask Sunny; add its redirect
   URI `https://ask-sunny.vercel.app/api/admin/reviews/gbp/callback` (or your
   explicit `GOOGLE_GBP_REDIRECT_URI`). Confirm the consent screen is published to
   production.
2. Pub/Sub (only for push): a **push subscription** on the existing topic to
   `https://ask-sunny.vercel.app/api/reviews/gbp/pubsub` with OIDC enabled, a
   service account dedicated to Ask Sunny, and an audience equal to that URL.
   Do not change the account's notification setting.

## Vercel environment variables (names only; Production only, never Preview)

`GOOGLE_GBP_CLIENT_ID`, `GOOGLE_GBP_CLIENT_SECRET`, `GOOGLE_GBP_TOKEN_ENCRYPTION_KEY`
(all Sensitive), optional `GOOGLE_GBP_REDIRECT_URI`; `GBP_SYNC_MODE` (start at
`dry_run`); for push: `GBP_PUBSUB_AUDIENCE`, `GBP_PUBSUB_SERVICE_ACCOUNT`;
optional `GBP_PUBSUB_TOPIC` (only used by `configure_notifications`),
`GBP_CREATE_NEW_REVIEWS`, `GBP_ALLOW_LIVE_BACKFILL`, `GBP_INCREMENTAL_MAX_PAGES`,
`GBP_BACKFILL_MAX_PAGES`, `GBP_MAX_REQUESTS_PER_RUN`. `CRON_SECRET` already exists.
There is **no refresh-token variable**. **Preview deployments share the production
database** (same `NEXT_PUBLIC_SUPABASE_URL`), so none of these belong in Preview.

## Production rollout

1. Review and merge the PR (this adds one inert cron entry to `vercel.json`).
2. Apply `20261016001000_google_review_business_profile_api.sql` (additive,
   re-runnable). Run `supabase/tests/gbp_schema_checks.sql` against a throwaway
   cluster first.
3. Add the Google variables with `GBP_SYNC_MODE=dry_run`, redeploy, then an
   administrator opens `/api/admin/reviews/gbp/connect` and signs in with the
   account that manages the profiles (sealed token saved; no token is ever shown).
4. Admin `discover`; review proposals and `missing`; `confirm` each `eligible`
   listing; resolve `needs_review`/`conflict` by hand.
5. Admin `dry_run` (incremental, then the **September–October backfill measurement** above). Review: per-listing counts vs
   Google's `totalReviewCount`/`averageRating`, `autoMatched`, `newReviews`,
   `needsReviewItems`, `discrepancies`, `unmatchedStored`.
6. Only after sign-off: `GBP_SYNC_MODE=live` (enrich-only), run one listing,
   verify, then all. Keep Apify running throughout.
7. Configure notifications and the Pub/Sub subscription; verify a real new review
   arrives through the push path and the cron path finds nothing missing.

## Cron timing and Vercel

`vercel.json` adds `30 12 * * *` UTC. Apify's entry fires at 11:00 and 12:00 UTC
(exactly one of which is 06:00 Central). 12:30 UTC is 30–90 minutes after the
Apify run, so Apify's new rows exist to be linked. There is no shared lock
between the two; both are idempotent, links are applied in a stable row order,
and enrich-only never creates rows. The project already runs an hourly cron and
three cron entries, which Hobby does not allow, so it is on a paid plan; the
route's `maxDuration` is 300 s. Apply the migration outside 11:00–12:45 UTC.

## Backfill of September–October 2026 reviews

**Goal:** Ask Sunny holds every Google review created between 2026-09-01 and
2026-10-31, without changing any existing review, week, period or count.

**Where things stand (production, 16 Oct 2026):** 194 reviews in total; 164 are
dated September (111) or October (53). Apify keeps only the newest ~15 reviews per
listing, so Google very likely holds more in that window than Ask Sunny does. The
counted (anchor-assigned) reviews are 33 for September and 34 for October; those
are frozen by the anchor model and a backfill must not move them. Ten September
rows have no timestamp (Brave-only) and can only be linked by a person.

1. **Measure (dry run, writes nothing).** Admin `dry_run`, `scope: "backfill"`,
   `from: "2026-09-01"`, `to: "2026-11-01"`. The report gives, per listing and
   summed: reviews Google holds in the window (`window.google`), already held
   and linked (`alreadyHeld`), **missing** (`missing`), and needing a person
   (`needsReview`), plus `googleByMonth` / `missingByMonth`, discrepancies,
   `complete` (must be true for every listing; if not, raise
   `GBP_BACKFILL_MAX_PAGES`), and `projectedIfFull`.
2. **Resolve the ambiguous ones.** A person works the `needsReview` list (the ten
   timestamp-less September rows are expected there). Nothing is merged
   automatically.
3. **Fill the missing ones: a decision is required.** While Apify is enabled the
   integration deliberately cannot create rows (Apify does not know the official
   id, so a review created here and later re-read by Apify would be stored twice).
   Two ways forward:
   * **Path A (recommended; no new code):** after Apify is retired
     (`APIFY_SYNC_ENABLED` off), set `GBP_CREATE_NEW_REVIEWS=true` and
     `GBP_ALLOW_LIVE_BACKFILL=true`, re-run the dry run and read
     `projectedIfFull` for each listing (it must show 0 counted, or only reviews
     that genuinely sit above the anchor), then run the live backfill one listing
     first.
   * **Path B (not built; needs separate approval):** a guarded gap-fill that runs
     while Apify is on and creates only reviews older than each listing's Apify
     horizon. It still carries the re-read risk and would need its own design.
4. **Verify after any live write:** the fingerprint of the existing 194 reviews
   (same query used for the migration) is unchanged apart from the added rows;
   counted totals are still 33 / 34 unless `projectedIfFull` predicted otherwise;
   per-listing totals approach Google's `totalReviewCount`; no duplicate
   (same listing, reviewer, rating within a day) appears; dashboards spot-checked.

A backfill never rewrites an existing review's week, period or assignment: the
database function files known rows with no feed position (history), and rows it
creates are decided by the same anchor planner as every other source.

## Rollback

* `GBP_SYNC_MODE=off` stops all Google activity immediately; Apify was never
  stopped. Reviews already filed stay (they are ordinary rows under the same
  rules). Links are `gbp_*` columns only and can be cleared by an `update` of
  those columns without touching anything else.
* The migration is additive; nothing depends on it if the integration is off.
* Full rollback SQL (only if the migration must be removed; the enum value
  `gbp_api` cannot be dropped and is harmless):

```sql
begin;
drop function if exists public.gbp_apply_links(jsonb);
drop function if exists public.gbp_record_review_items(jsonb);
drop function if exists public.gbp_confirm_location_mapping(text, text, text, text, jsonb, text);
drop table if exists public.google_review_reconciliation_items;
drop table if exists public.google_review_gbp_sync_runs;
drop table if exists public.google_review_gbp_connections;   -- the sealed token (revoke the grant in Google first)
drop function if exists public.gbp_set_connection(text, text[], text);
drop function if exists public.gbp_end_connection(text, text, text);
drop function if exists public.gbp_claim_run(text, text);
alter table public.google_reviews
  drop column if exists gbp_review_name, drop column if exists gbp_review_id,
  drop column if exists gbp_link_method, drop column if exists gbp_linked_at,
  drop column if exists gbp_last_synced_at, drop column if exists gbp_create_time,
  drop column if exists gbp_update_time, drop column if exists gbp_reviewer_name,
  drop column if exists gbp_rating, drop column if exists gbp_comment,
  drop column if exists gbp_reply_text, drop column if exists gbp_reply_update_time;
alter table public.google_review_locations
  drop column if exists gbp_account_name, drop column if exists gbp_location_name,
  drop column if exists gbp_place_id, drop column if exists gbp_mapping_status,
  drop column if exists gbp_mapping_evidence, drop column if exists gbp_mapping_confirmed_at,
  drop column if exists gbp_mapping_confirmed_by;
drop type if exists public.google_review_gbp_mapping_status;
commit;
```

## Migration notes for production

* Every `ADD COLUMN` is nullable or has a constant default: metadata-only.
* The new CHECK constraints and unique indexes scan/lock `google_reviews`
  (~200 rows) for milliseconds. Not `CONCURRENTLY` because the table is tiny.
* `ALTER TYPE … ADD VALUE` runs inside the migration transaction (allowed on
  PG 12+, production is PG 17) because the value is not used in that transaction.
* Functions are `SECURITY INVOKER`, revoked from `public`/`anon`/`authenticated`;
  the new tables (including the sealed-token table) have RLS enabled with no
  policy and no browser-role privileges. A unique index allows one running sync
  at a time and one active connection.
* Re-runnable (`IF NOT EXISTS` / `DROP … IF EXISTS`); verified by applying twice.

## Retiring Apify (only after verified production use)

1. Run both sources side by side for an agreed period; confirm zero
   `needs_review` backlog and no discrepancies unaccounted for.
2. Set `APIFY_SCHEDULE_ENABLED=false`, then `APIFY_SYNC_ENABLED=false`.
3. Remove the Apify cron entry from `vercel.json`; remove `APIFY_*` and
   `APIFY_WEBHOOK_SECRET` from Vercel; revoke the token in Apify.
4. Delete `src/lib/reviews/apify`, the Apify routes and screens in a separate PR.
5. Keep the `apify_*` columns and `google_review_apify_runs` as history.

## Known limits

* Brave-only historical rows have no timestamp, so they can only be linked by a
  person. Expect a manual-review backlog on first reconciliation.
* **Unverified against Google's live documentation** (the sandbox could not
  reach developers.google.com): the v4 `reviews.list` default sort order
  (`updateTime desc` — `orderBy` is deliberately not sent), the notification
  message field names (`reviewName`/`locationName`; several spellings are
  accepted), and the exact `PATCH …/notificationSetting` request. The first
  dry run and the first test notification will confirm them.
* `UPDATED_REVIEW` edits to a stored review's text are surfaced as discrepancies
  rather than applied, while Apify is still a live source (to avoid the two
  sources overwriting each other).
