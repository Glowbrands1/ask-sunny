# Woven → Ask Sunny employee sync (phase one)

**Status: built, tested and inert. Not live.** The code, migration and tests
are on branch `claude/dazzling-fermat-z7v3ws`. Nothing is merged, deployed,
scheduled or applied, no credential is set, and no request from Ask Sunny has
reached Woven.

The design was rebuilt on **29 September 2026 against the official Woven
OpenAPI 3 export**, which replaced every guessed field name. What the export
cannot settle — the meaning of Woven's integer enums, the CompanyID, whether
an `ExpiresOn` always means a borrow, whether employee webhooks exist — is
settled by the read-only live check (§7), and nothing depends on a guess.

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
- Call any location "borrowed". An `ExpiresOn` makes it `temporary_or_expiring_access` until live data shows the two are the same.
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
training. **No employee trigger is documented.** The live check reads
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
| `validate.ts` | The read-only live check |
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
| `WOVEN_COMPANY_ID` | Optional GUID | Only `Username`/`Password` are required. Without it Woven chooses and the live check reports the CompanyID and the companies the user can choose. Find it in the portal or set it from that report |
| `WOVEN_PLATFORM` | Optional 1–4 | Unnamed in the spec; leave unset unless Woven requires it |
| `WOVEN_LOGIN_EMAIL_DOMAINS` | Comma-separated domains | **Not a storage filter.** Which addresses may ever be used to sign in. Unset: nobody is login-eligible. Set only once the real Glow / Sun Tan City domains are confirmed |
| `WOVEN_SYNC_ENABLED` | `true` to allow any call | Master switch |
| `WOVEN_SYNC_SCHEDULE_ENABLED` | Leave unset | Only for the approved schedule |
| `WOVEN_API_BASE_URL`, `WOVEN_PAGE_SIZE`, `WOVEN_MAX_DETAIL_REQUESTS_PER_RUN`, `WOVEN_MIN_COMPLETENESS_PERCENT` | Leave unset | Defaults: the spec gateway, 100, 150, 80 |
| `CRON_SECRET` | Already set | Reused |

### Where to enter them for the live check

**A. Vercel Preview, scoped to this branch (recommended).** Settings →
Environment Variables → Add, tick **Sensitive**, only **Preview**, Git branch
`claude/dazzling-fermat-z7v3ws`. Add the key, username, password and
`WOVEN_SYNC_ENABLED=true`. If the preview runs in demo mode the check refuses;
add a branch-scoped `NEXT_PUBLIC_DEMO_MODE=false`. Redeploy the preview.

**B. Your own terminal**, values typed into the shell, never saved:
```
read -rs WOVEN_SUBSCRIPTION_KEY && export WOVEN_SUBSCRIPTION_KEY
read -r  WOVEN_USERNAME         && export WOVEN_USERNAME
read -rs WOVEN_PASSWORD         && export WOVEN_PASSWORD
WOVEN_LIVE_PROBE=1 WOVEN_SYNC_ENABLED=true npm run probe:woven
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

## 7. The read-only live check

Admin → Integrations → Woven → Overview → **Run read-only check**, or
`npm run probe:woven`. Read-only: the token exchange, `/lists/enums`, every
page of both `/employees` reads, up to 10 details (all-location and
multi-location first), `/locations`. It writes nothing anywhere.

It reports counts, key names and Woven's own vocabulary — never a person's id,
name, email, date or title:
- the token response's keys and lifetime, the **CompanyID** and company names;
- the **Status** and **TerminationType** labels, and every **webhook-trigger** name, with any that mention employees;
- per read: records, pages, `Status` integers with counts, keys, keys not in the contract, field coverage;
- whether `includeterminatedemployee=true` returned a superset;
- email **domains** with counts, and how many a configured login rule accepts;
- details: `Locations[]` presence, entry keys, access-type counts, how many entries carry an **ExpiresOn**, and how all-location employees are listed;
- `/locations`: count, with a Number, non-locations, closed;
- sensitive-looking keys; findings as Pass / Check / Fail.

**Then:** confirm the enum names (`EMPLOYEE_STATUS_ENUM_NAMES`), set
`WOVEN_COMPANY_ID`, compare a known borrowed employee in Woven with their
`Locations[]` entry before anything is renamed from
`temporary_or_expiring_access`, and correct `contract.ts` wherever a finding
says so.

## 8. Remaining gates (each separately approved)

1. **Credentials** for the live check (§6).
2. **Live check** run and reviewed; `contract.ts` corrected from it.
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
| Overview | `/admin/integrations/woven` | `manage_integrations` | Eleven count cards, sync health, the go-live steps, the live check |
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
