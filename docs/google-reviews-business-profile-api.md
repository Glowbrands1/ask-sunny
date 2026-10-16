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

## Google Cloud configuration required

1. A Google Cloud project with the Business Profile APIs **approved** for it
   (the access request must be granted; unapproved projects get quota 0 / 403):
   * My Business Account Management API
   * My Business Business Information API
   * Google My Business API (v4 — the surface that serves reviews)
   * My Business Notifications API
2. OAuth consent screen + an OAuth client (web). Authorise with scope
   `https://www.googleapis.com/auth/business.manage` as a user who manages the
   Glow Brands profile; keep the resulting **refresh token** (offline access).
   Publish the consent screen to production, or refresh tokens expire in 7 days.
3. Pub/Sub: a topic; grant `mybusiness-api-pubsub@system.gserviceaccount.com`
   the Publisher role on it; a **push** subscription to
   `https://<production host>/api/reviews/gbp/pubsub` with OIDC authentication
   (a service account you create, and an audience equal to that URL).
4. Point Google at the topic: admin action `configure_notifications`
   (`NEW_REVIEW`, `UPDATED_REVIEW`), once per account.

## Vercel environment variables (names only)

`GOOGLE_GBP_CLIENT_ID`, `GOOGLE_GBP_CLIENT_SECRET`, `GOOGLE_GBP_REFRESH_TOKEN`
(mark Sensitive), `GBP_SYNC_MODE`, `GBP_PUBSUB_AUDIENCE`,
`GBP_PUBSUB_SERVICE_ACCOUNT`, `GBP_PUBSUB_TOPIC`; optional `GBP_CREATE_NEW_REVIEWS`, `GBP_ALLOW_LIVE_BACKFILL`,
`GBP_INCREMENTAL_MAX_PAGES`, `GBP_BACKFILL_MAX_PAGES`, `GBP_MAX_REQUESTS_PER_RUN`.
`CRON_SECRET` already exists. **Preview deployments share the production
database** (same `NEXT_PUBLIC_SUPABASE_URL`), so do not add these to Preview.

## Production rollout

1. Review and merge the PR (this adds one inert cron entry to `vercel.json`).
2. Apply `20261016001000_google_review_business_profile_api.sql` (additive,
   re-runnable). Run `supabase/tests/gbp_schema_checks.sql` against a throwaway
   cluster first.
3. Add the Google variables with `GBP_SYNC_MODE=dry_run`.
4. Admin `discover`; review proposals and `missing`; `confirm` each `eligible`
   listing; resolve `needs_review`/`conflict` by hand.
5. Admin `dry_run` (incremental, then backfill). Review: per-listing counts vs
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
  the new tables have RLS enabled with no policy and no browser-role privileges.
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
