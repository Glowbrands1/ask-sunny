# Deliverable 1 — Employee lifecycle & authentication feasibility

**Date:** 22 September 2026
**Scope:** read-only audit. No provisioning, directory sync or authentication
change was built, and none should be until the open questions at the end are
answered.

---

## The headline, before the detail

**There is no MyGlow integration and no Woven integration in this codebase, and
no employee data arrives from either one today.** Every capability question in
the brief therefore answers `UNKNOWN / NOT VERIFIED` for both systems — not
because the audit was shallow, but because there is nothing to audit. What
follows shows exactly what was searched and what was found, so the client can
see the gap is real rather than assumed.

The architecture recommendation is still worth making, and it is made below. It
is conditional on capabilities somebody has to confirm with the two vendors.

---

## A. What MyGlow and Woven can actually provide

### MyGlow

| Question | Answer | Evidence |
|---|---|---|
| Any integration at all? | **NO — the string "myglow" does not appear anywhere in this repository** | `grep -ril "myglow\|my.glow\|mygl"` across all tracked files, all branches and all of git history: zero matches |
| Active/inactive employment status | UNKNOWN / NOT VERIFIED | no connector, no schema, no docs |
| Employee ID | UNKNOWN / NOT VERIFIED | — |
| Job code | UNKNOWN / NOT VERIFIED | — |
| Job title | UNKNOWN / NOT VERIFIED | — |
| Assigned salon/location | UNKNOWN / NOT VERIFIED | — |
| Multiple assigned locations | UNKNOWN / NOT VERIFIED | — |
| Work email | UNKNOWN / NOT VERIFIED | — |
| Personal/mobile phone | UNKNOWN / NOT VERIFIED | — |
| Termination/inactivation status | UNKNOWN / NOT VERIFIED | — |
| Promotion / job-role changes | UNKNOWN / NOT VERIFIED | — |
| Location transfers | UNKNOWN / NOT VERIFIED | — |
| Full employee directory endpoint | UNKNOWN / NOT VERIFIED | — |
| Filtering active employees | UNKNOWN / NOT VERIFIED | — |
| Incremental / delta updates | UNKNOWN / NOT VERIFIED | — |
| `updated_at` or equivalent | UNKNOWN / NOT VERIFIED | — |
| Webhooks / event subscriptions | UNKNOWN / NOT VERIFIED | — |
| Scheduled polling only | UNKNOWN / NOT VERIFIED | — |
| Rate limits | UNKNOWN / NOT VERIFIED | — |
| OAuth / service account / API key | UNKNOWN / NOT VERIFIED | — |
| Permission / scoping controls | UNKNOWN / NOT VERIFIED | — |
| Field-level restrictions | UNKNOWN / NOT VERIFIED | — |

MyGlow is not named in the code, the environment template, the migrations, the
integrations roadmap, or any of the 29 documents in `docs/`. If "API/connectivity
work around MyGlow" exists, it exists outside this repository and we have not
been shown it.

### Woven

Woven **is** named — four times, and not once as an API.

| Where | What it actually is | File |
|---|---|---|
| A document-source enum value | `DocumentSource = "upload" \| "sharepoint" \| "woven" \| "system"` — a label reserved for a *future* sync. Nothing reads or writes it; `grep '"woven"'` across `src/` returns this declaration, the training-link key, and tests. No ingest code exists. | `src/types/index.ts:172`, `supabase/migrations/20260829000200_knowledge_schema.sql` |
| An optional link destination | `NEXT_PUBLIC_WOVEN_TRAINING_URL` — a URL a manager clicks to leave Ask Sunny. Unset by default. Not an API client. | `src/lib/config/training-links.ts:38-93`, `.env.example:444` |
| A roadmap card, `status: "not_connected"` | See the quote below | `src/data/demo/integrations.ts:65-77` |
| A demo tile pointing at `https://example.com/woven` | A placeholder, demo-build only | `src/data/demo/resources.ts` |

The roadmap card is the most useful thing in the repository on this subject,
because it is the team's own record of what was asked and not answered:

> **Woven** — status `not_connected`.
> "Where company documents live today."
> Notes: *"No confirmed bulk export or public API yet — webhooks may exist.
> Their support contact will confirm. The full library is 600+ documents; only a
> focused subset should ever be ingested."*
> — `src/data/demo/integrations.ts:72-76`

Two things follow, and both matter:

1. **Woven's only contemplated integration is DOCUMENTS into the knowledge base.**
   Not employees. There is no evidence anywhere that Woven holds an employee
   directory, and nothing in the repository treats it as an HR system.
2. **Even the document integration is unconfirmed.** The team already asked
   whether Woven has a public API and has not had an answer.

So the whole capability table for Woven is:

| Question | Answer |
|---|---|
| Employee directory / list endpoint | **UNKNOWN / NOT VERIFIED** — and there is no evidence Woven is an HR system at all |
| Every other capability in the brief | **UNKNOWN / NOT VERIFIED** |
| Public API of any kind | **NOT CONFIRMED** — the team's own note says so |

### What IS connected today, for contrast

So the client can see this is a gap rather than a general failure to integrate:

| System | Status | Evidence |
|---|---|---|
| Anthropic Claude | **Connected** — answers every turn | `src/lib/ai/call-claude.ts`, `ANTHROPIC_API_KEY` |
| Supabase (Postgres, Auth, Storage) | **Connected** — system of record | `supabase/migrations/*`, 61 migrations applied |
| Apify → Google Reviews | **Connected**, on a cron | `src/app/api/reviews/apify/*`, `vercel.json` crons |
| SharePoint, Power BI, Woven, Microsoft 365 | **Not connected** — roadmap only | `src/data/demo/integrations.ts` |

---

## B. Least privilege and data minimisation

### B1. Can MyGlow/Woven permissions restrict the connector to only the required data?

**UNKNOWN / NOT VERIFIED for both.** This is a question for each vendor's API
documentation and for whoever administers the tenancy. It must be answered before
credentials are issued, not after.

### B2. If the API response contains a larger employee object, can our connector safely discard unwanted fields immediately?

**Yes, and this is the one part we control completely.** The pattern already
exists in this codebase and is enforced, not merely intended:

- `src/lib/chat/payload.ts` — `safeMetadata()` is an **allowlist** (`METADATA_KEYS`),
  not a passthrough. A field not on the list cannot reach the database even if
  the client sends it.
- `src/app/api/chat/route.ts` — `parseAskRequest()` rebuilds the request from
  named fields only. There is no spread of the incoming body anywhere.
- `src/app/api/forms/instances/route.ts` — reads six named fields from the body
  and re-derives everything security-relevant server-side.

A directory connector should be written the same way: **parse into a declared
shape at the boundary, never store the vendor's object.** The raw response should
not be logged, cached or written to a staging table, because "we'll clean it up
later" is how pay rates end up in a backup.

### B3. Which fields would Ask Sunny actually need to PERSIST?

| Field | Why it must persist |
|---|---|
| `external_employee_id` | The join key to the source system. Without it, reconciliation is by name. |
| `source_system` | Which system asserted this row, once there is more than one. |
| `status` (`active` / `inactive`) | The access decision itself. |
| `job_code` | The input to the role mapping. |
| `job_title` | Human-readable, for the admin reconciliation report. Never an authorization input — see C. |
| `location_ids[]` | The scope decision. |
| `work_email` | Managers' login identifier. **Only where a manager logs in by email.** |
| `source_updated_at` | Change detection. |
| `last_seen_in_sync_at` | The safeguard that makes "disappeared from the feed" measurable rather than instantaneous. |
| `missing_sync_count` | Consecutive-absence counter — see the termination safeguards in C. |

### B4. Which fields could be read TRANSIENTLY and never stored?

- Anything used only to compute one of the above (for example a nested
  employment-record object whose only useful field is the status).
- The vendor's own internal record ids beyond the one we key on.
- **Personal mobile number — unless and only if SMS authentication is adopted.**
  If it is, see the recommendation in D: store a hash and the last two digits,
  not the number, unless the vendor's API cannot be called at send time.

### B5. What sensitive fields currently exist in our database?

**Audited directly against the live schema. The answer is: almost none, and the
current position is good.**

`public.app_users` — the entire user record:

```
id (uuid, = auth.users.id)   email        display_name
role                          status       scope_level
scope_primary_area_id         scope_also_covers_area_ids
created_at  updated_at  created_by  updated_by
```

A pattern search across **every column in the public schema** for
`phone|mobile|ssn|social|dob|birth|address|salary|pay|wage|rate|bank|routing|emergency|benefit|tax|compensation` returns:

- `google_review_*.{canonical,discovered,expected_street}_address` — **salon**
  street addresses, used to match Google listings. Not employee data.
- `spa_conversion_current.spa_conversion_rate` — a business metric.

**There is no employee phone number, date of birth, home address, pay rate,
banking detail, tax identifier, emergency contact or benefits data anywhere in
the database today.** No password is stored or hashed by this application either;
Supabase Auth owns credentials (`supabase/migrations/20260904006000_app_users.sql`).

What *is* sensitive today, and legitimately so, is HR content the product exists
to create: `form_instances.employee_name` / `employee_role` / `location_id` plus
the coaching and disciplinary narrative in the form field values, and chat
conversation text that can name employees. That is manager-authored, not ingested.

### Proposed minimal `employee_access_directory` schema

```sql
create table public.employee_access_directory (
  id                      uuid primary key default gen_random_uuid(),

  -- Identity in the SOURCE system. The join key, and the only stable one.
  source_system           text not null,              -- 'myglow' | 'woven' | …
  external_employee_id    text not null,

  -- The access decision.
  status                  text not null,              -- 'active' | 'inactive'

  -- The role/scope inputs. A job code is NOT a role; see the mapping table.
  job_code                text,
  job_title               text,
  location_ids            text[] not null default '{}',

  -- Login identifiers. Nullable by design: a tanning consultant has neither.
  work_email              citext,

  -- ── Reliability, so an outage can never look like a termination ──────────
  source_updated_at       timestamptz,
  last_seen_in_sync_at    timestamptz not null,
  missing_sync_count      int not null default 0,

  -- ── Admin override, which always wins and always says who and why ────────
  manual_override         text,                       -- 'force_active' | 'force_inactive'
  manual_override_reason  text,
  manual_override_by      uuid references public.app_users (id),
  manual_override_at      timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (source_system, external_employee_id)
);

-- Job code → Ask Sunny role. DATA, not code, so the client can correct a
-- mapping without a deploy. Nothing maps implicitly.
create table public.job_code_role_map (
  source_system  text not null,
  job_code       text not null,
  role           public.app_user_role not null,
  scope_level    public.app_scope_level not null,
  note           text,
  primary key (source_system, job_code)
);

-- Every lifecycle decision, with its cause.
create table public.employee_access_audit (
  id             bigserial primary key,
  directory_id   uuid references public.employee_access_directory (id),
  action         text not null,   -- provisioned | reactivated | deactivated |
                                  -- role_changed | location_changed |
                                  -- override_set | sync_skipped
  before         jsonb,
  after          jsonb,
  cause          text not null,   -- 'sync' | 'jit_login' | 'admin:<uuid>'
  created_at     timestamptz not null default now()
);
```

**Deliberately absent, and it must stay absent:** pay rate, salary, payroll,
banking, DOB, SSN/tax, home address, emergency contacts, benefits, performance
ratings from the HR system, manager hierarchy beyond what scope needs.

**`personal_mobile` is absent too.** It is added only if the client chooses SMS
authentication, and then as `mobile_hash` + `mobile_last2` rather than the number
— see D.

---

## C. Automated employee lifecycle

The architecture below is sound **conditional on** a source system that can
answer "who is active right now" reliably. Nothing here should be built until
Section A's unknowns are resolved.

### New hires — Just-in-Time provisioning

**Yes, this is the right design, and it is a good fit for high turnover.**

```
First login attempt
  → identify the person (email OTP, or employee ID + credential)
  → look them up in employee_access_directory
  → ACTIVE?  create the app_users row, map job_code → role, set scope, sign in
  → not found or INACTIVE?  refuse, with a message naming the HR system
```

Why JIT rather than provisioning everyone on sync: a region with heavy turnover
would otherwise accumulate thousands of `auth.users` rows for people who never
open Ask Sunny. JIT creates an account for the people who actually use it and
leaves the directory as the complete picture.

**The directory row must exist BEFORE first login.** JIT provisions from the
directory; it never provisions from the mere fact that somebody typed an email.

### Terminations — deactivate, never delete

**Never delete the user record.** `app_users.status = 'disabled'` already exists
and is already reversible; historical chat, ratings and filed forms stay intact
and attributable. Deleting would orphan HR records that must remain auditable.

**A failed API response must never deactivate the workforce.** The safeguards,
in the order they matter:

1. **A sync that fails is not a sync.** If the API errors, times out, or returns
   fewer than a floor proportion of the previous run's rows (suggest 80%), the
   run is **abandoned whole**. Nothing is written. This is the single most
   important rule: it makes a catastrophic mass-deactivation structurally
   impossible rather than merely unlikely.
2. **Last successful sync**, recorded per run. If it is older than a threshold
   (suggest 24h), the reconciliation report escalates and no deactivation
   proceeds.
3. **Consecutive missing-sync count.** A person absent from one successful feed
   is not deactivated. Suggest **three consecutive successful syncs**, or
   72 hours, whichever is longer. Turnover is high, but nobody is terminated
   three times in three days.
4. **Explicit `inactive` is faster than absence.** If the source says inactive,
   that is a positive assertion and access is withdrawn on the next successful
   sync. Absence is ambiguous; an explicit status is not.
5. **Fail-closed vs fail-safe, split by risk:**
   - *Login of somebody already provisioned* → **fail-safe**. If the directory
     is unreachable, an existing active `app_users` row still signs in. Ask Sunny
     must not go dark for the whole company because an HR API is down.
   - *JIT provisioning of somebody new* → **fail-closed**. No directory, no new
     account. Creating access from an unverifiable claim is the one thing that
     cannot be undone by a later sync.
   - *Deactivation* → **fail-safe** (do nothing) on any doubt.
6. **Audit log** — every decision, its before/after, and its cause
   (`sync` / `jit_login` / `admin:<uuid>`).
7. **Reconciliation report** — a daily admin-facing diff: provisioned,
   deactivated, role changes, location changes, and everything the safeguards
   *held back* and why. The held-back list is the important half.
8. **Manual admin override** — `force_active` / `force_inactive`, always with a
   reason and an actor, and it beats the sync until cleared. The client will need
   this within a week of go-live; building it later means building it in a hurry.

### Promotions and transfers

**Yes — job code and location changes can update role, permission tier and
location scope with no admin intervention, PROVIDED the mapping is explicit.**

**Do not make external job titles equal authorization roles.** Titles are free
text maintained by people who are not thinking about software permissions; a
retitle from "Salon Director" to "Salon Director I" would silently strip access,
and a new title nobody mapped would silently grant a default. The mapping layer
(`job_code_role_map` above) exists so that:

- an **unmapped job code provisions nothing** — it lands on the reconciliation
  report as "needs mapping", and the person is refused until an admin maps it;
- the client can correct a mapping as data, without a deploy;
- one deliberate exception applies in both directions: **a change that would
  GRANT an administrative role should require admin confirmation.** A promotion
  into `admin`, `owner` or `developer` arriving from an HR field is a privilege
  escalation driven by a system outside our control. Everything below that tier
  can be automatic.

Demotions and transfers apply immediately and automatically — narrowing access
is always safe to automate.

---

## D. Authentication design

### What exists today (verified in code)

| Mechanism | Where | Status |
|---|---|---|
| Email + password | `src/features/auth/sign-in-form.tsx:71` — `signInWithPassword` | **In use** |
| Password reset | `resetPasswordForEmail` → `/reset-password` | In use |
| Admin invitation | `src/lib/admin/user-directory.ts:352,662` — `inviteUserByEmail` | In use |
| `invited` → `active` self-activation | `accept_invitation()`, SECURITY DEFINER, takes no arguments | In use |
| Authorization profile | `public.app_users`, fail-closed: a verified session with no row has **no** access | In use |
| Email OTP / magic link | — | **NOT IMPLEMENTED** |
| Phone / SMS OTP | — | **NOT IMPLEMENTED** |
| PIN | — | **NOT IMPLEMENTED**, and no credential is stored by this app today |

**This is exactly the manual process the client wants to eliminate**: an admin
invites each person by email, and the person sets a password.

### Managers — recommendation: **email OTP (6-digit code) to the work email**

Supabase Auth supports this natively (`signInWithOtp`), and it fits the stated
requirements without inventing anything:

- no manually issued passwords — the requirement, met directly;
- possession of the work mailbox is the proof, which is already how invitations
  and password resets work here;
- it composes with the directory check: OTP proves the mailbox, then
  `employee_access_directory` must show that address **active**, and the
  `app_users` row is created or reactivated from there.

**OTP code rather than magic link**, for one operational reason: managers will
open Ask Sunny inside the **Microsoft Teams** tab, and a magic link opens in an
external browser, producing a session in the wrong place. A six-digit code is
typed where the person already is. (Keep magic link available as a fallback.)

Access scope continues to come from the source system's role and location data
via the mapping layer — never from anything the browser asserts, which is already
this codebase's rule.

**Effort:** small. Supabase supplies the mechanism; the work is the login screen,
the directory check, and the JIT provisioning step.

### Tanning consultants — recommendation: **Employee ID + email OTP to a work-issued mailbox, if one can be created. Otherwise Option 2 (SMS), not Option 1 (PIN).**

The client's two options, evaluated against the criteria in the brief:

| | **Option 1 — Employee ID + PIN** | **Option 2 — Employee ID + SMS OTP** | **Recommended — Employee ID + email OTP** |
|---|---|---|---|
| Security | Weak. Both factors are things the person knows, and the employee ID is semi-public — it is on schedules and rosters. A 4-digit PIN has 10,000 combinations. | Good. Possession of the phone is a real second factor. | Good. Possession of the mailbox, same as managers. |
| User friction | Lowest — until it is forgotten. | ~15s wait for the SMS. | ~15s wait for the email. |
| **Shared-device risk** | **Highest, and this is decisive.** Salon floors run one shared terminal. PINs get watched, written on a sticky note, and shared "just for today". | Low — the code goes to the individual's own phone. | Low. |
| Forgotten credentials | Frequent. Needs a reset path and someone to operate it — the admin burden the client is trying to remove. | Nothing to forget. | Nothing to forget. |
| Employee turnover | Bad fit. Every hire needs a PIN issued; every leaver needs one revoked. | Good fit — nothing is issued. | Good fit. |
| Admin burden | High. | Low. | Low. |
| **Privacy / PII** | None added. | **Requires storing or retrieving personal mobile numbers** — precisely the field the client asked us not to ingest. | **None added.** |
| Supabase compatibility | Not supported natively. We would have to build and own a credential store — which this application has deliberately never done. | Supported (`signInWithOtp` with phone), needs an SMS provider (Twilio/MessageBird) configured. | Supported natively, zero extra vendors. |
| Implementation complexity | **Highest** — hashing, rate limiting, lockout, reset flow, shared-device handling, and the security review that comes with owning credentials. | Medium — provider setup, phone verification, number lifecycle. | **Lowest** — same mechanism as managers. |
| Ongoing cost | None. | ~$0.0079/SMS US. At 400 consultants × 20 logins/month ≈ **$63/month**, plus provider fees. Higher with retries. | None. |

**Why email OTP is worth pursuing first even though consultants "generally do not
have company email":** the sentence to test with the client is not "do they have
email" but "*can* they be issued one". A mail-enabled account in the existing
Microsoft 365 tenancy costs little, is already how Teams identity works — and the
pilot is running *inside Teams*, which means these users may already have a
tenant identity. If they do, this whole question dissolves: they sign in the way
managers do, we store no phone numbers, and there is no SMS bill.

**If they genuinely cannot have mailboxes, choose SMS (Option 2), not PIN.** And
then, on privacy:

- store **`mobile_hash` (HMAC-SHA256 with a server-side pepper) + `mobile_last2`**
  for display ("code sent to •••• 47"), and fetch the real number from the source
  API at send time if the API allows it;
- if it does not, store the number **encrypted at rest, in the directory table
  only**, never in `app_users`, never in logs, and never returned by any API
  response;
- write it down explicitly as the one PII field ingested and why.

**If the client insists on PINs**, it is viable but must be built properly, and
this is what "properly" means:

- **Never store a plaintext PIN.** Argon2id (or bcrypt cost ≥ 12) with a
  per-user salt. Supabase Auth will not do this for you — it would be our own
  credential store, which is a meaningful change in this system's risk profile.
- **Minimum 6 digits**, with obvious sequences and repeats rejected.
- **Rate limit** per employee ID *and* per device/IP: 5 attempts, then
  exponential backoff.
- **Lockout** after 10 failures, requiring a manager or admin unlock — and note
  that this reintroduces exactly the admin burden the client wants gone.
- **Reset** by an authenticated manager, never self-service by employee ID alone
  (self-service by ID is the bypass).
- **Shared-device protection:** short idle timeout (suggest 15 minutes), an
  explicit "switch user" control, no "remember me", and never pre-fill the
  employee ID field.
- **Rotation** every 90 days, and mandatory on first use.

### Is employee ID + PIN sufficiently secure for Ask Sunny's data and actions?

**No, not on its own — and the reason is what Ask Sunny can do, not what it
holds.** A consultant session can read company policy (acceptable) but the
product also creates **coaching and corrective-action records about named
employees**, and chat history contains manager discussion of individuals. Two
shared-knowledge factors on a shared salon terminal is not an adequate control
for a surface that writes HR records.

If PIN is chosen anyway, **pair it with a permission floor**: consultants get
`ask_questions`, `view_knowledge`, `view_videos` (the existing `employee` role,
which already grants exactly those three and denies everything else by absence).
No form creation, no monitoring, no reports. That is defensible. PIN access to a
form-creating role is not.

---

## E. Source-of-truth recommendation

### Recommended: **Hybrid — local directory + periodic authoritative reconciliation**

```
MyGlow / Woven (or whichever is confirmed authoritative)
        │  scheduled sync (or webhook, if one exists)
        ▼
employee_access_directory        ← minimal fields only; the safeguards live here
        │  job_code_role_map
        ▼
app_users  (role, status, scope) ← Ask Sunny's own authorization record
        │
        ▼
Supabase Auth                    ← credentials only; never the org chart
```

| Approach | Verdict |
|---|---|
| **Live validation on every login** | **Reject.** It makes an HR vendor's uptime a hard dependency of Ask Sunny's uptime, adds their latency to every sign-in, and multiplies API calls by login volume against rate limits nobody has confirmed. The client's own stated concern — "Ask Sunny should not become unusable because of a temporary API outage" — rules this out. |
| **Scheduled local sync only** | Close, and nearly right. Its weakness is drift: a termination between syncs leaves access open, and nothing periodically proves the local copy still matches the source. |
| **Hybrid (recommended)** | Local directory for every authorization decision, so Ask Sunny is never blocked by the vendor. A scheduled sync (start at **hourly**, widen once rate limits are known) applies changes. A daily full reconciliation proves the local copy against a complete read and produces the admin report. Deactivation happens only through the consecutive-miss safeguards. Optional live re-check at JIT provisioning only — the one moment where being wrong creates access rather than merely delaying its removal. |

**Which system should be the source of truth** cannot be answered on confirmed
capability, because there is no confirmed capability for either. On the evidence
available, **Woven is unlikely to be the right choice**: this repository treats it
as a document library, and the team's own note records no confirmed API. MyGlow
is the more plausible candidate *by name*, and we have nothing at all on it.

**The recommendation is therefore conditional:** whichever system can supply, in
writing, (1) a full active-employee list, (2) an employee ID stable across
promotions and transfers, (3) `updated_at` or delta support, and (4) a
service-account credential with field-level scoping — that is the source of
truth. If both can, prefer the one that is authoritative for **termination**,
because termination is the decision with the shortest acceptable latency.

---

## Data storage summary

### Persisted
`external_employee_id` · `source_system` · `status` · `job_code` · `job_title` ·
`location_ids[]` · `work_email` (managers, and consultants if mailboxes are
issued) · `source_updated_at` · `last_seen_in_sync_at` · `missing_sync_count` ·
manual override fields · audit rows

### Read transiently, never stored
Anything used only to derive the above · vendor-internal record ids ·
personal mobile at OTP send time (if SMS is adopted and the API permits a
call-time read)

### Never retrieved, never stored
Pay rate · salary · payroll · banking · DOB · SSN / tax identifiers · home
address · emergency contacts · benefits · performance ratings held in the HR
system · any other employee-record field

### Only if SMS authentication is adopted
`mobile_hash` (HMAC-SHA256 + server-side pepper) · `mobile_last2` (display only).
The raw number is stored **only** if the vendor API cannot be read at send time,
and then encrypted at rest, in the directory table alone, never in `app_users`,
never logged, never returned by any API.

---

## Open questions for the client

Only the ones that genuinely block the design.

1. **Which system is authoritative for employment status — MyGlow, Woven, or
   something neither of us has named?** Everything downstream depends on this and
   we have no evidence either way.
2. **Can we have the API documentation, or a support contact, for that system?**
   Specifically: full employee list, filter by active, `updated_at`/delta,
   webhooks, rate limits, auth model, field-level scoping. We will not design
   against assumptions.
3. **Can the connector be granted a scoped, read-only service account limited to
   the ten fields listed above?** If the vendor cannot restrict at the API level,
   we discard at our boundary — but the client should know which of the two it is.
4. **Can tanning consultants be issued mail-enabled accounts in the existing
   Microsoft 365 tenancy?** This is the single highest-leverage question in the
   document. Yes → one authentication method for everyone, no phone numbers, no
   SMS cost, smallest build.
5. **If not, is SMS acceptable given it means ingesting personal mobile numbers?**
   The client asked us not to pull unnecessary HR data; this is the one field
   where a real requirement might outweigh that, and it is their call, not ours.
6. **Who owns the job-code → role mapping, and can we have the current job-code
   list?** An unmapped code refuses access by design, so the first sync needs the
   mapping to exist.
7. **Should a promotion INTO an administrative role (`admin`/`owner`/`developer`)
   apply automatically, or require admin confirmation?** Recommendation:
   confirmation.
8. **What is the acceptable lag between a termination in the HR system and access
   being withdrawn in Ask Sunny?** This sets the sync interval and the
   consecutive-miss threshold. Our proposed defaults are hourly sync and three
   consecutive misses; if they need same-hour removal, the source system must
   assert `inactive` explicitly rather than merely dropping the row.

---

## What was NOT done, deliberately

No provisioning system, no directory sync, no schema migration, no authentication
change, and no connector was built. This was a read-only audit, as requested. The
schema above is a proposal for discussion; nothing has been applied to any
database.
