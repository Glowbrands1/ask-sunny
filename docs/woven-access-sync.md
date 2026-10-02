# Woven → Ask Sunny access sync (stages 0–1)

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
- **Primary salon and role:** available only for a Salon Director or Assistant Salon Director at a single salon. For anyone else they are stored off, whatever is sent.

Linking changes nobody's access.

`POST /api/admin/employees/woven/links` requires `manage_users` and `manage_integrations`, live mode and the rate limit. The reviewer is taken from the session. The server re-plans from the database and accepts only a match it is proposing at that moment. The table's own keys refuse a second link, so two simultaneous confirmations store exactly one. The only write is one `employee_account_links` row.

## Verification

```
npm test                      # unit + source-scan suites (local-stack suites skip)
npm run stack:up && npm run test:local-stack && npm run stack:down
```

## Next gates (each needs approval)

1. Apply `20261002001000` and `20261002002000` to the Supabase project (Supabase advisors before and after).
2. Deploy. The termination fix starts recording `terminated` changes on the next daily sync. Review them, and the 3 employees currently missing, against Woven.
3. **Stage 2, link review:** built (see above). Confirm the ~4 email matches in Production, and set the managed flags per account.
4. **Stage 4, shadow:** `WOVEN_ACCESS_MODE=shadow` in Production, then review the recorded runs.
5. **Stage 5, apply:** not built. One capability at a time (DISABLE_TERMINATED first). Invites remain a separate action.
