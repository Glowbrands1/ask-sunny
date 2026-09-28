# Woven → Ask Sunny employee sync (phase one)

**Status: prepared, not live.** The code, migration and tests are on branch
`claude/fervent-cori-emzwrn`. Nothing is merged, deployed, scheduled or applied.
The Woven Operations API subscription "Ask Sunny employee sync" is pending
approval, so no request has reached Woven yet.

The remaining work is: enter credentials, validate a live response (§7), apply
the migration (§8), run manual syncs, then enable the schedule. Each of those
steps needs explicit approval.

---

## 1. What phase one does, and what it does not

**Does**
- Reads Woven employees (active **and** terminated) through the Operations API. GETs only; the single POST is the `/tokens/v2` token exchange.
- Keeps an allowlisted copy in `employee_access_directory`, keyed on `(source_system, external_employee_id)`.
- Detects and records changes between syncs in `employee_directory_changes` (append-only).
- Records every run in `employee_sync_runs`, with counts and a failure code. That gives the last successful sync timestamp and surfaces errors.
- Queues every Woven location it sees in `woven_location_map` as `unmapped`, for a person to map to an Ask Sunny salon.

**Does not**
- Change `app_users`, a role, a `scope_level`, `scope_primary_area_id`, `scope_also_covers_area_ids`, a salon assignment, a login, Supabase Auth, or any existing RLS policy or grant.
- Disable a terminated employee's login. Termination is **recorded** only.
- Delete anybody. Absence from a read raises `missing_sync_count`; it is never treated as termination.
- Call a position change a promotion. It is `position_changed` with `direction: "unclassified"`.
- Write anything to Woven, scrape the Woven UI, or ingest Woven knowledge content (see `docs/woven-knowledge-sync-design.md`).

`docs/HANDOFF.md` says "There is no employee directory, and none should be
invented." This work is the deliberate exception, sourced from Woven rather
than invented, and it needs approval before the migration is applied.

## 2. Architecture

```
Vercel Cron (not yet scheduled) ──GET, Bearer CRON_SECRET──┐
Admin (manage_integrations) ──POST, dry run by default─────┤
                                                           ▼
                           src/lib/employees/woven/sync.ts  (Next.js server, Node runtime)
                             │  WovenClient — server-only, GET-only, paced, retried
                             ▼
                  Woven Operations API  https://gateway-api.woven.team/api
                             │
                             ▼  one transaction per run (employee_sync_commit_run)
                  Supabase: employee_access_directory, employee_directory_changes,
                            employee_sync_runs, woven_location_map
                             │
                             ▼  (later phases, separately approved)
                  Ask Sunny UI / permissions / reporting
```

It uses **existing infrastructure only**: a Next.js route handler plus a Vercel
Cron entry, which is exactly how the Google review Apify sync runs
(`/api/reviews/apify/cron`). A Supabase Edge Function was not chosen, for two
reasons:
- The only existing Edge Function is the embedder.
- pg_cron and pg_net are not installed.

So an Edge Function would add a second runtime, a second secret store and a
second deployment path for no benefit. The browser never calls Woven.

### Files

| Path | Role |
|---|---|
| `src/lib/employees/woven/contract.ts` | **Every assumed Woven name** (headers, paths, query params, field aliases, status values). The one file to correct after live validation. |
| `src/lib/employees/woven/config.ts` | Environment variables, both switches, bounds. Server-only. |
| `src/lib/employees/woven/client.ts` | The API client: token exchange and caching, refresh, one re-login on 401, 403 handling, 429 with `Retry-After`, 5xx/timeout/network retries (bounded), pacing under ~100 req/min, a time budget, pagination that reads to an empty page and detects an ignored `queryskip`. Read-only by construction; it never logs. |
| `src/lib/employees/woven/normalize.ts` | The strict allowlist, built field by field. |
| `src/lib/employees/woven/diff.ts` | Pure change detection and the record hash. |
| `src/lib/employees/woven/sync.ts` | The orchestrator: claim, read, prove completeness, details within budget, diff, one commit. |
| `src/lib/employees/woven/store.ts` | The only door into Supabase, calling the migration's functions. |
| `src/lib/employees/woven/locations.ts` | The location crosswalk: list and review. |
| `src/lib/employees/woven/status.ts` | Sync status for administrators: counts and codes only. |
| `src/app/api/employees/woven/cron/route.ts` | Scheduled entry point. **Not in `vercel.json`.** |
| `src/app/api/admin/employees/woven/sync/route.ts` | POST runs a manual sync (dry run unless `{"dryRun": false}`); GET returns status. |
| `src/app/api/admin/employees/woven/locations/route.ts` | GET lists Woven locations; PATCH maps, ignores or unmaps one. |
| `src/lib/api/cron-auth.ts` | `CRON_SECRET` bearer check for new cron routes. The Apify route is untouched. |
| `supabase/migrations/20260928001000_woven_employee_directory.sql` | The schema. **Not applied.** |
| `scripts/verify-woven-migration.mjs` | Runs the migration on a local Postgres (PGlite) and checks 64 behaviours. |
| `src/lib/employees/woven/live-probe.dry-run.test.ts` | The live read-only probe (`npm run probe:woven`); skipped unless `WOVEN_LIVE_PROBE=1`. |

## 3. Data model

All four tables have RLS **enabled and forced with no policies**, and every
privilege is revoked from `anon` and `authenticated`. Every function is revoked
from `public`, `anon` and `authenticated`. Only the server, using the secret
key, can reach them. That matches the rest of the schema (HANDOFF §3).

The existing tables were reviewed first, and none holds employees. `app_users`
is the login table, keyed to `auth.users` with no HR identifier, and phase one
must not alter it. `app_user_audit` accepts only invite, role and status
actions. So there was nothing to reuse, and these four tables duplicate
nothing. The design follows the table sketched in
`docs/employee-lifecycle-feasibility-2026-09-22.md`.

### `employee_access_directory`

One row per Woven employee. Unique on `(source_system, external_employee_id)`.

| Column | Notes |
|---|---|
| `external_employee_id` | Woven's employee id. Pattern-checked. |
| `first_name`, `last_name`, `preferred_name` | |
| `work_email` | Lower-cased and not unique. Duplicates are flagged, not resolved. |
| `employment_status` | `active`, `terminated` or `unknown`. `unknown` is never treated as terminated. |
| `hire_date`, `termination_date` | |
| `position_id`, `position_name` | |
| `primary_woven_location_id`, `primary_location_name` | |
| `woven_location_ids text[]` | GIN-indexed, for filtering. |
| `location_affiliations jsonb` | `{woven_location_id, location_name, kind: primary\|additional\|temporary, starts_on, expires_on}`. |
| `affiliations_verified_at` | When the full affiliation list was last read. Null means only the primary location is known. |
| `data_issues text[]` | Codes only. |
| `record_hash` | |
| `first_seen_*`, `last_seen_*`, `content_changed_at` | |
| `missing_sync_count` | |

There is no column for pay, date of birth, a personal phone, an address,
emergency contacts, I-9 or background data, notes, documents, banking, payroll
or leave data.

### `employee_directory_changes`

Append-only: a trigger refuses UPDATE and DELETE, except on the review fields
(`review_status`, `reviewed_by`, `reviewed_at`).

Each row holds `change_kind`, `from_value`, `to_value`, `details`, the
`sync_run_id` and the employee.

### `employee_sync_runs`

- **Run lock:** at most one `running` row per source, enforced by a partial unique index. A run left `running` for more than 15 minutes is marked `failed/stale_run` by the next claim.
- **Counts:** received, active, terminated, created, updated, unchanged, missing, details fetched and skipped, changes, unmapped locations.
- **Issues and errors:** `issue_counts`, plus an `error_code` and `error_detail` on a failed or rejected run.

### `woven_location_map`

Woven location id → `salons.id`, with a status of `unmapped`, `mapped` or
`ignored`.
- A constraint makes `mapped` require a salon.
- The sync only ever adds rows. It never changes a status or a salon.
- A person maps a location with `woven_location_map_review(…, salon_number, reviewer)`, through `PATCH /api/admin/employees/woven/locations`.

### Views

- `employee_sync_status`: the last run, the last **successful** run, the unmapped location count and the unreviewed change count.
- `employee_directory_login_matches`: directory rows whose work email matches an `app_users` email. Read-only; it links and grants nothing. It exists so a person can review matches before any login decision.

## 4. Field mapping, Woven → Ask Sunny

| Woven | Ask Sunny (phase one) | Notes |
|---|---|---|
| Employee ID | `employee_access_directory.external_employee_id` | The stable identity. Never the email, never the name. |
| Work email | `work_email` | Only from the work-email field; a plain `Email` key is deliberately not read. Optional domain allowlist (`WOVEN_WORK_EMAIL_DOMAINS`). **Not linked to `app_users.email`** in phase one; `employee_directory_login_matches` shows candidate matches for review. |
| Status (Active/Terminated) | `employment_status` | Only `active`/`employed`/`current` and `terminated`/`termed`/`separated` are recognised. Everything else, **including `Inactive`**, is `unknown`. |
| HireDate / TerminationDate | `hire_date` / `termination_date` | The .NET unset date `0001-01-01` is read as null. |
| PositionID / PositionName | `position_id` / `position_name` | **Not mapped to a role or `scope_level`.** |
| PrimaryLocationID / Name | `primary_woven_location_id` / `primary_location_name` | Salon resolved only through `woven_location_map`. |
| Details `Locations[]` | `location_affiliations`, `woven_location_ids` | `kind` is `temporary` when Woven marks it borrowed or temporary, or when it has an expiry. |
| Woven login role | Not stored | Woven's own role says what a user can do *in Woven*, not in Ask Sunny. |

### Ambiguous or unconfirmed mappings

These need a person to decide; they are not guessed.

1. **PositionID → ASD / SD / DM / RM.** No mapping exists in Ask Sunny, and live data contradicts the obvious convention: the one regional manager has salon scope. The PositionID list and its intended role or scope must come from the business. A future `position_role_map` table would hold it, and an unmapped position would grant nothing.
2. **Position hierarchy.** Whether a PositionID change is upward or downward is unknown. Changes stay `unclassified` until a hierarchy is approved.
3. **Woven location id → salon.** Nothing is assumed. The Google store codes proved that ids from different systems do not line up.
4. **Woven "location affiliations" vs Ask Sunny `scope_also_covers_area_ids`.** Woven affiliations say where someone can *view or work*; Ask Sunny's list is an access grant. They are stored separately and must not be treated as the same thing without a decision.
5. **District and region.** Ask Sunny's districts come from manager names in reporting workbooks. Woven may carry its own grouping; any reconciliation is a later phase.
6. **Which system owns termination** (Woven vs payroll) and the acceptable delay before access changes. The feasibility study's open questions 1 and 8 still apply before any automatic disabling is built.
7. **`Email` vs `WorkEmail`.** If the live response carries the work address under `Email`, add that alias in `contract.ts` knowingly.

## 5. Change detection

| Kind | When | Notes |
|---|---|---|
| `new_employee` | Not on file | `initialLoad: true` on the very first sync. |
| `terminated` | Now terminated, previously not | `accessChanged: false` |
| `reactivated` | Now active, previously terminated | |
| `position_changed` | New non-null PositionID differs | `direction: "unclassified"`. A missing PositionID is an issue, not a change; a rename of the same id is not a change. |
| `primary_location_changed` | New non-null primary differs | `classification: "transfer"` (or `"assigned"` if there was none) |
| `location_affiliation_added` / `removed` | Compared **only when this run read the full list** | `temporary` noted in `details` |
| `work_email_changed` | New non-null email differs | `loginLinkChanged: false` |
| `missing_from_source` | Absent from 3 consecutive syncs | Recorded once; status unchanged |

A re-run with unchanged data records nothing. The unit tests prove this, and
the Postgres check proves it for the functions.

### Completeness: when a run is refused

A refused run writes nothing but its own run row. The refusal codes are:

- `empty_read`: Woven returned no employees at all.
- `count_mismatch`: fewer records arrived than Woven reported.
- `mostly_unreadable`: more records lacked an employee id than had one.
- `unexpectedly_small`: fewer actives arrived than `WOVEN_MIN_COMPLETENESS_PERCENT` (default 80%) of those on file. This applies once 10 or more actives are on file.

A page that keeps failing, or any Woven or save failure, fails the whole run
with the same guarantee.

Employee **details** are an enrichment, read within a per-run budget with the
least-recently-verified employees first. If a details read fails, those
employees keep the affiliations already on file. The run is not failed, and no
removal is recorded.

## 6. Environment variables (Vercel, all server-only, "Sensitive")

| Name | Needs a value | Notes |
|---|---|---|
| `WOVEN_SUBSCRIPTION_KEY` | **Yes, once approved** | API portal key for the "Ask Sunny employee sync" subscription |
| `WOVEN_USERNAME` | **Yes** | Woven application user for `/tokens/v2` |
| `WOVEN_PASSWORD` | **Yes** | That user's password |
| `WOVEN_SYNC_ENABLED` | Yes (`true`) when validating | Master switch; default off |
| `WOVEN_SYNC_SCHEDULE_ENABLED` | Only when the schedule is approved | Default off |
| `WOVEN_API_BASE_URL` | No | Defaults to `https://gateway-api.woven.team/api` |
| `WOVEN_PAGE_SIZE` | No | Default 100 |
| `WOVEN_MAX_DETAIL_REQUESTS_PER_RUN` | No | Default 150 |
| `WOVEN_MIN_COMPLETENESS_PERCENT` | No | Default 80 |
| `WOVEN_WORK_EMAIL_DOMAINS` | Recommended | e.g. the company's work domains |
| `CRON_SECRET` | Already set (Production and Preview) | Shared with the Google review cron |

## 7. Validating the live API once Woven approves

Do these steps in order. Every step is read-only against Woven.

1. **Check the subscription and key.** In the Woven API portal, confirm the subscription is **Approved** and copy its key. Confirm which application user it is for.
2. **Run a local probe, with nothing stored.** From a checkout of the branch, with the values in your shell only:
   ```
   WOVEN_LIVE_PROBE=1 WOVEN_SYNC_ENABLED=true \
   WOVEN_SUBSCRIPTION_KEY=… WOVEN_USERNAME=… WOVEN_PASSWORD=… \
   npm run probe:woven
   ```
   It prints key names, status values, page behaviour and a dry-run summary. It prints no personal values and needs no Supabase.
3. **Read the probe output against `contract.ts`:**
   - Token: if the probe fails with `woven_auth_failed` on `/tokens/v2`, the body key names in `tokenRequestBody` are the first thing to fix.
   - `shape` must not be `UNRECOGNISED`. If it is, add the envelope key to `PAGE_ITEM_KEYS`.
   - `received` should equal `askedFor` (5) on a large pass. If it is lower, the gateway caps `querytake` and pagination still works, but set `WOVEN_PAGE_SIZE` to the cap.
   - `statusValues`: every value must map to active or terminated in `contract.ts`, or be deliberately `unknown`.
   - `contractKeysAbsent` should be empty for employeeId, firstName, lastName, workEmail, status, hireDate, positionId, positionName and primaryLocationId. Fix the aliases for any that are listed.
   - `keysNotMappedByContract` shows what else Woven sends. Confirm none of it belongs in the allowlist, and add nothing sensitive.
   - `details.locationsArray` should be `present`, and `locationEntryKeys` should include the location id, primary, borrowed/temporary and expiry fields.
   - `dryRun.summary.fieldCoverage` should be close to `employeesReceived` for workEmail, positionId and primaryLocationId.
4. **Confirm the filters.** Confirm the `status` filter really separates Active from Terminated: the counts should differ, and `duplicate_across_passes` should be about 0. If they do not differ, the filter's parameter name or values in `contract.ts` are wrong.
5. **Check the volume.** Note `employeesTerminated` and `requestsMade`. Every run re-reads the whole terminated history, and the save sends every employee in one call. A few thousand rows is comfortable. If the terminated pass is far larger, or the dry run approaches the route's 300-second limit, raise `WOVEN_PAGE_SIZE` or discuss limiting the terminated pass by date before scheduling.
6. **Fix and re-run.** Correct `contract.ts`, add a fixture for the real shape to `test-support.ts`, run `npm test`, then re-run the probe.

## 8. Before merge and deployment (each step needs approval)

1. **Review** the branch diff, including this document and the migration.
2. **Gate:** run `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` (see the report for the current results).
3. **Migration pre-check:** `npm install --no-save @electric-sql/pglite && npm run verify:woven-migration`, which runs 64 checks against Postgres 17.
4. **Merge** through a PR, following the repository's normal flow. Production reads the same Supabase project as Preview, so a deployment carrying this code is harmless while `WOVEN_SYNC_ENABLED` is off and the migration is not applied.
5. **Apply the migration**, with approval, verbatim in one transaction, to Ask Sunny Dev `rbkylaavthsjepsczccv`. Because Production reads that project, **this is a production schema change.** It is additive only: it creates new objects and alters none.
6. **Run the Supabase advisors** (security and performance) after applying.
7. **Add the Vercel variables** from §6 as **Sensitive**: Preview first, then Production.
8. **Run a manual dry run** on a deployment whose `NEXT_PUBLIC_DEMO_MODE` is false. The admin routes refuse in demo mode, like the Apify admin routes. Sign in as an admin and call `POST /api/admin/employees/woven/sync` with `{}`. Read the summary.
9. **Run a manual real run** with `{"dryRun": false}`. Check `GET /api/admin/employees/woven/sync`, then check the tables:
   - rows in `employee_access_directory`;
   - `new_employee` changes with `initialLoad: true`;
   - locations queued in `woven_location_map`.
10. **Map the locations** with `PATCH /api/admin/employees/woven/locations`, one by salon number. Unmapped locations never block a sync.
11. **Run a second manual real run.** Expect zero changes, and `employees_unchanged` equal to `employees_received`.
12. **Schedule it (separate approval).** Add to `vercel.json` `crons`:
    ```json
    { "path": "/api/employees/woven/cron", "schedule": "30 10 * * *" }
    ```
    That is daily at 10:30 UTC (about 05:30 US Central). Then set `WOVEN_SYNC_SCHEDULE_ENABLED=true` and redeploy. Once a day is enough while nothing acts on the data; a shorter interval can be discussed if termination latency starts to matter.

## 9. QA checklist

Legend:
- ✅ **unit**: covered by the Vitest suite against the fake Woven API and the in-memory store.
- ✅ **pg**: covered by `scripts/verify-woven-migration.mjs` against real Postgres.
- ☐ **live**: must be checked against the real API or a deployment.

| Scenario | Status |
|---|---|
| Active employee sync | ✅ unit · ☐ live |
| Terminated employee sync (separate pass) | ✅ unit · ☐ live (confirm the filter) |
| New employee | ✅ unit |
| Existing employee update | ✅ unit · ✅ pg |
| Position change (never "promotion") | ✅ unit |
| Location transfer | ✅ unit |
| Multiple locations | ✅ unit · ☐ live (details shape) |
| Temporary / borrowed location | ✅ unit · ☐ live (field names) |
| Missing email | ✅ unit |
| Duplicate email | ✅ unit |
| Missing PositionID | ✅ unit |
| Missing location | ✅ unit |
| API pagination (including a capped page and an ignored skip) | ✅ unit · ☐ live |
| API failure (5xx, network, timeout) | ✅ unit |
| Rate limiting (429, Retry-After, pacing ≤100/min) | ✅ unit |
| Partial sync failure leaves the directory untouched | ✅ unit · ✅ pg (atomic commit) |
| Credential failure (401, 403, not approved) | ✅ unit · ☐ live (403 before approval) |
| Token expiry and refresh | ✅ unit · ☐ live (real lifetime) |
| Unexpectedly small sync refused | ✅ unit |
| Employee missing from one run kept | ✅ unit · ✅ pg |
| Re-running the same sync: no duplicates, no changes | ✅ unit · ✅ pg |
| Sensitive fields never stored | ✅ unit · ☐ live (review `keysNotMappedByContract`) |
| No credentials in source | ✅ (grep in the report) |
| No impact on Ask Sunny authentication | ✅ unit (source scan) · ✅ pg (`app_users` unchanged) · ☐ sign-in smoke test on Preview |
| No impact on DM/SD/ASD permissions | ✅ unit (no role or scope reference) · ☐ spot-check a DM and an SD on Preview |
| Scheduled route locked (CRON_SECRET, both switches) | ✅ unit |
| Schedule not enabled | ✅ unit (`vercel.json` has no Woven entry) |

## 10. Later phases (not built)

Each of these needs its own approval.

- A PositionID → role and scope mapping table, and a position hierarchy that could classify promotions.
- Linking directory rows to `app_users`, by a confirmed email match reviewed by a person.
- Acting on a termination: disabling a login after the approved delay, perhaps with the consecutive-miss safeguard.
- An admin screen for sync status, the location crosswalk and the change review queue. The routes already exist.
- Woven knowledge content, only through a supported API (`docs/woven-knowledge-sync-design.md`).
