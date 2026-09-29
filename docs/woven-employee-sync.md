# Woven → Ask Sunny employee sync (phase one)

**Status: built, tested and inert. Not live.** The code, migration and tests
are on branch `claude/dazzling-fermat-z7v3ws`. Nothing is merged, deployed,
scheduled or applied, no credential is set, and no request from Ask Sunny has
reached Woven.

The design was rebuilt on **29 September 2026 against the official Woven
OpenAPI 3 export**, which replaced every guessed field name. What the export
cannot settle — the meaning of Woven's integer enums, the CompanyID, how
Woven's locations line up with Ask Sunny's salons, whether employee webhooks
exist — is settled by the read-only connection test (§7), and nothing depends
on a guess. What an `ExpiresOn` means is **not** settled by it: the test counts
them and labels the meaning "needs live operational confirmation".

**Phase one is observe-only.** It syncs, detects, stores and displays. It
creates no account, disables no login, and changes no role, `scope_level`,
primary salon, salon access or RLS policy.

The remaining gates, each needing explicit approval, are in §8.

---

## 1. What phase one does, and what it does not

**Does**
- Reads Woven employees (active **and** terminated) through the Operations API: `POST /tokens/v2` to sign in, then GETs only — `/lists/enums`, `/employees` (twice), `/employees/{id}/details`, `/locations`.
- Keeps an allowlisted copy in `employee_access_directory`, keyed on Woven's `EmployeeID`.
- Keeps each employee's locations in `employee_location_affiliations`: primary, additional, and **temporary or expiring** access.
- Detects and records changes between syncs in `employee_directory_changes` (append-only).
- Records every run in `employee_sync_runs`.
- Queues every Woven location in `woven_location_map` and every Woven position in `woven_position_map`, for a person to map.
- Shows all of it on six admin tabs (§9).

**Does not**
- Create, enable or disable a login, or change `app_users`, a role, a `scope_level`, `scope_primary_area_id`, `scope_also_covers_area_ids`, Supabase Auth, or any existing RLS policy or grant.
- Apply a mapping to anyone. A location or position mapping is a LABEL in phase one.
- Delete anybody. Absence from a read raises `missing_sync_count`; it is never treated as termination.
- Call a position change a promotion unless BOTH positions are confirmed and ranked in the position map.
- Give an `ExpiresOn` any meaning beyond `temporary_or_expiring_access`. Its operational meaning needs live confirmation against a known case.
- Filter email by domain. Woven's `EmailAddress` is stored as provided; login eligibility is a separate rule (§6).
- Write anything to Woven. The client refuses every path but the four reads and the token exchange.

`docs/HANDOFF.md` says "There is no employee directory, and none should be
invented." This work is the deliberate exception, sourced from Woven rather
than invented, and the migration is applied only with approval.

## 2. Architecture

```
Vercel Cron (NOT scheduled) ──GET, Bearer CRON_SECRET──┐
Admin (manage_integrations) ──POST, dry run by default──┤
                                                        ▼
                      src/lib/employees/woven/sync.ts  (Next.js server, Node runtime)
                        │  WovenClient — server-only, four GETs + the token POST
                        ▼
             Woven Operations API  https://gateway-api.woven.team/api
                        │
                        ▼  one transaction per run (employee_sync_commit_run)
             Supabase: directory, location access, changes, runs, location map, position map
                        │
                        ▼  read-only views
             Admin → Integrations → Woven (six tabs)
```

A Next.js route plus a Vercel Cron entry, like the Google review Apify sync.
pg_cron and pg_net are not installed, and a second runtime would buy nothing.

### Polling, not webhooks

The export defines company webhooks (`/companies/{id}/companywebhooks`,
triggers, delivery logs) but their triggers are unnamed integers (6, 8, 9, 65,
70–82) with no payload schema, and the model points at work orders, assets and
training. **No employee trigger is documented.** The connection test reads
`/lists/enums` and reports every trigger name Woven itself lists. Until an
employee trigger is confirmed, scheduled polling is the design. If one exists,
it would only START a normal sync; registering it is a write to Woven and needs
its own approval. `source_mode = webhook` is reserved and unused.

### Files

| Path | Role |
|---|---|
| `src/lib/employees/woven/contract.ts` | Every Woven name used, from the OpenAPI export, and the read-path allowlist |
| `config.ts` | Environment variables, both switches, bounds |
| `client.ts` | Token exchange (`Username`/`Password`/optional `CompanyID`/`Platform`), expiry from `TokenExpirationDate`, pacing, retries, pagination. Refuses any GET outside the allowlist |
| `enums.ts` | Status / TerminationType / webhook-trigger names from `/lists/enums` |
| `normalize.ts` | The allowlist, field by field |
| `diff.ts` | Change detection, classification, effective dates, the record hash |
| `sync.ts` | The run: claim, enums, both reads, completeness proof, catalog, details, diff, one commit |
| `store.ts` | The only door into Supabase; payload keys asserted against the migration by `store.test.ts` |
| `views.ts`, `view-types.ts` | Tab rules (filters, paging, eligibility) — pure, shared by real and sample data |
| `directory.ts`, `locations.ts`, `positions.ts`, `access-preview.ts`, `status.ts` | Read models for the tabs |
| `route-auth.ts` | `manage_integrations` AND `manage_users` for the people routes |
| `validate.ts` | The read-only connection test (validation) |
| `src/app/api/admin/employees/woven/*` | sync, validate, directory, changes, changes/[id], runs, locations, positions, eligibility |
| `src/app/api/employees/woven/cron/route.ts` | Scheduled entry point. **Not in `vercel.json`.** |
| `src/app/(app)/admin/integrations/woven/` | Overview page and the `[view]` tabs |
| `src/features/admin/woven/` | The screens; `sample.ts` gates sample data |
| `src/data/demo/woven.ts` | Labelled sample data — demo builds only |
| `supabase/migrations/20260928002000_woven_employee_directory.sql` | The schema. **Not applied.** |
| `scripts/verify-woven-migration.mjs` | Runs the migration on PGlite and checks 110 behaviours |

## 3. Data model

Every table has RLS **enabled and forced with no policies**, and every
privilege is revoked from `anon` and `authenticated`; every function and view
is revoked from `public`, `anon` and `authenticated`. Only the server, with the
secret key, reaches them.

| Table | What it holds |
|---|---|
| `employee_access_directory` | One row per Woven employee, unique on `(source_system, external_employee_id)`. EmployeeID, EmployeeLoginID, ExternalHRISID, names, `email_address` as provided, status + raw `Status` integer, hire / start / termination / last-day-worked dates, `TerminationType` integer, PositionID/name, primary location, the multiple-/all-location and login-allowed flags, a location filter array, data-issue codes, first/last seen, last synced, miss count |
| `employee_location_affiliations` | One row per employee × location: `access_type` primary / additional / `temporary_or_expiring_access`, `expires_on`, active, ended_at. Deactivated, never deleted, and only on a full read |
| `employee_directory_changes` | Append-only: kind, field, before, after, classification, effective date (only Woven's), run, review status. A unique key refuses the same change twice |
| `employee_sync_runs` | One row per attempt: the lock, source mode, counts, error code |
| `woven_location_map` | Woven location → salon, with Woven's Number, district, region, closed and non-location, and an exact-number `suggested_salon_id`. A person maps |
| `woven_position_map` | Woven PositionID → Ask Sunny role, default scope level, rank; `is_confirmed` generated from status and reviewer. A person maps |

Views: `employee_sync_status`, `employee_sync_run_summary`,
`employee_directory_view`, `employee_directory_login_matches`,
`employee_access_preview`. The last two READ `app_users` to show matches and
disagreements; they grant, link and change nothing.

There is no column for pay, date of birth, a phone, an address, an emergency
contact, demographics, notes, documents, termination reason or rehire
eligibility — although the list and details responses carry many of them.

## 4. Field mapping, Woven → Ask Sunny

| Woven (spec name) | Ask Sunny | Notes |
|---|---|---|
| `EmployeeID` | `external_employee_id` | The permanent identity. Never the email |
| `EmployeeLoginID`, `ExternalHRISID` | `employee_login_id`, `external_hris_id` | Cross-references only |
| `FirstName`, `LastName`, `PreferredFirstName` | `first_name`, `last_name`, `preferred_first_name` | |
| `EmailAddress` | `email_address` | Woven has no separate work-email field. Stored as provided (trimmed). May be personal |
| `Status` (int32) | `employment_status`, `employment_status_code` | Resolved through `/lists/enums`. Only "Active" and "Terminated" mean those; anything else is `unknown`, never terminated |
| `HireDate`, `StartDate` | `hire_date`, `start_date` | .NET `0001-01-01` is null |
| `TerminationDate`, `TerminatedLastDayWorked`, `TerminationType` | `termination_date`, `termination_last_day_worked`, `termination_type_code` | |
| `TerminationReason`, `TerminatedAllowRehire` | — | Not kept |
| `PositionID`, `PositionName` | `position_id`, `position_name` | No `/positions` endpoint; the position map is built from employees |
| `PrimaryLocationID`, `PrimaryLocationName` | primary location columns | Salon only through the location map |
| `HasMultipleLocationAccess`, `AllLocationAccess`, `IsLoginAllowed` | the three flags | Informational; decide nothing about Ask Sunny access |
| Details `Locations[]`: `LocationID`, `Name`, `Number`, `ExpiresOn` | `employee_location_affiliations` | Primary = equals PrimaryLocationID; `ExpiresOn` set = temporary or expiring |
| `RoleID`, `RoleName`, `RoleAuthorityLevel`, `Username`, `CellPhone`, `DateOfBirth`, pay, address, demographics, notes | — | Never read |

## 5. Change detection

| Kind | Recorded when | Classification | Effective date |
|---|---|---|---|
| `new_employee` | The EmployeeID has never been seen | `initial_load` on the first sync; `new_hire` when hired or started within 30 days; otherwise `newly_visible` | hire date |
| `terminated` | Woven now says terminated and did not before | — | termination date (last day worked in details) |
| `reactivated` | Terminated → active | `rehire` | new start / hire date, if it changed |
| `position_changed` | New non-null PositionID differs | `unclassified`, unless both positions are confirmed and ranked: `promotion_confirmed`, `demotion_confirmed`, `lateral` | none from Woven |
| `primary_location_changed` | New non-null primary differs | `transfer`, or `assigned` | none from Woven |
| `location_access_added` / `removed` | A location appears / disappears in a **full** read | `additional`, `temporary_or_expiring_access`; `expired` or `removed` | the ExpiresOn, when expired |
| `email_changed` | New non-null email differs, case-insensitively | — | — |
| `missing_from_source` | Absent from 3 consecutive syncs; recorded once | — | — |

Moving INTO `unknown` records nothing. A re-run with unchanged data records
nothing. A position confirmed later does not rewrite past `unclassified` rows.

### When a run is refused

A refused run writes only its own run row: `empty_read`, `mostly_unreadable`,
`unexpectedly_small` (fewer actives than `WOVEN_MIN_COMPLETENESS_PERCENT` of
those on file, once 10 are on file), and **`status_enum_unresolved`** — a real
run is refused when `/lists/enums` names no employee-status enumeration,
because a directory of unknowns is useless and would later look like an estate
of status changes. A dry run still reports.

Details are read only for employees who need them — multiple- or all-location
access, or other locations already on file — within a per-run budget. A
details failure keeps what is on file and ends nothing.

## 6. Configuration

All server-only; none is ever `NEXT_PUBLIC_`, committed, logged, returned or
stored.

| Name | Value | Notes |
|---|---|---|
| `WOVEN_SUBSCRIPTION_KEY` | The subscription's primary key | `Subscription-Key` header |
| `WOVEN_USERNAME`, `WOVEN_PASSWORD` | The Woven application user (§6.1) | `Username`, `Password` in `POST /tokens/v2` |
| `WOVEN_COMPANY_ID` | Optional GUID | Only `Username`/`Password` are required. Without it Woven chooses and the connection test reports the CompanyID and the companies the user can choose. Find it in the portal or set it from that report |
| `WOVEN_PLATFORM` | Optional 1–4 | Unnamed in the spec; leave unset unless Woven requires it |
| `WOVEN_LOGIN_EMAIL_DOMAINS` | Comma-separated domains | **Not a storage filter.** Which addresses may ever be used to sign in. Unset: nobody is login-eligible. Set only once the real Glow / Sun Tan City domains are confirmed |
| `WOVEN_VALIDATION_ENABLED` | `true` for the connection test | Opens the read-only validation ONLY. Needs no sync switch and opens no sync |
| `WOVEN_VALIDATION_ACCESS_CODE` | 16+ random characters, demo-mode Previews only | On a demo-mode deployment (role switcher, public URL) the connection test also needs this code, typed into a password field and compared server-side. Opens nothing else; refused while `WOVEN_SYNC_ENABLED` is on and on Vercel Production. Live deployments never read it. Delete after the test |
| `WOVEN_SYNC_ENABLED` | Leave `false` until a sync is approved | Opens "Run employee sync" (manual, dry run, cron). Off: no sync reaches Woven or the database, whatever the validation switch says |
| `WOVEN_SYNC_WRITES_ENABLED` | Leave unset until the first stored sync is approved | A sync may SAVE. Off: only dry runs; a save requested by the manual route or the cron is refused (409 `writes_disabled`) inside `runWovenEmployeeSync`, before the store is opened, the run lock taken or Woven called. The page's button always asks for a dry run |
| `WOVEN_SYNC_SCHEDULE_ENABLED` | Leave unset | Only for the approved schedule |
| `WOVEN_API_BASE_URL`, `WOVEN_PAGE_SIZE`, `WOVEN_MAX_DETAIL_REQUESTS_PER_RUN`, `WOVEN_MIN_COMPLETENESS_PERCENT` | Leave unset | Defaults: the spec gateway, 100, 150, 80 |
| `CRON_SECRET` | Already set | Reused |

### Where to enter them for the connection test

**A. Vercel Preview, scoped to this branch (recommended).** Settings →
Environment Variables → Add, tick **Sensitive**, only **Preview**, Git branch
`claude/dazzling-fermat-z7v3ws`. Add the key, username, password,
`WOVEN_VALIDATION_ENABLED=true` and `WOVEN_VALIDATION_ACCESS_CODE` — **not**
`WOVEN_SYNC_ENABLED`, which stays off so no sync can run. The Preview stays in
demo mode: do **not** set `NEXT_PUBLIC_DEMO_MODE=false`, because Preview and
Production share one Supabase database and live mode would open every other
write-capable feature against it. Redeploy the preview: variables apply only to
deployments built after they are added.

**B. Your own terminal**, values typed into the shell, never saved:
```
read -rs WOVEN_SUBSCRIPTION_KEY && export WOVEN_SUBSCRIPTION_KEY
read -r  WOVEN_USERNAME         && export WOVEN_USERNAME
read -rs WOVEN_PASSWORD         && export WOVEN_PASSWORD
WOVEN_LIVE_PROBE=1 npm run probe:woven
```

**C. A Claude Code cloud environment** (least preferred): environment secrets
plus `gateway-api.woven.team` in its allowed domains.

Never paste a key or password into chat, a ticket, a commit or a screenshot.

### 6.1 Which Woven application user

A **dedicated, non-personal integration user**, not a person's account: a
personal token carries that person's full permissions (pay, background checks,
secure documents), breaks when they change password or leave, and misattributes
the reads. Recommended: "Ask Sunny Integration" on a company-controlled
mailbox; role "Ask Sunny API (read-only)" with Team Member **Read-Only** and
**No Access** everywhere else; **all locations** affiliated, because
`/locations` and the employee list return the user's own locations. The live
check's `sensitiveKeysReturned` tests whether the API honours that role.

## 7. The read-only connection test

Admin → Integrations → Woven → Overview → **Test Woven connection → Run
read-only validation**, or `npm run probe:woven` (no salon comparison there: it
reads no database). Needs `WOVEN_VALIDATION_ENABLED=true`; `WOVEN_SYNC_ENABLED`
stays `false`, and the separate **Run employee sync** button stays disabled.

On a **demo-mode** Preview this route is the one exception to "demo mode
reaches nothing live", and it is narrow: not on Vercel Production, only while
`WOVEN_SYNC_ENABLED` is off, and only with the `WOVEN_VALIDATION_ACCESS_CODE`
typed into the page's password field. The code is sent in the POST body,
compared in constant time, rate-limited before comparison, and never logged,
returned or stored in the browser. The sync and cron routes still refuse demo
mode outright, and authentication is unchanged.

Read-only: the token exchange, `/lists/enums`, every page of both `/employees`
reads, a **sample** of at most 10 employee details (all-location and
multi-location first; the full HR detail record is never fetched for everyone),
`/locations`, and a SELECT of `salons` (number and name). It writes nothing to
Woven or Supabase and runs no sync.

It reports counts, enum names, field names and sanitized errors (error code and
HTTP status — never a response body or a URL) — never a credential, token, or
a person's id, name, email, date or title:
- **authentication** success or failure; the **CompanyID** and company options;
- the **employee-status** and **termination-type** values, every **webhook-trigger** name, and any employee-related trigger flagged;
- **active**, **terminated** and **unique** employee counts; **unique PositionIDs**;
- per read: records, pages, `Status` integers with counts, keys, field coverage; whether `includeterminatedemployee=true` returned a superset;
- email **domains** with counts only;
- employees flagged `HasMultipleLocationAccess` and `AllLocationAccess`;
- the details **sample**: records checked (labelled as a sample when it is one), how many named more than one location, and `ExpiresOn present: N affiliations` with the meaning **"needs live operational confirmation"**;
- `/locations`: total, with a Number, closed, non-locations; and against `salons.salon_number` (exact match): matches, salons covered, unmatched Woven locations (and how many are open), salons with no Woven location, numbers that match only if leading zeros are ignored (not counted);
- **sensitive HR field names** the application user received, without values;
- every **difference from the OpenAPI spec** seen, in sanitized words;
- when sign-in yields no token: the HTTP status, media type and body kind (JSON, text, HTML, XML or empty), top-level key names, the spec's login-state fields (`FailedLoginAttempt`, `AccountStatus`, two-factor flags, `HasMultipleCompanyAccess` and a count of company options, password-change/terms/onboarding flags), redacted error fields, whether CompanyID and Platform were sent, and what that suggests: the gateway rejected the subscription key, Woven rejected the username or password, a CompanyID or Platform appears required, two-factor sign-in, or unfinished account setup. A 200 with those login-state fields but no token is reported as `login_refused`, which the spec allows, not as a contract difference. The application user's name, username, e-mail, phone, employee id and any token are never reported;
- findings as Pass / Check / Fail.

The location numbers and names behind the coverage counts appear in an
expandable review area only for a caller who also holds `manage_users`. They
are locations, never employees. Nothing is mapped or confirmed by the test.

**Then:** confirm the enum names (`EMPLOYEE_STATUS_ENUM_NAMES`), decide
`WOVEN_COMPANY_ID`, review the salon coverage before mapping, and correct
`contract.ts` wherever a finding says so. The meaning of `ExpiresOn` is
confirmed separately, by comparing one known case in Woven with its
`Locations[]` entry.

## 8. Remaining gates (each separately approved)

1. **Credentials** for the connection test (§6), Preview only, with `WOVEN_VALIDATION_ENABLED=true` and `WOVEN_SYNC_ENABLED=false`.
2. **Connection test** run and reviewed; `contract.ts` corrected from it.
3. **Merge** to `main` (the code is inert without the migration and switches).
4. **Migration** applied verbatim, in one transaction, to Ask Sunny Dev `rbkylaavthsjepsczccv` — a **production** schema change, because Production reads it. `npm run verify:woven-migration` first, Supabase advisors after.
5. **Production secrets** as Sensitive variables.
6. **Preview sync** (`POST /api/admin/employees/woven/sync` with `{}`), reviewed.
7. **First real sync** (`{"dryRun": false}`); a second run shows zero changes.
8. **Mapping**: locations to salons, positions to roles, scopes and ranks — by a person.
9. **Login-email domains** confirmed and set.
10. **Schedule**: the cron entry in `vercel.json` and `WOVEN_SYNC_SCHEDULE_ENABLED=true`.
11. **Later phases** (§10), each on its own.

## 9. The admin screens

| Tab | URL | Permission | Shows |
|---|---|---|---|
| Overview | `/admin/integrations/woven` | `manage_integrations` | Eleven count cards, sync health, the go-live steps, "Test Woven connection" and a separate, disabled "Run employee sync" |
| Employee Directory | `…/woven/directory` | + `manage_users` | Every employee; search; location and position; nine filters |
| Change Feed | `…/woven/changes` | + `manage_users` | Every change, by kind and review status; review buttons |
| Sync History | `…/woven/runs` | `manage_integrations` | One row per run |
| Mappings | `…/woven/mappings` | + `manage_users` | Location → salon and position → role/scope/rank review |
| Access Preview | `…/woven/preview` | + `manage_users` | The active-employee check and where Ask Sunny and Woven disagree — read-only |

Both permissions already exist, and today exactly the same roles (admin,
owner, developer) hold both; the matrix is unchanged. The locations route was
**raised from `manage_integrations` to also require `manage_users`**.

**Sample data** exists only in a DEMO build (`src/data/demo/woven.ts`, behind
the build-time demo boundary), shows only in demo mode, never on a Vercel
Production deployment, is never written to a table, and carries a "Sample
data — not from Woven" banner with every action disabled.

## 10. Later phases (not built)

| Phase | Behaviour | Needs first |
|---|---|---|
| 2 · First-login provisioning | An unknown person signing in with an eligible email gets an account with the mapped role and scope | Confirmed positions and locations, `WOVEN_LOGIN_EMAIL_DOMAINS`, its own approval; changes `src/lib/auth/*` |
| 3 · Automatic deactivation | Terminated in Woven → login disabled after a grace period, with an audit entry | Who owns termination, the grace period, a frequent `terminatedWithinLastNumberDays` pass |
| 4 · Role updates | A confirmed position change updates the role — approve-first, then automatic | Confirmed ranks |
| 5 · Location / scope updates | Primary and additional locations update salon scope | District and region reconciliation with Ask Sunny's own |
