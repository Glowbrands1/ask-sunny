# Removing the test records from the Overview queue

**For Paulyne.** This is a production data action, so nothing here was done for
you. It is written so it can be carried out without re-deriving any of it.

## 1. What the review saw

> Test data is live on the Overview — Jordan Vance (test), suzy sunshine, Ace
> Test, and a salon called Maple Crossing.

Confirmed. These are live `form_instances` rows created by testing against the
deployment. **Nothing in the repository creates them and no release removes
them** — they can only be cleared in the running app.

## 2. The live state, 14 September 2026

Sixteen outstanding follow-ups — the "16" the review counted. By origin:

| Employee | Salon name | Salon id | Follow-up | Reaches the queue? |
|---|---|---|---|---|
| Jordan Vance (test) | Maple Crossing | `loc-102` | 2026-09-01 | **No** — name off roster |
| Joe | Maple Crossing | `loc-102` | 2026-09-09 | **No** — name off roster |
| suzy sunshine | *(none)* | `loc-109` | 2026-09-01 | **No** — id off roster |
| Ace Test | *(none)* | *(none)* | 2026-09-08 | **Yes** |
| Janine Test ×2 | *(none)* | *(none)* | 2026-09-09 | **Yes** |
| Sara Test | *(none)* | *(none)* | 2026-09-09 | **Yes** |
| Sarah Test | *(none)* | *(none)* | 2026-09-10 | **Yes** |
| Paulyne Test ×3 | *(none)* | *(none)* | 2026-09-09 … 09-11 | **Yes** |
| Sarah | *(none)* | *(none)* | 2026-09-16 | **Yes** |
| Paulyne Co ×3 | *(none)* | *(none)* | 2026-09-17 … 09-23 | **Yes** |
| For Paulyne Co | *(none)* | `loc-0306` | 2026-09-18 | **Yes** — real salon |

**Three of the sixteen are filtered structurally.** The rest carry no salon at
all, and a record with no salon cannot be judged by a roster — which is correct
behaviour, because an administrator's form legitimately carries none. Refusing
those would hide real work.

## 3. What the branch changed, and what it cannot

The roster guard now checks the salon **id** as well as the **name**. That
matters more than it sounds: thirteen of the sixteen rows have a null
`location_name`, so a name-only rule caught almost nothing. `suzy sunshine`
carries `loc-109` — an id from the retired twelve-store demo roster — and is now
caught by the same rule that catches Maple Crossing.

**No name is compiled into the product.** A name in a source file is a guess
that ages badly and cannot be changed without a deploy. The remaining records
are yours to clear, by either instrument below.

## 4. Instrument A — archive (recommended, reversible)

**Screen:** Forms → Form Monitoring (`/forms/monitoring`)
**Action:** open the record, Archive.
**Effect:** sets `archived_at`. `listOutstandingFollowUps` selects on
`archived_at is null`, so the record leaves the Overview queue at once.
**Reversibility:** the row is not deleted. Un-archiving restores it.
**Cache:** the Overview is `force-dynamic` — no revalidation, no deploy. The
next page load is correct.
**Who:** any account that can reach Form Monitoring.

### The eight unambiguous records, by id

Every one carries **no salon** and a name that is plainly a test account. These
are the only ones classified as test data without judgement:

| # | Employee | Form | Follow-up | `form_instances.id` |
|---|---|---|---|---|
| 1 | Ace Test | Coaching | 2026-09-08 | `7dafe953-8e33-40b4-8848-ba20596afbac` |
| 2 | Janine Test | Coaching | 2026-09-09 | `e6bbe2ad-c654-454d-9a5b-3a272127575e` |
| 3 | Janine Test | Coaching | 2026-09-09 | `5c78edd3-65b7-45cb-92a6-e8feb0ebd328` |
| 4 | Sara Test | Coaching | 2026-09-09 | `594c89aa-d923-423f-99dd-fd69882ab20e` |
| 5 | Paulyne Test | Coaching | 2026-09-09 | `0d8e223a-5f8b-4a75-9aae-458d7311e18e` |
| 6 | Paulyne Test | Coaching | 2026-09-09 | `c40443e9-cdfb-4ff3-8a9d-0f673a9a6e36` |
| 7 | Sarah Test | Coaching | 2026-09-10 | `055a1aad-5d9a-485b-94d9-e705ce253dce` |
| 8 | Paulyne Test | Corrective Action | 2026-09-11 | `74fd108f-6cb8-4054-b7dd-45f378c3d725` |

### Do NOT archive these without deciding first

| Employee | Form | Follow-up | Why it needs judgement |
|---|---|---|---|
| Sarah | Coaching | 2026-09-16 | No "Test" in the name. Could be a real person. |
| Paulyne Co | Coaching | 2026-09-17 | Looks like your own account doing real work |
| Paulyne Co | Corrective Action | 2026-09-18 | As above |
| Paulyne Co | Corrective Action | 2026-09-23 | As above |
| For Paulyne Co | Corrective Action | 2026-09-18 | **Filed against MO Kansas City Wornall, a real salon** |
| Joe | Coaching | 2026-09-09 | Already filtered (Maple Crossing), but the person may be real |

Jordan Vance (test) and suzy sunshine are already filtered structurally. Leave
them alone unless you want them out of Form Monitoring too — being filtered is
not a reason to delete anything.

### Doing it by API instead of by clicking

The same approved action, if eight clicks is tedious. Signed in as an account
holding `manage_form_records`:

    PUT /api/forms/instances/{id}
    Content-Type: application/json

    {"archived": true}

`{"archived": false}` puts it back. The handler touches **only** `archived_at` —
never `status`, never `finalized_at`, never a field value — so a finalized HR
document keeps its immutability. See `archiveInstance` in `lib/forms/instances.ts`.

## 5. Instrument B — the exclusion list (no per-record work)

**Where:** the deployment's environment, not the app.
**Variable:** `ASK_SUNNY_EXCLUDED_EMPLOYEE_NAMES` — comma-separated, compared
case- and whitespace-insensitively. **Empty by default**, so it excludes nothing
until you set it.

    ASK_SUNNY_EXCLUDED_EMPLOYEE_NAMES=Ace Test,Janine Test,Sara Test,Sarah Test,Paulyne Test

**Effect:** those records stop reaching the Overview queue and stay in Form
Monitoring.
**Reversibility:** clear the variable.
**Cache:** read per request; a redeploy applies it.
**Trade-off:** it is a standing rule rather than a decision per record, so a
real employee who happens to share one of those names would also be filtered.
Archiving is cleaner for a fixed set of known rows; the list is better if
testing continues under the same names.

Use one or the other. Both together is harmless but makes it harder to see why
a record is absent.

## 6. Nothing is deleted, and nothing is hidden from its own screen

Form Monitoring shows everything, archived records included. The filter applies
only to the Overview queue — a summary for a manager's morning, which is the
surface the review was reading. An administrator can always see the full set.

## 7. Can Maple Crossing reappear through another query path?

Checked every path that reads form instances:

| Path | Shows Maple Crossing? | Why |
|---|---|---|
| Overview follow-up queue | No | roster guard, on name and id |
| Form Monitoring | **Yes, by design** | this is where records are reviewed and archived |
| Global search (form hits) | Yes | searches Form Monitoring's own list; same records, same screen |
| Chat form proposals | No | proposes a salon from the roster; see `proposeLocation` |
| Ask Sunny report briefing | No | reads reporting tables, not form instances |
| Reports | No | different tables entirely |

So the answer is **no, except on the screen whose job is to show it**. The one
thing to know: if the four named rows are archived rather than excluded by
configuration, they disappear from the Overview and remain findable in Form
Monitoring — which is the intended end state.

## 8. Afterwards

The Overview's follow-up card states its own arithmetic (overdue + due this week
+ due later = total) and names how many records were excluded. Once the test
rows are cleared, that count should fall and the three tiles should still sum to
the total. If they do not, that is a defect rather than leftover data.
