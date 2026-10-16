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

## Safety switches

| Variable | Effect |
| --- | --- |
| `GBP_SYNC_MODE` unset / `off` | Everything inert. Routes answer `disabled`; no Google call, no DB access. |
| `dry_run` | Reads Google and the DB, returns the report, **writes nothing** (not even a ledger row). Forces dry run even if `live` is requested. |
| `live` | Files reviews. Admin `sync` and cron/Pub/Sub require this. |
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
`GBP_PUBSUB_SERVICE_ACCOUNT`, `GBP_PUBSUB_TOPIC`; optional `GBP_ALLOW_LIVE_BACKFILL`,
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
6. Only after sign-off: `GBP_SYNC_MODE=live`, run one listing, verify, then all.
   Keep Apify running throughout.
7. Configure notifications and the Pub/Sub subscription; verify a real new review
   arrives through the push path and the cron path finds nothing missing.

## Rollback

* `GBP_SYNC_MODE=off` stops all Google activity immediately; Apify was never
  stopped. Reviews already filed stay (they are ordinary rows under the same
  rules). Links are `gbp_*` columns only and can be cleared by an `update` of
  those columns without touching anything else.
* The migration is additive; nothing depends on it if the integration is off.

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
* Notification routing and the Reviews API (v4) are Google-side; their exact
  availability for this project is unverified until a live call is made.
* `UPDATED_REVIEW` edits to a stored review's text are surfaced as discrepancies
  rather than applied, while Apify is still a live source (to avoid the two
  sources overwriting each other).
