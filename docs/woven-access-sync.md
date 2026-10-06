# Woven → Ask Sunny access sync (stages 0–2)

**Status (2 October 2026): built on `claude/woven-access-sync`, nothing
applied to Production.** The two migrations are written and verified on a
disposable local stack only. The access planner is preview-only; shadow mode
exists and is off; there is **no apply mode**.

Woven becomes the source of truth for **login eligibility** and **primary
salon**. Ask Sunny keeps its own authentication (Supabase Auth), roles,
permissions and user records. Woven is not an authentication provider.

## Owner decisions this implements

| # | Decision |
|---|---|
| 1 | The Woven email may be the login identity (personal addresses allowed) for approved, eligible employees only. A linked account's login email is never changed; a different Woven email is flagged. The Woven EmployeeID is the identity after linking. |
| 2 | Automatic accounts: **Salon Director** and **Assistant Salon Director** (by approved position mapping) only. Not Tanning Consultants, District Managers or above, corporate or unmapped positions. Senior accounts may be linked, but Woven never changes their role, scope or location. |
| 3 | Authoritative Woven **Terminated** status revokes access, no grace period — once termination detection is repaired and QA'd. `missing_from_source` is review only. |
| 4 | Additional, borrowed, temporary or expiring locations never change access. Only the primary location manages the salon of an SD/ASD. `scope_also_covers_area_ids` is never written. |
| 5 | Rehire is review only. Approval lifts the ban, restores active status, and recomputes role and salon from today's mappings. |
| 6 | Existing accounts with no Woven match are explicitly **not Woven-managed**. |
| 7 | Tests run on a local stack (no cost). Production is never used for destructive tests. |

## Stage 0A — termination detection (fixed)

**The bug.** In Production, Woven drops a terminated employee from both list
reads (`includeterminatedemployee=true` added no one, 29 Sep – 2 Oct). Only
the `employeestatus=<Terminated>` filter returns them (~1,115). The sync
matched that filter only against the run's own list reads, so a terminated
employee already on file was counted as "not in list reads" and discarded. The
directory kept them `active` with a rising `missing_sync_count`, and no
`terminated` change ever fired.

**The fix** (`src/lib/employees/woven/sync.ts`, step 4b): the filter's records
are matched by **EmployeeID against the directory on file**. An on-file
employee absent from both lists whose **own** Status in that read resolves to
Terminated is received as terminated: one `terminated` change, issue
`status_from_terminated_read`, miss count reset.

- A filter record whose own Status is not Terminated proves nothing.
- Former staff never on file are counted and not imported (as before).
- **Absence is never termination.** A failed terminated read terminates no one; it is recorded and the access guards block on it.
- Confirmed terminations no longer count against the 80% completeness check. Disappearances with no terminated status still do.
- `observedStatus(row)` is what access decisions use. It returns `active` or `terminated` only when the employee was in the latest stored run, and `unknown` otherwise.

Tests: `termination-reconciliation.test.ts`, with the fake Woven in
Production's shape (`listReadsOmitTerminated`).

## Stage 0B — revocation at the authentication layer

**The gap.** Disable set `app_users.status = 'disabled'` and nothing else. The
app refused the account, but Supabase Auth still accepted the password,
refreshed sessions and sent reset emails. A leftover access token could also
read the knowledge tables through PostgREST.

**Now** (`src/lib/auth/revocation.ts`, `patchUser`, migration
`20261002001000_auth_revocation_hardening.sql`):

1. The profile is written first, so the self-change and last-admin refusals run before anything is banned.
2. **Supabase Auth ban** (`ban_duration: 876000h`). This is the only attribute ever sent.
3. **Sessions revoked** (`auth_revoke_user_sessions`, server-only, service_role).
4. Audit: `access_revoked` / `access_restored` / `access_revocation_incomplete`, plus `scope_changed`, which was never audited before.
5. Re-enable lifts the ban.
6. A partial failure returns 502. Sending the same status again completes it, because both steps are idempotent.

Further changes:

- The **knowledge read policies** now require an active Ask Sunny user.
- **Forgot Password** sends nothing for a disabled or unknown account, or when the lookup fails, and gives the identical 200 answer.
- No user is ever deleted (deleting an auth user would cascade to the profile).

**Proven on real Supabase Auth** (`revocation.local-stack.test.ts`). A terminated user:

- cannot sign in with their password;
- cannot refresh either of two revoked sessions;
- cannot call the Ask Sunny API with their cookie;
- reads nothing from the knowledge tables with their leftover token;
- gets no reset email;
- cannot use a recovery link minted before termination.

Their auth user, profile, conversation and audit trail remain. A control test
shows that with the old policies the leftover token *did* read knowledge.

**Residual.** An access token minted before the ban remains a valid JWT until
it expires (Supabase's JWT expiry, normally one hour). It is refused by the
app and by RLS, so nothing usable remains.

## Stage 1 — links, planner, guards, Access Preview

Migration `20261002002000_woven_account_links.sql`:

| Object | Purpose |
|---|---|
| `employee_account_links` | One row per account: `woven_linked` (with `external_employee_id`, unique) or `not_woven_managed`. `managed_status`, `managed_location` and `managed_role` all default off. Includes provisioning and revocation timestamps. FK `on delete restrict`. |
| `employee_access_accounts` | Read-only view the planner reads accounts through (Woven code never names `app_users`) |
| `employee_access_runs`, `employee_access_actions` | Append-only shadow record: mode `shadow` and result `shadow` only, by CHECK constraint |
| `employee_access_record_shadow_run()` | Writes one run and its actions in one transaction under an advisory lock. Writes nothing else. |
| Backfill | Protected overrides → `woven_linked`, all flags off. Accounts with no Woven email match → `not_woven_managed`. Exact email matches stay unclassified for stage 2 review. |

**Planner** (`src/lib/employees/woven/access/plan.ts`). It is pure and
deterministic, and the same input always gives the same plan.

| Situation | Action |
|---|---|
| Active SD/ASD (approved mapping), usable unique email, primary mapped to a salon, no account | `CREATE_USER` (status invited; invite **not** sent) |
| Linked, managed, in sync | `NO_CHANGE` |
| Linked SD/ASD at salon scope, location managed, Woven primary salon differs | `UPDATE_PRIMARY_LOCATION` (replaces the primary; also-covers untouched) |
| Linked SD↔ASD position change, role managed | `UPDATE_ROLE` |
| Woven Terminated (read this run), linked, status managed, not protected | `DISABLE_TERMINATED` |
| Exact email match to one unclassified account | `FLAG_LINK_REVIEW` (never merged) |
| Shared email (Woven or accounts) | `FLAG_DUPLICATE_EMAIL` |
| No or invalid email | `FLAG_MISSING_EMAIL` |
| Unmapped position | `FLAG_UNMAPPED_POSITION` |
| Unmapped or non-salon primary location | `FLAG_UNMAPPED_LOCATION` |
| Unknown status | `FLAG_UNKNOWN_STATUS` (fail closed) |
| Not in the latest read | `FLAG_MISSING_FROM_WOVEN` (review only) |
| Revoked and now Active | `FLAG_REHIRE_REVIEW` |
| Linked, Woven email differs | `FLAG_EMAIL_CHANGE_REVIEW` |
| Protected or admin account, or status not managed, but terminated | `FLAG_PROTECTED_ACCOUNT` |
| Role change outside the SD/ASD tier, or role not managed | `FLAG_ROLE_REVIEW` |
| Location differs, location not managed | `FLAG_LOCATION_REVIEW` |
| Not-Woven-managed or unclassified account | `FLAG_NOT_WOVEN_MANAGED` |
| Linked to an EmployeeID not in the directory | `FLAG_LINKED_EMPLOYEE_NOT_FOUND` |
| Active with a past termination date | `FLAG_STATUS_CONFLICT` |

Global, region and district accounts are **never** narrowed to a salon, and
DM, RM, admin, owner and developer accounts are never changed by Woven.

**Guards** (`guards.ts`). Any one blocks every mutation in a run:

- no successful directory sync, or the latest run failed;
- the directory is older than 26 hours;
- status enum unresolved;
- terminated read failed or skipped;
- active employees below 80% of the previous run, or zero active;
- disables above max(3, 5%), location moves or role changes above max(3, 10%), or creates above 25;
- mapped locations or confirmed positions fell, or are zero.

**Access Preview** (Admin › Integrations › Woven › Access Preview) shows:

- the access mode and the guard verdict;
- filter chips per action, plus "would change access";
- one row per employee or unexplained account, with: Employee, Woven ID, Email, Woven status, Woven position, Woven primary location (additional locations shown as "not used for access"), Ask Sunny account (linked / unconfirmed email match / not Woven-managed), current role, current scope or salon, proposed role, proposed salon, proposed action(s) and reasons.

The old "Active employee check" stays.

**Modes** (`WOVEN_ACCESS_MODE`):

- `off` (default): preview only.
- `shadow`: after each successful scheduled directory sync, the plan is recorded and nothing is applied.
- Any other value, including `apply`, is treated as off and reported as a problem.

## Stage 2 — Link Review

Admin › Integrations › Woven › Access Preview › **Link review** shows one card per exact-email match the planner proposes. A match qualifies when exactly one Woven employee and exactly one unclassified Ask Sunny account share an email, compared case-insensitively.

Each card shows the Ask Sunny account and the Woven EmployeeID side by side. A person then chooses one of:

- **Confirm link.** This requires ticking "I confirm … are the same person". It stores `woven_linked` with that EmployeeID and `link_method = admin_confirmed_email`. From then on, the account is found by EmployeeID and never matched by email again. Later email changes become `FLAG_EMAIL_CHANGE_REVIEW`.
- **Different person.** The account is marked `not_woven_managed`.

What Woven may manage is opt-in per field, and all three flags default off:

- **Status:** never available for administrators or protected accounts.
- **Primary salon and role:** available only for a salon-tier account (employee, Assistant Salon Director, Salon Director) at a single salon. For anyone else they are stored off, whatever is sent.

Linking changes nobody's access.

`POST /api/admin/employees/woven/links` requires `manage_users` and `manage_integrations`, live mode and the rate limit. The reviewer is taken from the session. The server re-plans from the database and accepts only a match it is proposing at that moment. The table's own keys refuse a second link, so two simultaneous confirmations store exactly one. The only write is one `employee_account_links` row.

## Stage 2b — adoption and credential ownership (6 Oct 2026)

**Owner decisions, 6 Oct 2026:**

| Woven position | Ask Sunny | Provisioning |
|---|---|---|
| Tanning Consultant | employee, salon | automatic, after testing |
| Assistant Salon Director | assistant_salon_director, salon | automatic |
| Salon Director | salon_director, salon | automatic |
| District Manager | district_manager | not until an admin-selected district flow exists |
| Regional Director | — | review before mapping to regional_manager |
| Operations, HR, Owner | — | link / review only |
| Accounting, Maintenance, Loss Prevention, Franchise Support | — | no access until explicitly mapped |

- Protected accounts (admin, owner, developer, or a role override) are never auto-disabled. A Woven termination flags them for human review.
- For normal managed accounts, explicit Woven Terminated revokes access.
- Salon-tier access comes from the Woven **primary** location only. Extra salons are never granted from Woven. The 7 extra-salon grants that manual provisioning had copied from Woven additional locations were removed on 6 Oct (audited `scope_changed`).

**Managed-flag policy** (`access/managed-policy.ts`, the single source for the planner, Link Review and adoption):

| Account | Status | Primary salon | Role |
|---|---|---|---|
| employee / ASD / SD at salon scope | yes | yes | yes, within the salon tier |
| District / Regional Manager, or any wider scope | yes | never | never |
| Protected | never | never | never |

The planner treats `employee` as part of the salon tier. A move within the tier (for example SD → employee) is an `UPDATE_ROLE` when role is managed. A move out of the tier is `FLAG_ROLE_REVIEW`. A salon-tier account holding extra salons is `FLAG_LOCATION_REVIEW` (`extra_salons_not_granted_by_woven`); they are never removed automatically.

**Adoption.** Access Preview › *Woven management for linked accounts* lists every linked account with its flags. Only the flags the policy allows can be ticked.

- *Apply policy to selected* turns on everything allowed for the chosen accounts.
- `POST /api/admin/employees/woven/links/flags` handles up to 50 accounts per request. It requires `manage_users` and `manage_integrations`, live mode and the rate limit.
- The policy is enforced on the server: a disallowed flag is refused, never dropped.
- A concurrent change is refused, never overwritten.
- Every change is audited as `managed_flags_changed`.
- The database (migration `20261006001000`) grants service_role UPDATE on exactly the three flag columns. A trigger refuses any other change to a link, even by the table owner.

Turning a flag on changes nobody's access. It only allows a later, separately enabled apply action to act.

**Credential reset** (user directory › *Reset credentials*). For accounts whose password somebody else set:

1. `auth_clear_user_credentials` clears the password and deletes every session and refresh token, in one transaction. It is server-only.
2. The existing recovery email is sent.
3. The action is audited as `credentials_reset`.

It never sets, generates, shows or emails a password. The person chooses their own from the email, and the old password never works again. It refuses your own account and disabled accounts.

**Invite email prerequisites before any mass invite:** custom SMTP confirmed, scanner-safe invite links (the reset template is already scanner-safe), and an invite expiry of at least 24 hours.

## DISABLE_TERMINATED — automatic termination enforcement (built, OFF)

The only apply action. When Woven **explicitly** reports a linked employee as Terminated, and their account has status managed and is not protected, the account is disabled through the existing hardened path (`patchUser`): profile `disabled`, Supabase Auth ban, every session and refresh token revoked, audited. Forgot Password stays blocked, and nothing is deleted.

**When it acts.** The planner proposes it only when all of these hold:
- the account is linked by EmployeeID;
- status is managed;
- the account is not protected;
- the employee's status is Terminated in the latest read (miss count 0).

Every guard must also pass: a fresh, successful read; the Terminated read succeeded; enums resolved; no mass change. The executor (`src/lib/admin/woven-termination.ts`) then re-reads each account twice — immediately before claiming it, and again while holding the claim. Each time it must still be linked, managed, unprotected and not yet revoked, and Terminated in the directory row seen by the latest successful run. Anything else is skipped and recorded.

**Never:**
- missing from Woven;
- an old TerminationDate on an Active employee;
- unknown status;
- a stale or failed read;
- a protected account (`FLAG_PROTECTED_ACCOUNT` instead).

A revoked account that is Active again is `FLAG_REHIRE_REVIEW`, and is never re-enabled automatically.

**Two keys, both OFF.**

| Key | Where | Changed by |
|---|---|---|
| `WOVEN_APPLY_ACTIONS=DISABLE_TERMINATED` | Vercel environment (redeploy) | owner |
| `employee_access_controls.enabled` (+ `max_per_run`, default 3) | database, SQL editor only — the server can read it, never write it; every change logged in `employee_access_control_changes` | owner |

**Exactly once.**
- `employee_access_operations` allows one open attempt per account, written only through `employee_access_claim_operation` / `employee_access_finish_operation`.
- The link's `terminated_at`, `access_revoked_at` and `revoked_woven_status` are write-once.
- A repeated run finds "access already revoked".
- Two runs at once revoke a person exactly once.
- Every run is recorded in `employee_access_runs` (mode `apply`) with each account's result: applied, skipped, failed or blocked.

**Visible** in Access Preview › *Automatic actions*: both switches, recent apply runs, recent operations, and the disposable-test run.

**Disposable test** (`POST /api/admin/employees/woven/apply/test-termination`, `confirm: true`). It runs the real path for ONE account linked to a test employee whose EmployeeID starts `ASK-SUNNY-TEST-`. Real EmployeeIDs are UUIDs. The switches are not required; every other rule is.

**Enable (owner, after a successful disposable test):**
1. Vercel → ask-sunny → Environment Variables → Production: `WOVEN_APPLY_ACTIONS` = `DISABLE_TERMINATED`. Redeploy.
2. SQL editor:
   ```sql
   update public.employee_access_controls
      set enabled = true, max_per_run = 3, changed_by = 'owner:<name>', reason = '<why>'
    where action = 'DISABLE_TERMINATED';
   ```
3. The next 11:17 UTC sync records the shadow plan, then the apply run.

**Roll back.**
- **Instantly** (next run does nothing):
  ```sql
  update public.employee_access_controls
     set enabled = false, changed_by = 'owner:<name>', reason = '<why>'
   where action = 'DISABLE_TERMINATED';
  ```
- **Fully:** also remove `WOVEN_APPLY_ACTIONS` and redeploy.
- **One person revoked in error:**
  1. Users › Re-enable (lifts the ban, restores active).
  2. In Access Preview › *Woven management*, untick their status management.

  Their link keeps the revocation record (write-once), so the executor skips them on every later run.

## Verification
## Verification

```
npm test                      # unit + source-scan suites (local-stack suites skip)
npm run stack:up && npm run test:local-stack && npm run stack:down
```

## Next gates (each needs approval)

1. Apply `20261002001000` and `20261002002000` to the Supabase project (Supabase advisors before and after).
2. Deploy. The termination fix starts recording `terminated` changes on the next daily sync. Review them, and the 3 employees currently missing, against Woven.
3. **Stage 2, link review:** done in Production. All 27 accounts are linked or classified.
4. **Stage 2b, adoption:** apply `20261006001000`, deploy, then set the managed flags per policy. Reset the credentials of the 16 hand-provisioned SD/ASD accounts once the email prerequisites are confirmed.
5. **Shadow:** `WOVEN_ACCESS_MODE=shadow` in Production (redeploy), then review the recorded runs.
6. **Apply:** DISABLE_TERMINATED built (above), off. Still to build, one capability at a time, each behind its own switch: CREATE_USER, SEND_INVITE, auto-resend, UPDATE_PRIMARY_LOCATION, UPDATE_ROLE, rehire approval.
