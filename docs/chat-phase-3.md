# Phase 3 — Create and edit the real coaching draft inside chat

Branch: `feature/chat-native-forms-marissa-feedback`
Started from: `1dd890a`
Status: **implemented, automated gate green, Preview QA outstanding.**

Marissa's primary request, made real: a conversation becomes a canonical
`form_instances` row, drafted from what the manager actually said, edited and
saved without leaving the chat thread.

**No migration. No schema change. Nothing merged, nothing deployed. No Finalize,
no PDF.**

---

## Part 1 — Phase 2 context remediation

### The defect

`managerContext()` walked the retained turns **oldest → newest** and stopped at
the first one that would overflow the character budget. Old content — already
said, possibly already superseded — spent the budget before the manager's newest
words were ever considered:

```
turn 1 (long)   "Sarah was late three times this week..."
turn 2          "Correction — it was twice, not three times."   ← DROPPED
```

Every other bounding failure produces a **thin** draft. This one produces a
**confident wrong** draft: an occurrence count stated as fact on a disciplinary
record that the manager had explicitly retracted.

### The algorithm now

Retention runs in **priority** order; presentation runs in **time** order.

1. **The current turn is retained first, always.** It can never be crowded out
   by older content.
2. Prior turns are considered **newest → oldest** while budget remains.
3. The retained set is **restored to chronological order** before it reaches
   drafting — an account reads forwards, and reversing it would misstate the
   sequence of events.
4. `sourceMessageIds` names **only retained** messages. A turn dropped for
   budget has no id downstream, so nothing can quote a turn that was never
   supplied.
5. Assistant turns and failed turns stay excluded, structurally.

**Stop, do not skip.** When a prior turn does not fit, the walk *stops* rather
than skipping it to squeeze in an older, shorter one. Skipping would reintroduce
the same recency inversion in miniature.

**An over-long current message is cut visibly.** If the current turn alone
exceeds the budget it is truncated deterministically and a marker is appended —
`[This message was longer than Ask Sunny reads at once and was cut here.]` — and
`ManagerContext.truncated` is set. A silent cut would leave the model drafting
from a partial account with no way of knowing it was partial.

`MANAGER_CONTEXT_TURNS = 6` and `MANAGER_CONTEXT_CHARS = 4_000` are unchanged.
They moved to `lib/forms/context-limits.ts` (no `server-only`, no imports)
because the browser now assembles the same bounded notes from the same
conversation and must not hold a second copy of the numbers.

---

## Part 2 — Phase 3

### Scope

**Coaching Form only** for inline creation. Phase 2 continues to recognise and
propose every other published template; those proposals get **no create action**
rather than one that does nothing. The supported set is named once, server-side,
in `lib/ai/form-proposal.ts`.

### Proposal → canonical instance

```
[Create draft]
  → POST /api/forms/instances            { templateKey, employeeName, locationId, source: "ask_sunny" }
  → reference reported IMMEDIATELY       { instanceId, proposalId, templateName }
  → POST /api/forms/instances/[id]/draft { notes }
```

Four values are sent, and **every one is re-derived or re-checked server-side**.
No template version, no status, no field values, no `locationName`, no
`templateName`, no `createdBy`.

### The server remains the authority

The proposal lives in browser IndexedDB and is treated as untrusted
orchestration metadata. On every create, `POST /api/forms/instances`:

| Check | Where |
|---|---|
| template exists **and is active** | the route (`getTemplateByKey`) |
| template active, current version published, version **pinned** | `createInstance` (`getCurrentVersion` → `template_version_id`) |
| `template.required_permission` | `authorizeForms` → `DEFAULT_PERMISSION_MATRIX` |
| authenticated actor | `authorizeRequest` (validated session, `app_users`) |
| `locationId` against `AccessScope` | `authorizeLocation` (Phase 2) |

**One route hardening was added:** the route now refuses an **inactive**
template with a 404 rather than letting it through to `createInstance`. Without
it, an inactive template's `required_permission` was applied to the caller and
the eventual refusal surfaced as a generic 500. That matters now that a proposal
carried in browser-local storage can name a template retired after the
conversation started. `createInstance`'s own check stays — a rule that only
lives in a route is a rule the next route forgets.

The proposal selects an **intent**. The Forms server creates the **record**.

### Location — the safe path works without a roster

Phase 3 works today for a **live authenticated salon-scoped actor with exactly
one authorized salon id**, because Phase 2 resolves that deterministically from
`AccessScope`. Everything else fails closed and offers no create action:

| Actor | Create draft? |
|---|---|
| Salon, exactly one authorized id | **Yes** |
| Salon, several authorized ids | No — no guessing, and no picker invented from `DEMO_LOCATIONS` |
| Salon, none assigned | No |
| District / region | No — fails closed, salon membership unverifiable |
| Global | No — nothing authoritative to fill in |

`supportsInlineDraft` is set server-side and is true only when the template is
supported **and** the proposal's status is `ready`. It is a presentation hint;
flipping it in the browser gains nothing, because the route re-checks everything.

### Salon roster limitation

Still required for the complete production experience, and it still blocks:
district and regional salon-membership resolution, a usable picker across
several salons, and authoritative salon-name lookup. It does **not** block the
single-authorized-salon path, which is the case this phase ships.

### Location name — trust finding

**Audited: `primaryLocationName` is not authoritative and is not persisted.**

`lib/session/session-context.tsx:238` resolves it by looking
`user.scope.primaryAreaId` up in **`DEMO_LOCATIONS`** — a seeded demo file whose
ids are `loc-101`, `loc-102`, … A live `app_users.scope_primary_area_id` need not
be one of those, and `areaLabel()` falls back to returning the raw id when it is
not. So the display name is either a demo name or the id itself, and in neither
case is it bound to the validated location by anything trustworthy.

**Therefore:** the form is created with the validated `locationId` and
`locationName: null`. The inline editor shows the id, in monospace, rather than a
salon name nobody verified. The id is authoritative; the name is not; the UI says
only what is true.

This did **not** block the engineering path, per the brief.

### Double-submit — idempotency finding

**Audited: `form_instances` offers no safe no-migration idempotency mechanism.**
It has no column that could carry a proposal id, no jsonb metadata column, and no
unique constraint that could be reused. `revises_instance_id` points at a
*replaced* instance and is semantically wrong. `form_instance_values.provenance`
is per-value and written after creation, so it cannot make the INSERT idempotent.

**Implemented — the UI guard:**

- an `inFlight` ref checked and set **synchronously with the click**, before any
  await, so a double-click or an Enter-then-click race cannot both pass it (a
  `disabled` attribute alone applies one render too late);
- the button is disabled while the request is pending;
- **the action stops rendering entirely once an instance id exists** — held both
  on the message (durable, survives refresh) and in the card's own state, so a
  failed persist cannot leave the button offering a second form;
- only a **failed** create releases the guard.

**Residual limitation, stated plainly:** a request that reaches the server and
whose *response* is lost. The browser sees a failure, the row exists, and
pressing again would create a second one. Closing that needs a uniqueness
constraint on the proposal id — a **migration**, which this phase does not have.
Not claimed as solved.

### Manager-only drafting context

The notes sent to the drafting endpoint are assembled in the browser by
`draftNotesFromConversation(messages, proposal.sourceMessageIds)` — resolving the
**retained** ids against the live conversation, so the notes are the manager's
own text rather than a server-side paraphrase or a snapshot that could have
drifted. Three filters, each for a different failure:

| Filter | What it prevents |
|---|---|
| `role === "user"` | Sunny's *interpretation* written up as fact |
| `!message.error` | an error message read as an account of events |
| id ∈ retained | content the bounded window excluded sneaking back via the client |

There is **no fallback**. If nothing survives, the form is created and the
manager is told it could not be prefilled.

### AI drafting — endpoint reuse

`POST /api/forms/instances/[id]/draft` is reused unchanged. No second Claude
form-drafting path exists, and `create-inline-form.ts` contains no model client,
no model id and no prompt. Everything that endpoint enforces therefore applies:

- the field list comes from the **stored template version**, not the request;
- only `ai` fields are described, and `applyAssistantDraft` re-filters the
  output;
- signature blocks carry **no key**, so a signature cannot be addressed at all;
- policy-grounded fields **fail closed** — policy is retrieved from the
  manager's words *before* the model runs, and `dropUngroundedPolicy` clears any
  field the retrieval could not support;
- a form that is no longer a draft is refused.

### Create succeeds, draft fails

The order is irreversible and the handling follows from it. Once the create
returns, a real HR record exists.

- The reference is reported **the moment the row exists**, before drafting.
- A drafting failure becomes a **warning**, not an error that unwinds:
  *"Your draft was created, but Sunny couldn't prefill the details. You can
  complete them below."*
- The form is **not** deleted, the create is **not** retried, a second form is
  **not** created, and nothing pretends it did not happen.
- The editor renders with whatever values exist, and the manager finishes it.

A conversation too thin to draft from (`notes` under 10 characters) skips the
drafting call entirely rather than asking a model to write a coaching form out
of "ok", and carries its own warning.

### Chat stores a reference, never a copy

```ts
ChatMessage.formInstanceRef = { instanceId, proposalId, templateName }
```

`instanceId` is the only durable authority. `templateName` is presentation only —
a label for the moment before the fetch lands.

**No field values, no checked options, no status, no follow-up date, no
finalized flag, no PDF path.** All of those change on the server — from Form
Monitoring, from a later edit, from finalizing — and a copy in chat would be
stale in the most dangerous direction, because it would look authoritative.

Every render of the inline form **fetches the instance by id**. After a refresh
the conversation reloads from IndexedDB carrying an id, and the values come from
Postgres.

| Server says | Chat does |
|---|---|
| 404 | "This form is not available … Ask Sunny has not created another one." |
| 403 | the same |
| `status !== "draft"` | renders **read-only**, no save control |

It never falls back to the standalone builder and never recreates the form.

### The inline renderer

`features/forms/document/responsive-form.tsx` — a second **renderer**, not a
second **model**. Same `FormDocument`, same blocks, same field keys, same variant
filtering, same responsibility predicate (`canPersonEdit`, imported from the
module the server uses).

`DocumentSurface` is **not** used and neither is `lib/forms/paper`. That renderer
draws a fixed 816px `Sheet` scaled with a transform rather than reflowed — right
for the template editor, and exactly the horizontal scrollbar Marissa named.

| Paper renderer | Inline renderer |
|---|---|
| fixed `PAGE_PX.width` | fluid, `min-w-0` throughout |
| `field_row` is a row | `grid-cols-1 sm:grid-cols-2` |
| paginated | `page_break` renders nothing |
| letterhead masthead | omitted — the card already names the form |
| signature line on a rule | no control at all, labelled *Always blank — signed by hand* |

The PDF renderer is untouched, so the page a manager signs is unchanged.

No Coaching field list is hard-coded anywhere in chat — asserted by test, over
all three chat modules.

### Editing and saving

Explicit save, matching the standalone editor's existing semantics. `PATCH
/api/forms/instances/[id]` is the canonical path; nothing writes to Supabase from
React. `enforcePersonEdit` still rejects a value for a field a person does not
own, and the response carries the reloaded instance, so what is displayed after
a save is what the server stored.

States: **clean → dirty → saving → saved**, or **error**. "Saved" appears only
after the server confirms, and a keystroke returns the card to *Unsaved changes*.
**A failed save keeps the manager's typing** — discarding five minutes of work to
show a clean error would be the worst possible response to a network blip.

### Form Monitoring

**No separate monitoring record, and no change to Form Monitoring.** A
chat-created form is a `form_instances` row with `source = 'ask_sunny'`, and
`listInstances` reads `form_instance_overview` with **no source filter** — so the
existing query returns it under the existing rules. A filter there would be the
bug. Asserted by test, including that the route allow-lists `source` rather than
echoing it, so a caller cannot invent a third provenance value.

### The Phase 2 escape copy

*"To file a form today, use Create a Form"* is **removed from the ready Coaching
path** and replaced with *"I have the employee and the salon. Create the draft
here when you're ready…"*. Sending the manager to the standalone builder from the
one card that can create the form inline would be the feature arguing against
itself.

**It stays everywhere else**, because everywhere else it is still true: a
proposal missing the employee, unable to verify a salon, or naming a template the
inline editor does not support has no create action, and a manager who needs that
form today still needs somewhere to go.

---

## Gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |
| `npx vitest run` | **2597 passed, 7 skipped, 130 files** |

Baseline before this phase: 2512 / 7 / 127 (verified, not assumed).

### Mutation checks

| # | Mutation | Result |
|---|---|---|
| A | oldest-first character bounding restored | **6 failed** |
| B | Create draft shown for `needs_employee` | **3 failed** |
| C | `/forms/create` redirect restored | **2 failed** |
| D | `source: "manual"` sent | **1 failed** |
| E | instance reference dropped after creation | **3 failed** |
| F | drafted field values stored in the ChatMessage | **3 failed** |
| G | assistant content included in draft notes | **3 failed** |
| H | a second form created when prefill fails | **3 failed** |
| I | `DocumentSurface` rendered in chat | **17 failed** |
| J | signature / hand-filled fields made editable | **2 failed** |

Every mutation was reverted and the full suite re-run green. None committed.

Mutation B initially failed only one test, which exposed a real coverage gap: no
test asserted `supportsInlineDraft` is false for a non-ready proposal at the
model level. Four were added, and B then failed three.

Requirement 15 caught a second gap: the route suite's mocked `authorizeRequest`
returned an identity regardless of the permission asked for, which made every
permission assertion in that file vacuous. It now applies the real
`DEFAULT_PERMISSION_MATRIX`, the way `authorizeRequest` does.

### Where the requirements are tested

| Requirements | File |
|---|---|
| R1–R6 context recency | `lib/forms/proposal.test.ts` |
| 7–10, 18, 29–33, 34, 35–45 | `features/chat/inline-form.dom.test.tsx` |
| 11–14, 19–20, 24–26, 27–28, 29, 34 | `features/chat/create-inline-form.test.ts` |
| 20–23, 26 drafting notes | `lib/forms/draft-notes.test.ts` |
| 14–17, 46–48 server authority, monitoring | `app/api/forms/location-authority.test.ts` |
| signature / responsibility engine | `lib/forms/document.test.ts` (pre-existing) |

---

## Not done, and deliberately

- **Finalize — NO.** Phase 4.
- **Download PDF — NO.** Phase 4.
- **Start another, View in Form Monitoring — NO.** Phase 4. A dead Finalize
  button would reproduce exactly the "Coming later" problem this workstream just
  removed; the DOM tests assert none of the four appears.
- **Inline creation of any template but Coaching.** Those proposals stay
  informational.
- **Network-retry idempotency.** Needs a migration; see above.
- **A salon roster.** District and regional managers still cannot name a salon.
- **Server-side chat persistence.** Conversations remain browser-local IndexedDB,
  which is acceptable for this phase because the form is a Postgres row.
- **Preview QA.** Not performed. jsdom is not a browser and nothing here is a
  claim about one.

## Preview QA checklist (for a human, with SYNTHETIC employee data)

**Laptop**

1. Ask Sunny about synthetic repeated tardiness.
2. *"Build me a coaching form for Sarah Test for that."*
3. Proposal appears; employee correct; salon resolution correct.
4. Click **Create draft** — no navigation.
5. The real inline form appears; the incident text reflects what was actually
   typed; no invented dates, counts, job title or follow-up.
6. Edit Details → **Save changes** → "Saved" appears only after the server
   answers.
7. Refresh the browser, reopen the same conversation → the same draft, same
   saved values.

**Mobile ~360px** — proposal fits; Create draft fits; the form is one column;
controls usable; **no paper-width scrollbar**; no whole-page horizontal movement;
the composer stays usable below the inline form.

**Also verify manually:** the missing-employee case (no Create draft); the AI
drafting failure state; the save error state if practical.
