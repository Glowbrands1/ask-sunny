# Production release — 2026-09-09

The first release of the report-intelligence work to Production. This is the
record of what was released, what was checked before it went, and what could
not be checked from where the release was run.

## Refs

| | |
|---|---|
| Release SHA | `0322c12c52cafdf72aba693a5d20061b5c826bae` |
| Previous `main` | `dc1646c4cbf6a05010b2bde1796af67bab56cdab` |
| Release candidate branch | `feature/ask-sunny-forms-template-engine` |
| Commits released | 97 |

`main` was an ancestor of the release SHA and the branch was **97 ahead / 0
behind**, so the release was a **fast-forward with no merge commit**. The push
reported `dc1646c..0322c12` — no force, no `+`. Nothing follows the approved SHA
on `main`: `0322c12..origin/main` is empty.

Reproduce the verification:

```
git merge-base --is-ancestor origin/main <release-sha>   # must succeed
git rev-list --left-right --count origin/main...<release-branch>   # must be 0 <n>
git merge --ff-only <release-branch>                     # must not create a commit
```

## Gate at the release SHA

4452 tests passed, 20 skipped. TypeScript clean, lint clean, build clean. The
gate was run after the last merge from a concurrent session, not before it.

## Database

**21 migrations** were added between `dc1646c` and `0322c12`, and runtime code
requires all of them — the Forms engine, `app_users`, invitation acceptance,
training videos, Sales Totals ingestion completion, and the whole Bed/Spa
reporting family.

All 21 are applied on the authorized project the release was tested against.
Three migration filenames did not name-match the applied list:

| On the branch | Applied as |
|---|---|
| `reporting_bed_spa_ingest_functions` | `reporting_bed_usage_ingest_function`, `reporting_spa_wellness_ingest_function`, `reporting_spa_engagement_ingest_function` (one file, three functions) |
| `reporting_restore_ingestion_parsing_status` | `restore_ingestion_parsing_status` |
| `sales_totals_ingest` | `sales_totals_ingest_function` |

These were checked **by object existence rather than by filename**, which is the
check that actually matters: `upsert_bed_spa_period`,
`complete_bed_usage_ingestion`, `complete_spa_wellness_ingestion` and
`complete_spa_engagement_ingestion` are all present. The stronger evidence is
that the release branch's own code had been reading and writing that schema
throughout QA — all five report families, Forms, `app_users`, Knowledge and
Videos all queried successfully.

No migration was run as part of this release, and nothing destructive was run.

**Open caveat, stated rather than assumed.** The release was run from an
environment that could not read Production's Supabase URL, and only one Supabase
project was visible to it. Whether Production points at the project the release
was tested against was therefore **not verified**. If Production uses a different
database, its schema is unconfirmed by this release record.

## Environment variables

Names only. No value, key or URL is recorded here, and none was read.

Required in live mode:

- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`)
- **Anthropic** — `ANTHROPIC_API_KEY`
- **Auth / site** — `ASK_SUNNY_SITE_URL`, `NEXT_PUBLIC_SITE_URL`
- **Mode** — `NEXT_PUBLIC_DEMO_MODE` must be exactly `"false"`

Optional:

- `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` — defaults live in `src/lib/config/models.ts`
- `REPORTING_INGEST_SECRET` — required only by the ingestion route
- **`NEXT_PUBLIC_BUSINESS_TIMEZONE`** — **new in this release and NOT required.**
  It defaults to `America/New_York`, so Production needed no environment change
  for it. See `.env.example`.

`NEXT_PUBLIC_DEMO_MODE` is the one worth checking first. Anything other than the
exact string `"false"` — including unset — selects demo mode, and this release
makes that more visible: the Overview's seeded cards now render only in demo
mode. Production showing demo content points at that variable, not at the
release.

Presence was **not verified** from the release environment (see below). No
environment variable was modified.

## What could not be verified from the release environment

The session that ran this release had no network route to Vercel: egress
returned `403` on CONNECT for both `*.vercel.app` and `vercel.com`, and the
Vercel API returned `403 Forbidden` on listing deployments. So:

- **the Production build was not confirmed to have started**, and
- **Production environment variable presence was not confirmed.**

Neither was worked around. No older Preview deployment was promoted. Both need a
manual check in the Vercel dashboard: confirm Production is building from
`0322c12`, and confirm `NEXT_PUBLIC_DEMO_MODE=false` for the Production
environment.

## Notable behaviour in this release

Three things a reader of the Production diff should know about, because each
changes what the app *says* rather than only what it computes:

1. **A window a report cannot answer is no longer reported as a missing
   delivery.** Asking for a twelve-month window used to make the prompt claim
   Sales Totals had no current delivery while the freshness block simultaneously
   named its newest figures. See `report-briefing.ts`.

2. **Every report family now carries both its as-of date and its load
   timestamp.** Salon Performance previously carried only the first, on the
   family most likely to be stale.

3. **The Overview no longer presents seeded prototype content as live company
   data**, and the greeting no longer comes from the frozen demo clock. Seeded
   content renders in demo mode only.

## Still open after this release

Not blockers, recorded so they are not lost:

- The Employee Performance Framework knowledge document is **untagged** and
  resolves by filename/title fallback. That role fails closed, so a rename or
  re-upload would make it refuse employee-performance answers. Tagging it
  `employee-performance-framework` removes the fragility.
- The Overview's "Recommended training" and "Latest knowledge updates" cards
  still read the seeded client store, so in live mode their links point at demo
  document ids that do not exist.
- Wiring real measures into the Overview's Daily Stats card needs a decision
  about *which* measures: the four the seeded grid showed are not measures any
  ingested report carries.
- Browser QA of the five report tabs, the five manager questions and the
  Coaching v3 follow-up thread has never been run against a logged-in
  deployment, from any session so far.
