# Phase 3 Remediation 2 — prefill sync, current-salon access, correct monitoring query

Branch: `feature/chat-native-forms-marissa-feedback`
Started from: `ce2cf28`
Status: **implemented, automated gate green, Preview QA outstanding.**

Three findings raised against Remediation 1. All three closed.

**No migration. No schema change. Nothing merged, nothing deployed. No Finalize
UI, no PDF UI.**

---

## Finding 1 — AI prefill and inline editor race

Remediation 1 fixed reference durability correctly, and that fix **exposed** a
second race rather than causing it.

```
POST create  →  onCreated(reference)  →  POST .../draft   (up to 120s)
                       ↓
                 editor renders
                 editor GETs the instance      ← seeded values
                                                  …Sunny writes the real ones…
                 editor never refetches         ← screen keeps the stale version
```

**Two failures in one.** The manager sees an empty-looking form and concludes
Sunny did not fill it in — when the backend had succeeded, which is Marissa's
requirement *appearing* not to work. And if they start typing, their edit and the
assistant's write land on the same canonical record in whatever order the
requests happen to arrive.

### Prefill state flow

```
CREATING INSTANCE
  → INSTANCE CREATED / REFERENCE PERSISTED   ← unchanged, still immediate
  → SUNNY PREFILLING                          read-only, honest notice
  → PREFILL COMPLETE  → canonical reload → EDITABLE
  or
  → PREFILL FAILED    → canonical reload → EDITABLE + warning
```

`PrefillState` is `running | complete | failed | unknown`, owned by
`FormProposalCard` and read by `InlineForm`.

### Reference durability preserved

**The Remediation 1 invariant is untouched and is re-asserted by its own test in
this phase.** `onCreated` still fires synchronously between the create and the
drafting request; the reference is still persisted before anything that can fail
or take time. Only the *editability* of the form is deferred, not its existence.

### Canonical post-draft reload

`prefill.kind` is in the fetch effect's dependency list. When it moves from
`running` to `complete` or `failed`, the editor **re-reads
`GET /api/forms/instances/[id]`** and renders what came back.

**The reload is a GET, not the draft response.** The drafting endpoint returns
the values it accepted, and copying those into React would be quicker and wrong:
`applyAssistantDraft` re-filters them, and the policy guard can withhold a field
the model wrote. A value the server refused would sit on screen looking saved.
The canonical read stays the only authority — asserted by a fake whose draft
response carries `values: {}`, so anything visible came from the re-read.

### Manager-vs-AI write race result

While `prefill.kind === "running"`:

- every control is `disabled`;
- **there is no Save button at all** — not a disabled one;
- the card shows *"Draft created. Sunny is filling it in from your
  conversation…"* and *"Editing opens as soon as Sunny is finished."*;
- **no PATCH is fired**, asserted directly.

Editing opens only after the canonical reload.

**One defect found while making this change, and fixed.** `readOnly` now covers
two different situations — frozen and busy — and the status badge was driven
from it, so a form would have read **"Finalized"** while it was an unsigned
draft being prefilled. A false statement about an HR record, and the kind
nobody re-reads. The badge reports `instance.status`; `readOnly` governs the
controls.

### Refresh-during-prefill result

**Audited, and solved with the existing event trail — no schema.**

`applyAssistantDraft` records a `drafted` event, and `loadInstance` already
returns the events. So on a conversation reopened from IndexedDB
(`prefill: unknown`):

| Form | Behaviour |
|---|---|
| `source: "ask_sunny"`, no `drafted` event | *"Sunny's prefill has not completed for this draft…"* |
| `source: "ask_sunny"`, `drafted` present | nothing — prefill finished |
| `source: "manual"` | nothing — nobody asked Sunny to fill it |

**The honest limit, stated rather than papered over:** the absence of that event
**cannot distinguish still-running from permanently-failed**. Both look identical
from a fresh tab, and telling them apart would need somewhere to record that a
request *started* — a schema change this phase does not have.

So the wording claims neither. It says prefill has **not completed**, which is the
only thing certainly true, and adds that reopening the form later will show
whatever Sunny wrote. The form stays **editable**, because a manager who reopened
a real draft must be able to work on it. What it never does is let a stale read
be mistaken for a finished one.

### Draft failure result

Unchanged and re-asserted: the reference remains, no second form, nothing
deleted, the canonical instance loads, the editor becomes usable, and the
existing warning stands —

> "Your draft was created, but Sunny couldn't prefill the details. You can
> complete them below."

A failure thrown *after* the row existed also moves prefill to `failed`, so the
editor is never left waiting on something that will not settle. Only a failed
**create** releases the double-submit guard.

---

## Finding 2 — Creator override bypassed current salon scope

`actorMaySeeInstance` tested `createdBy === actor.id` **before** the location
rule, so authorship overrode assignment:

> A manager files a coaching record at salon A. They transfer; their scope
> becomes salon B. Their AccessScope no longer covers salon A at all — and they
> could still open, edit, finalize, archive, delete and export that record,
> because they had once created it.

It also punched through district/region fail-closed for any historical record
those actors had created themselves.

### Current-salon policy

The order of the two branches is the whole fix.

| Record | Actor | Result |
|---|---|---|
| **names a salon** | salon | id must be in `{primaryAreaId} ∪ alsoCoversAreaIds` — **creator does not override** |
| **names a salon** | district / region | **refused** — fails closed, creator does not override |
| **names a salon** | global | allowed under ordinary permissions |
| **no salon** | non-global | **creator only** |
| **no salon** | global | allowed |
| any | demo (no scope) | not enforced — a browser-asserted scope is not a control |

Authorization here answers *"may this person see this salon's HR records
today"*, and the answer changed when they moved.

### Null-location creator policy

A record naming no salon has no scope to be decided by. Refusing everybody would
strand real work; allowing everybody would make `locationId: null` **the way to
opt out of the boundary**. So it belongs to whoever created it, and to nobody
else below global.

That is a narrow exception about an **absent** salon — not an override of a
present one.

### Transferred-manager test

Seeded exactly as specified: record `createdBy: user-a`, `locationId: loc-a`;
actor `user-a`, scope `salon` / `primaryAreaId: loc-b`.

- `actorMaySeeInstance` → **false**
- `GET`, `PATCH`, `POST` (finalize), `PUT` (archive), `DELETE` → **404**, and
  `touched` is empty on every write
- absent from Form Monitoring
- **regains access if assigned back** — the guard on the guard, so the refusals
  are the scope and not a broken fixture
- their own **null-location** record stays reachable from anywhere
- a district actor still cannot reach a salon record they created

`draft`, `follow-up` and `pdf` route through the same centralized
`authorizeInstance`, so they are covered by construction and by Remediation 1's
existing per-route tests.

---

## Finding 3 — Monitoring filter happened after a global limit

```
listInstances(view)   ORDER BY created_at DESC  LIMIT 200   ← whole company
visibleInstances(actor, rows)                               ← then filter
```

Confidential — no foreign row reached the browser — and **wrong as a history**.
With 22 locations it is a matter of time: 200 newer records exist elsewhere, a
salon's own still-relevant record is number 201 by date, it never enters the
page, and no filter can return what the query never fetched. Its manager opens
Form Monitoring to find rows quietly missing, with nothing on screen saying so.

**Not fixed by raising 200.** That trades a wrong answer for a later wrong answer
and a bigger payload. The ordering of filter and limit is the bug.

### Scope-aware monitoring query

`listInstances(view, limit, filter?)` with

```ts
InstanceListFilter = {
  locationIds?: string[];              // undefined = unrestricted
  ownNullLocationCreatedBy?: string;
}
```

built by `instanceListFilterFor(actor)` — the same policy as
`actorMaySeeInstance`, expressed as a query.

| Actor | Reads |
|---|---|
| global / preview | one ordered, bounded query — unchanged |
| salon | `location_id IN (their salons)` **plus** their own `location_id IS NULL` rows |
| district / region | **no salon query issued at all** (empty id list), own null-location rows only |

Two bounded reads at most, each ordered and limited independently — so no more
than `2 × limit` rows are ever read, and the top `limit` of the union is always
contained in the union of the two tops. Merged, de-duplicated and sorted
**server-side**, then limited again. Nothing extra reaches the browser.

An empty id list **skips the salon query entirely** rather than issuing
`in.()`, which PostgREST does not accept.

`visibleInstances` still runs afterwards, and that redundancy is deliberate: the
query decides what is **read**, the predicate re-checks what is **returned**, and
the predicate is the one that fails closed if they ever drift.

### 200+ foreign record test

Run against the **fake Supabase client**, not a mocked `listInstances` — the fix
*is* the query, and mocking it away would assert only that mocks return what they
were told to.

Seeded: one salon-A record, then **260 newer foreign records** across 21 other
locations.

- **Guard on the guard:** unrestricted, the salon-A record is genuinely off the
  200-row page.
- Scoped, it **is returned**.
- No foreign row appears at all.
- The caller's own null-location record appears; somebody else's does not.
- With 250 own records the result is bounded at 200 **of their own**, newest
  first, de-duplicated.
- District/region: empty result for located rows, own null-location rows kept.
- Global: one ordered bounded read, unchanged.
- The archived view narrows the same way.

---

## Files changed

**New**

- `src/lib/forms/monitoring-completeness.test.ts`
- `docs/chat-phase-3-remediation-2.md`

**Modified**

- `src/features/chat/inline-form.tsx` — `PrefillState`, dependency-driven
  canonical reload, read-only while prefilling, `prefillNoticeFor`
- `src/features/chat/message-bubble.tsx` — owns the prefill state; `rowExists`
  distinguishes a failed create from a failure after the row existed
- `src/lib/forms/instance-scope.ts` — location rule before the creator
  exception; `instanceListFilterFor`
- `src/lib/forms/instances.ts` — `InstanceListFilter`, two-read scoped query
- `src/app/api/forms/instances/route.ts` — passes the filter
- `src/features/chat/inline-form.dom.test.tsx`,
  `src/app/api/forms/instance-scope.test.ts` — new coverage

## Tests

| Finding | Where |
|---|---|
| 1 prefill sync | `features/chat/inline-form.dom.test.tsx` (R2-F1, 9 tests) |
| 2 transferred manager | `app/api/forms/instance-scope.test.ts` (R2-F2, 6 tests) |
| 3 monitoring completeness | `lib/forms/monitoring-completeness.test.ts` (R2-F3, 13 tests) |

## Mutation check results

| # | Mutation | Result |
|---|---|---|
| A | canonical reload after prefill removed | **2 failed** |
| B | editor editable while the draft is pending | **1 failed** |
| C | unconditional `createdBy` visibility restored | **3 failed** |
| D | global limit before actor filtering restored | **1 + 5 failed** |
| E | district/region fail-closed removed on a located row | **3 failed** |
| F | status badge driven by `readOnly` again | **1 failed** |

All reverted, full suite re-run green, none committed.

## Gate

| Check | Result |
|---|---|
| `npx vitest run` | **2687 passed, 7 skipped, 134 files** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |

Baseline before this remediation: 2655 / 7 / 133 (verified, not assumed).

## Nothing that already passed was regressed

Re-run green: immediate `formInstanceRef` persistence, atomic conversation
patch, "Sarah Test" continuation, continuation tampering defences, per-template
edit permissions, cross-salon UUID 404s, PDF and follow-up scope guards, live
`locationName` dropping, the shared bounded manager context,
`source = ask_sunny`, no `/forms/create` redirect, the responsive inline form,
manager typing preserved on save failure, and no migrations.

---

## Preview manual QA still required

Not claimed. jsdom is not a browser and nothing here ran against live data.
With **synthetic employee data**:

1. Create a Coaching draft from chat.
2. The reference appears and persists immediately.
3. While Sunny is filling it: a visible honest loading state, **no editable
   stale fields**, no Save button.
4. When prefill finishes: the conversation-derived text appears **automatically**,
   with no refresh.
5. Edit and save.
6. Refresh; the same form returns.
7. Refresh *during* prefill: the honest "has not completed" notice, editable.
8. A manager who no longer covers salon A cannot open a salon-A record they
   originally created.
9. Authorized records stay visible in Form Monitoring regardless of unrelated
   foreign record volume.

## Not done

- **Finalize UI — NO. PDF UI — NO. Start another — NO. View in Form Monitoring —
  NO.** All Phase 4.
- **Still-running vs permanently-failed prefill after a refresh** — not
  distinguishable without schema. Stated, not invented.
- **Network-retry idempotency** — unchanged from Phase 3; still needs a
  migration, still not claimed.
- **A salon roster** — district and regional actors remain fully fail-closed.
