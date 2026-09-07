# Phase 3 Remediation 1 — five QA findings

Branch: `feature/chat-native-forms-marissa-feedback`
Started from: `62e109a`
Status: **implemented, automated gate green, Preview QA outstanding.**

Five findings raised against the Phase 3 checkpoint. All five are closed, plus
two routes the brief did not list and one authorization hole found while
auditing them.

**No migration. No schema change. Nothing merged, nothing deployed. No Finalize
UI, no PDF UI.**

---

## Finding 1 — Form reference durability

**The window.** `createInlineForm` built the reference right after the create
returned but only **returned** it at the end, so the caller learned about it
once drafting had settled. The drafting route allows `maxDuration = 120`. For
that whole window a real HR record existed in Postgres — already visible in Form
Monitoring — while the chat thread still showed **Create draft** as though
nothing had been created. A second click, or a reload, filed a second
disciplinary record for the same conversation.

**The fix.** The reference is reported through an `onCreated` callback fired
**synchronously after the create resolves and before the drafting request is
made**. The card persists it there, so the action stops rendering immediately.
A drafting failure remains a warning that unwinds nothing.

```
POST /api/forms/instances     →  onCreated(reference)  →  POST .../draft
```

Order asserted directly: `expect(order).toEqual(["create-request", "onCreated",
"draft-request"])`, plus a test that hangs the drafting promise forever and
still sees the reference reported.

---

## Finding 2 — Atomic conversation message patch

**The race.** Message changes were persisted as

```ts
updateConversation(id, { messages: activeConversation.messages.map(...) })
```

`setConversations` is functional and safe; **the patch was a snapshot**, mapped
over an array captured when the callback was created. Any turn added between
that capture and the write was erased by it. `send()` had the same shape,
rebuilding the array from its own `history` snapshot.

The window is the one from Finding 1 — up to two minutes — and what a person
does while waiting is type.

**The fix.** Two new store mutators that do their work **inside** the updater:

| Mutator | Rule |
|---|---|
| `patchConversationMessage(convId, msgId, patch)` | maps against current state; a message that no longer exists is a **no-op**, not a resurrection |
| `appendConversationMessages(convId, messages)` | appends to current contents; cannot overwrite anything |

`send()` now appends both the user turn and the answer instead of rewriting the
array. `history` remains a snapshot — correctly, because that is what the model
was asked about.

Tested by calling through a deliberately **stale** store reference, exactly as
an in-flight callback would.

---

## Finding 3 — Natural proposal continuation

**The defect.**

```
Manager: "Build me a coaching form for that."
Sunny:   "I don't yet know who this form is about…"
Manager: "Sarah Test"          ← routed into ordinary retrieval
```

`detectTemplateIntent` found no form words in a person's name, so the manager
answered a direct question and got a knowledge-base answer. The proposal ended
silently.

### The continuation contract

A **bounded hint**, and the bound is the whole safety argument:

```ts
ProposalContinuation = { templateKey: string }
```

**A template key. Nothing else.** No employee, no salon, no topic, no field
value, no status the server would trust. This is explicitly *not*
`pendingFormValues` — that carried half-filled HR values on an assistant turn
and let anything still missing become a default on the next.

Emitted client-side only when the **last assistant turn** carries a proposal
that has not become a form (`continuationFor`). A conversation that moved on to
an ordinary answer has ended the exchange; a proposal that became a real form is
finished.

Honoured server-side only when **both** hold:

1. the hint names a template that revalidates — published, active, current
   version published, and the actor holds its `required_permission`;
2. **the turn reads as an answer** — `extractEmployeeNames` yields a name.

### `"Sarah Test"` follow-up result

Continues the same Coaching proposal, `employeeName: "Sarah Test"`, status
`ready`. Every fact is **re-derived** from the manager's turns: a follow-up
naming someone else simply wins, because nothing is merged out of an earlier
turn.

Without the hint the identical turn returns `null` and goes to retrieval — the
guard on the guard, so the test measures the hint and not the sentence.

### Continuation tampering defence

| Attempt | Result |
|---|---|
| hint names a template that does not exist | "not published", no proposal |
| hint names one the role cannot create | "your role cannot create…", no proposal |
| hint names an unpublished template | no proposal |
| hint sent on a district-scoped actor | salon still unresolved, no create action |
| hint sent with a knowledge question | falls through to retrieval |

The most a forged hint achieves is a proposal the caller could have got by
typing the template's name — which creates nothing and authorizes nothing.

`"what is the tardiness policy?"`, `"how do I coach someone…"`, `"never mind"`
and a capitalised instruction all still reach retrieval.

---

## Finding 4 — Existing form instance access scope

**What was open.** Phase 2 authorized the salon a form is **created** against.
Nothing authorized the salon of a form being read, edited, drafted, finalized,
archived, deleted or **exported as a PDF**. Form Monitoring listed every form in
the company to anybody holding `view_form_monitoring` — which is every manager
role.

A Salon Director at salon A who knew a UUID could open, edit, finalize and
delete a disciplinary record belonging to salon B. Creation being locked while
everything after it was open is the worst shape this could take, because it
reads like the boundary exists.

**Second hole, same routes.** Every editing verb hard-coded
`create_coaching_form`, so a Salon Director could save, draft, finalize and set
follow-ups on an **EPP** — which the matrix gives to district managers and
above.

### The guard

`lib/forms/instance-scope.ts`. `authorizeInstance(request, id, action)`:

1. **Load the instance** — our own database, our own key, nothing returned to
   the caller. It must happen first because step 2 cannot be asked until the
   template is known.
2. **Authorize on the template's own permission** for an `edit`;
   `view_form_monitoring` for a `view`; `manage_form_records` for a `manage`.
3. **Check the scope**, and refuse as a **404**.

### Individual instance scope policy

| Actor | May touch |
|---|---|
| salon | forms at a salon on their own assignment |
| global | everything |
| district / region | **nothing** — fails closed, exactly as creation does |
| demo (no scope) | everything — a browser-asserted scope is not a control |

Applied to **all nine** verbs: `GET`, `PATCH`, `POST` (finalize/revise), `PUT`
(archive), `DELETE`, `POST .../draft`, `PUT .../follow-up`, `POST
.../follow-up`, `GET .../pdf`. The last three were **not in the brief's list**
and had the same hole; the PDF one returned another salon's finalized
disciplinary document as a downloadable file.

### 404, not 403 — and why that is the opposite of creation

Creating names a salon the **caller chose**, so a refusal is a 403 that says
which and why: they need to know.

Reading names a **UUID and nothing else**. A 403 would confirm that a guessed
UUID names a real form at a salon they do not cover — an existence oracle over
other people's HR records, one guess at a time. So an unauthorized instance
answers exactly as a missing one: same status, same wording, asserted by
comparing the two responses byte for byte.

### Null-location policy

A form can legitimately carry no salon: Phase 2 allows creating one without
naming a location, and older rows predate the column being used. Refusing
everybody would strand real work; allowing everybody would make
`locationId: null` **the way to opt out of the boundary**.

**A form with no salon belongs to whoever created it, and to global actors.**
Every manager's own work stays reachable; nobody else's opens.

### Form Monitoring scope policy

Filtered **server-side**, in the route, by `visibleInstances(actor, …)` — the
same predicate the per-instance guard uses, so the list and the detail view
cannot disagree. Not in the screen: the rows would still have crossed the wire,
and `GET /api/forms/instances` is callable without the screen.

The demo-sweep counts are scoped by the same rule — an unscoped count would
offer a "Delete 3" that removed one, and would leak how many exist elsewhere.

### Per-template permission fix

`permissionFor(instance, action)` resolves `instance.templateKey` →
`getTemplateByKey` → `requiredPermission`. `view` and `manage` stay
template-agnostic by design: reading the history and managing the record are
jobs about forms in general. `edit` is not.

A form whose template has since been removed falls back to
`manage_form_templates` — deliberately **stricter** than any create permission:
if the library no longer describes the document, only somebody who administers
the library should be writing into it.

---

## Finding 5 — Context parity

**The mismatch.** `managerContext()` (server) truncated an over-long current
turn and kept it. `draftNotesFromConversation()` (browser) walked oldest-first
and stopped at the first overflow. Two implementations of one rule.

They agreed on ordinary conversations and disagreed on exactly the case that
matters.

### Overlong current message fix

A manager who typed more than 4,000 characters got a proposal built from their
truncated account — shown, correct — and then a form drafted from an **empty
string**, because the browser found that same message already over budget and
retained nothing. The flow reported *"there wasn't enough in the conversation
for Sunny to prefill it"* about a message they had just written 5,000
characters of.

**The fix.** `lib/forms/bounded-context.ts` — one pure implementation, no
`server-only`, no imports. Both sides call `boundManagerTurns`.

| Property | Both sides |
|---|---|
| current turn priority | retained first, always |
| prior turns | newest → oldest |
| does not fit | **stops**, never skips to an older shorter one |
| final order | chronological |
| char limit | 4,000, separators counted |
| turn limit | 6 including the current |
| over-long current | cut deterministically, marker appended, `truncated: true` |
| who counts | manager turns only, no failed turns |
| dropped content | cannot be resurrected — the ids are the filter |

Asserted by direct comparison: for the same conversation,
`browser.text === server.text`, `browser.usedMessageIds === server.ids`,
`browser.truncated === server.truncated`.

`context-limits.ts` is gone; its numbers live in `bounded-context.ts`.

---

## Location name trust result

**Enforced server-side now, not just avoided by chat.**

`primaryLocationName` resolves `user.scope.primaryAreaId` through
**`DEMO_LOCATIONS`** (`session-context.tsx:238`), and `areaLabel()` falls back to
returning the raw id when the lookup misses. There is no salon roster. So a
`locationName` arriving at the create route is demo data or the id again, bound
to the validated location by nothing.

`resolveLocationName(locationId, requested)`:

- **live mode → always `null`.** A wrong salon *name* on a disciplinary record
  reads as verified to everybody who opens the file later, and the record
  outlives the caveat.
- **demo mode → kept**, explicitly synthetic: preview carries the standing
  synthetic-data notice, the demo salon names are the point of the fixture, and
  nothing there is an HR record.
- **no authorized `locationId` → `null` regardless**, so an id and a name never
  become two independent authorities.

This closes the standalone **Create a Form** builder too, which still sends a
`DEMO_LOCATIONS` name — it is dropped at the route rather than at each caller.
The validated `locationId` is kept in every case.

Goes away the day a roster exists, at which point the name is resolved
server-side from the validated id and still not read from the request.

---

## Files changed

**New**

- `src/lib/forms/bounded-context.ts` — the one bounding algorithm
- `src/lib/forms/instance-scope.ts` — the per-instance guard
- `src/lib/forms/proposal-continuation.ts` — the bounded hint
- `src/lib/forms/proposal-continuation.test.ts`
- `src/lib/store/conversation-patch.dom.test.tsx`
- `src/app/api/forms/instance-scope.test.ts`
- `docs/chat-phase-3-remediation-1.md`

**Removed**

- `src/lib/forms/context-limits.ts` — absorbed by `bounded-context.ts`

**Modified**

- `src/lib/forms/proposal.ts`, `draft-notes.ts` — delegate to the shared window
- `src/lib/ai/form-proposal.ts`, `types.ts`, `server-ask.ts` — continuation
- `src/app/api/chat/route.ts` — bounded hint validation
- `src/app/api/forms/instances/route.ts` — scope-filtered list, live
  `locationName` boundary
- `src/app/api/forms/instances/[id]/route.ts`, `[id]/draft`, `[id]/follow-up`,
  `[id]/pdf` — `authorizeInstance` on every verb
- `src/lib/store/app-store.tsx` — atomic mutators
- `src/features/chat/chat-screen.tsx`, `message-bubble.tsx`,
  `create-inline-form.ts` — eager reference, atomic patch, hint
- test suites for each of the above

---

## Tests

| Finding | Where |
|---|---|
| 1 reference durability | `features/chat/create-inline-form.test.ts` (F1) |
| 2 atomic patch | `lib/store/conversation-patch.dom.test.tsx` (F2) |
| 3 continuation | `lib/forms/proposal-continuation.test.ts` (F3), `lib/ai/form-proposal.test.ts` (F3) |
| 4 instance scope | `app/api/forms/instance-scope.test.ts` (F4) |
| 5 context parity | `lib/forms/draft-notes.test.ts` (F5, 23) |
| location name | `app/api/forms/location-authority.test.ts` (30) |

Every fixture in the scope suite holds **two salons' data**, and each group
proves the foreign form is reachable by somebody before proving the salon-A
manager cannot reach it.

## Mutation check results

| # | Mutation | Result |
|---|---|---|
| R-A | reference reported only after drafting | **2 failed** |
| R-B | message patch uses a stale snapshot | **1 failed** |
| R-C | continuation hint ignored | **6 failed** |
| R-C2 | hint honoured on every turn, not only an answer | **5 failed** |
| R-D | no scope check on an existing instance | **11 failed** |
| R-E | `create_coaching_form` hard-coded again | **2 failed** |
| R-F | Form Monitoring lists everything | **3 failed** |
| R-G | oldest-first browser bounding restored | **3 failed** |
| R-H | `DEMO_LOCATIONS` name persisted in live mode | **1 failed** |

All reverted, full suite re-run green, none committed.

R-E initially failed only a source assertion — the matrix gives Salon Director
both `create_coaching_form` and `create_corrective_action`, so a DPOA could not
distinguish them. Rewritten around an **EPP** at the caller's own salon, where
`create_epp` is genuinely withheld from a Salon Director and scope cannot be
what refuses it. It then failed two, one of them behavioural.

## Gate

| Check | Result |
|---|---|
| `npx vitest run` | **2655 passed, 7 skipped, 133 files** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |

Baseline before remediation: 2597 / 7 / 130 (verified).

---

## Preview manual QA still required

Nothing here ran in a browser or against the live database. In addition to the
Phase 3 checklist, with **synthetic employee data**:

1. Answer *"who is this form for?"* with a bare name → the same proposal
   continues, no knowledge answer.
2. Ask a knowledge question while a proposal is open → an ordinary answer.
3. Click **Create draft**, then type a message while it works → the message
   survives, and the form appears with the reference intact.
4. Refresh mid-draft → the form is there once, not twice.
5. Form Monitoring shows only your own salon's forms.
6. A form you did not create, at another salon, is not reachable by URL.

## Not done

- **Finalize UI — NO.** **PDF UI — NO.** **Start another — NO.** **View in Form
  Monitoring — NO.** All Phase 4.
- **No migration.** The network-retry idempotency gap from Phase 3 still needs
  one and is still not claimed as solved.
- **A salon roster.** District and regional actors remain fully fail-closed —
  now on reading existing records as well as creating them.
