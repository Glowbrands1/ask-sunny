# Woven → Ask Sunny employee sync (phase one)

**Status: prepared and awaiting a live check. Not live.** The code, migration
and tests are on branch `claude/fervent-cori-emzwrn`. Nothing is merged,
deployed, scheduled or applied.

The Woven API portal shows the **"Ask Sunny employee sync" Operations API
subscription as Active**, as reported by an administrator on 28 September 2026.
No request from Ask Sunny has reached Woven yet, so sign-in, the real response
shapes and field coverage are all **unverified** until the read-only live check
(§7) runs.

The portal documents employee reads through `GET /employees`. It does **not**
establish employee-change webhooks, so the sync polls.

The remaining work is, each step needing explicit approval:
1. Configure credentials (§6).
2. Run the read-only live check and correct `contract.ts` from it (§7).
3. Apply the migration.
4. Run a preview sync, then the first real sync.
5. Map the salons.
6. Schedule the daily sync (§8).

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
| `supabase/migrations/20260928002000_woven_employee_directory.sql` | The schema. **Not applied.** |
| `scripts/verify-woven-migration.mjs` | Runs the migration on a local Postgres (PGlite) and checks 64 behaviours. |
| `src/lib/employees/woven/validate.ts` | The read-only live check: aggregates, key names and findings against `contract.ts`. |
| `src/app/api/admin/employees/woven/validate/route.ts` | POST runs the live check (admin only, live mode only, master switch). |
| `src/features/admin/woven/` | The Admin → Integrations → Woven Employee Sync screen and its check panel. |
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

## 6. Credentials: which variables, and where they go

All are **server-only**. None is ever `NEXT_PUBLIC_`. None is committed,
printed, logged, returned by a route, or written to the database.

| Name | Value | Notes |
|---|---|---|
| `WOVEN_SUBSCRIPTION_KEY` | The subscription's **primary** key from the Woven API portal | Sent as the `Subscription-Key` header |
| `WOVEN_USERNAME` | The Woven **application user** (see §6.1) | For `POST /tokens/v2` |
| `WOVEN_PASSWORD` | That user's password | Not trimmed; enter it exactly |
| `WOVEN_SYNC_ENABLED` | `true` | Master switch. Nothing reaches Woven while it is off, not even the check |
| `WOVEN_WORK_EMAIL_DOMAINS` | The company's work domains, comma-separated | **Set before any real sync.** Without it, a personal address typed into Woven's work-email field would be copied. The live check lists the domains it sees, with counts, to help choose. |
| `WOVEN_SYNC_SCHEDULE_ENABLED` | Leave unset | Only for the approved schedule (§8) |
| `WOVEN_API_BASE_URL`, `WOVEN_PAGE_SIZE`, `WOVEN_MAX_DETAIL_REQUESTS_PER_RUN`, `WOVEN_MIN_COMPLETENESS_PERCENT` | Leave unset unless the check says otherwise | Defaults: the documented gateway, 100, 150, 80 |
| `CRON_SECRET` | Already set in Production and Preview | Reused; nothing to add |

### Where to enter them: three options, pick one for the live check

**A. Vercel Preview, scoped to this branch (recommended).** This is how the
admin screen's **Run read-only check** button works.
1. In Vercel, open project **ask-sunny** → **Settings** → **Environment Variables** → **Add**.
2. Tick **Sensitive**. Tick **only Preview** as the environment, and set **Git branch** to `claude/fervent-cori-emzwrn`.
3. Add `WOVEN_SUBSCRIPTION_KEY`, `WOVEN_USERNAME`, `WOVEN_PASSWORD` and `WOVEN_SYNC_ENABLED=true`.
4. If this branch's preview runs in demo mode (the screen says so, and the check refuses to run), also add a branch-scoped Preview `NEXT_PUBLIC_DEMO_MODE=false`. Then sign in with a real admin account.
5. Redeploy the branch's latest preview (Deployments → ⋯ → Redeploy). Environment changes only apply to new deployments.

This touches neither Production's variables nor the database. Preview reads the
shared Ask Sunny Dev database, but the check writes nothing to it.

**B. Your own terminal.** Run from a checkout of the branch, with the values
typed into the shell and never saved to a file:
```
read -rs WOVEN_SUBSCRIPTION_KEY && export WOVEN_SUBSCRIPTION_KEY
read -r  WOVEN_USERNAME         && export WOVEN_USERNAME
read -rs WOVEN_PASSWORD         && export WOVEN_PASSWORD
WOVEN_LIVE_PROBE=1 WOVEN_SYNC_ENABLED=true npm run probe:woven
```
It prints the same report as the button. It needs no Supabase.

**C. This Claude Code cloud environment.** This lets Claude run the check and
fix `contract.ts` directly. Add the three values as environment secrets in the
environment's settings, and add `gateway-api.woven.team` to its allowed network
domains. A new session picks them up. The credentials then live in that
environment's configuration, so treat this as the least preferred option.

Never paste a key or password into chat, a ticket, a commit or a screenshot.

### 6.1 Which Woven application user

**Use a dedicated, non-personal integration user, not a person's own account.**
A personal account causes four problems:
- **Too much access.** Its token carries that person's full permissions, which for an administrator include pay rates, background checks and secure documents.
- **Fragile.** A password change, an MFA prompt or the person leaving breaks the sync.
- **Misleading audit trail.** Woven's records would attribute the integration's reads to the person.

What the Woven audit showed:
- **Security** roles have an authority level and per-section permissions.
- **Team Member** permissions can be No Access, Read-Only or Full Access, with separate controls for access management, background checks, employment verification, notes, pay rates, secure documents, termination and reports.
- Visibility follows role **and** location affiliations.

So the recommended setup is:
- **User:** "Ask Sunny Integration", on a shared mailbox the company controls. No MFA or SSO, if Woven allows that for API users.
- **Role:** "Ask Sunny API (read-only)", with Team Member set to **Read-Only**.
- **No Access** to access management, background checks, employment verification, notes, pay rates, secure documents, termination and reports. Every other section is No Access as well.
- **Location affiliations: all locations.** A user affiliated with fewer would silently return a partial estate. The sync's completeness check refuses large drops, but it cannot see salons that were never visible.

**Not yet confirmed. Ask Woven** (§6.2 below):
- Whether `/tokens/v2` accepts such a user.
- Whether API reads are limited by the user's role and location affiliations.
- Whether any API-only or read-only scope exists.

The live check also **tests** this directly. It lists every returned key whose
name looks like sensitive HR data (`sensitiveKeysReturned`). With a properly
scoped user that list should be empty. If it is not, the API is not honouring
the role; Ask Sunny still discards those fields.

Until Woven confirms these points, the first read-only check can run with a
dedicated user even if its scoping is unproven. That is still safer than a
personal account.

### 6.2 Questions for Woven support (employee API)

1. Can a dedicated, non-personal application user authenticate with `POST /tokens/v2`? What role or licence does it need? Is MFA or SSO a blocker?
2. Do Operations API reads enforce that user's web role (Team Member: Read-Only; No Access to pay rates, background checks, notes, secure documents), and its location affiliations?
3. Is there a read-only or API-only scope or product setting, beyond the web role?
4. What are the exact `/tokens/v2` request body field names, and the token's lifetime? Is there a refresh flow?
5. What are the exact query parameters and values for filtering `GET /employees` by status, location and position? Are statuses other than Active and Terminated (for example leave) returned, and how?
6. What is the maximum `querytake`, and the documented rate limit?
7. Which field is the work email, and is it guaranteed to be a company address?
8. How are borrowed or temporary location affiliations represented, and do they carry an end date?
9. Is there any modified-since or change timestamp on employees?
10. Are there employee-change webhooks (hire, termination, position, location)? What are the event types, payload, authentication, retries and delivery guarantees?

## 7. The read-only live check

It runs from the admin screen (**Admin → Integrations → Woven Employee Sync →
Run read-only check**) or from a terminal (`npm run probe:woven`). Both call
the same code, `src/lib/employees/woven/validate.ts`.

**What it does.** Everything is read-only:
- the token exchange;
- every page of the Active pass and the Terminated pass;
- one unfiltered read, to find employees whose status neither pass returns;
- up to 10 employee-details reads, multi-location employees first;
- one small read each of `/positions` and `/locations`. Both paths are unconfirmed; a 404 is reported, not treated as a failure.

It is about 40–50 requests at under 100 per minute. It writes nothing to Woven
or Supabase, and works before the migration exists.

**What it reports**, as counts and key names only. It never includes an
employee record, id, name, email, date, title or location name.
- The token response's key names and lifetime source.
- Per pass: records, pages, page sizes, the page format, raw **status values** with counts, keys returned, keys not in `contract.ts`, and per-field coverage.
- The overlap between passes, and employees missed by both.
- Normalised totals, including distinct positions and primary locations, the multiple-location flag and issue counts.
- Work-email **domains** with counts, and what the configured domain filter would drop.
- For details: key names, whether a `Locations[]` array was present, the location entry key names, and primary, additional and temporary counts, with expiry and borrowed-flag counts.
- For the reference endpoints: outcome, count and key names.
- Sensitive-looking key names.
- **Findings**, each Pass, Check or Fail, and an overall `ok`.

**Then, from the report:**
1. Correct `contract.ts` wherever a finding says a key, parameter or value differs.
2. Add a fixture of the real shape to `test-support.ts`: key names only, with invented values.
3. Run `npm test`, then re-run the check until it has no Fail findings and every Check finding is understood.
4. Settle `WOVEN_WORK_EMAIL_DOMAINS` from the domains list.
5. Decide whether employees missed by both passes (for example on leave) need their own pass.

## 8. Remaining approval steps (each separately approved)

1. **Credentials:** add them for the live check (§6, option A, B or C). This is your action.
2. **Live check:** run it and review the report. Claude corrects `contract.ts` and the tests from it, on this branch.
3. **Merge:** open and merge a PR. Production and Preview read the same Supabase project; the code is inert until the migration and switches are set.
4. **Migration:** apply `20260928002000_woven_employee_directory.sql` verbatim, in one transaction, to Ask Sunny Dev `rbkylaavthsjepsczccv`. This is a **production schema change**, because Production reads that project. Run `npm run verify:woven-migration` first, and the Supabase advisors after.
5. **Production secrets:** add the variables from §6 to Production as Sensitive.
6. **Preview sync:** `POST /api/admin/employees/woven/sync` with `{}`, from a live-mode deployment signed in as an admin. Review the summary.
7. **First real sync:** the same with `{"dryRun": false}`. Check the directory, the `new_employee` changes marked `initialLoad` and the queued locations. A second run should show zero changes.
8. **Salon mapping:** map each Woven location with `PATCH /api/admin/employees/woven/locations`. A person decides each mapping.
9. **Schedule:** add `{ "path": "/api/employees/woven/cron", "schedule": "30 10 * * *" }` to `vercel.json` crons, deploy, and set `WOVEN_SYNC_SCHEDULE_ENABLED=true`. The screen shows **Running daily** only after a scheduled run succeeds.
10. **Later, separately:** anything that changes Ask Sunny access (role or scope from PositionID, login linking, disabling a login on termination). Not built.

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
| Statuses outside Active/Terminated detected | ✅ unit · ☐ live |
| Scoped application user receives no sensitive keys | ✅ unit (detector) · ☐ live |
| Admin screen distinguishes each go-live step; a switch is not a schedule | ✅ unit |
| Schedule not enabled | ✅ unit (`vercel.json` has no Woven entry) |

## 10. Later phases (not built)

Each of these needs its own approval.

- A PositionID → role and scope mapping table, and a position hierarchy that could classify promotions.
- Linking directory rows to `app_users`, by a confirmed email match reviewed by a person.
- Acting on a termination: disabling a login after the approved delay, perhaps with the consecutive-miss safeguard.
- An admin screen for sync status, the location crosswalk and the change review queue. The routes already exist.
- Woven knowledge content, only through a supported API (`docs/woven-knowledge-sync-design.md`).
