# Phase 2 — Secure chat-native coaching form proposal

Branch: `feature/chat-native-forms-marissa-feedback`
Started from: `1f79b41`
Status: **implemented; superseded in part by Phase 3 — see the notes below.**

The first safe part of Marissa's requirement — *conversation → structured,
validated form proposal inside chat* — plus the location-authorization gap that
Phase 0 approval moved out of Phase 4 and into here.

**Nothing is persisted.** No form instance is created from chat, no template
version is pinned, no PDF is produced, no follow-up is scheduled. **No migration,
no schema change, nothing merged, nothing deployed.**

---

## The one-line summary

Chat used to **draft an employment document**. It now **proposes one**, and says
what it does not know.

---

## A — What was removed, and why it could not stay

`src/lib/forms/chat-flow.ts` is deleted. What it did when the manager had not
supplied a fact:

| Field | Prototype default |
|---|---|
| `employee_name` | `"Jane Kowalski"` |
| `topic` | `"repeated tardiness"` |
| `employee_role` | `"Tanning Consultant"` |
| `details` | *"Arrived after the start of a scheduled shift on three occasions in the past two weeks, between ten and twenty minutes late each time."* |
| `expected_action` | a generated sentence about meeting the standard |
| `follow_up_date` | today + 14 days |
| template, when unrecognised | **Coaching Form** |

`buildFormCollection` also offered *"Jane Kowalski — late on the 12th, 15th and
19th, between 10 and 20 minutes each time"* as a **clickable follow-up chip**, so
one tap turned six invented facts into a draft.

Two of these deserve naming separately:

- **`detectTemplate` had `"form"` as a coaching matcher and coaching as its
  fallback.** "Create a form for Sarah" produced a Coaching Form — the first
  documented step of a disciplinary sequence — chosen by a keyword list.
- **`extractEmployeeName` accepted a capitalised leading word.** "Create a
  coaching form for a performance concern" produced an employee named
  **Create**. Invisible in demo prose; a name on somebody's employment file the
  moment the record is real.

None of it was preserved for compatibility. A fallback kept for compatibility is
a fallback that still runs.

**What survived** is the structural guard that decides which fields a model may
write — `applyFillRules`, `writableFieldIds`, `fillCheckboxDefaults` — now in
`src/lib/forms/fill-rules.ts`, named for what it actually is. Its tests came
across unchanged in substance: a signature field stays blank whatever a model
returns, including one mismarked `ai_populate`.

## B — What replaced it

```
manager's turn
  -> detectTemplateIntent      which form did they NAME? (never a default)
  -> listTemplateSummaries     is it published, active, current? (the library, not a keyword map)
  -> hasPermission             template.required_permission, against the server matrix
  -> managerContext            the manager's own turns, bounded
  -> resolveEmployee           their words, or "missing"
  -> proposeLocation           the authenticated AccessScope, or "missing"
  -> ChatFormProposal
```

> **REMEDIATED IN PHASE 3 — context recency.** `managerContext()` walked the
> retained turns oldest → newest and stopped at the first that would overflow the
> character budget, so a long earlier statement could spend the budget and the
> manager's newest correction never entered the context. Retention now runs
> newest-first and presentation is restored to chronological order, and
> `sourceMessageIds` names only what was actually retained. See
> `docs/chat-phase-3.md` Part 1.

| Module | Job |
|---|---|
| `lib/forms/template-intent.ts` | Which form the sentence named. Pure — the preview provider reads a sentence the same way the server does. |
| `lib/forms/proposal.ts` | Manager context, employee resolution, proposal assembly. **No fallbacks.** |
| `lib/forms/location-scope.ts` | Which salon a form may name. Used by chat *and* by the instances route. |
| `lib/ai/form-proposal.ts` | Template validation, permission, and the wording. Writes nothing. |

A `ChatFormProposal` carries **nine fields and no HR values**: template key and
name, employee name, location id, location display name, location resolution,
status, proposal id, source message ids. There is no topic, no details, no job
title, no follow-up date and no checked option, because none of those is
established by the time a proposal exists.

### Three properties worth stating

**The template is the library's, not the sentence's.** `detectTemplateIntent`
returns an *intent*; only a published, active row with a published current
version becomes a proposal. A named form the deployment does not publish gets
told so, and is never quietly answered with a different one.

**The permission is the template's own.** `required_permission` is data on the
row, which is why a Salon Director is offered a Coaching Form and refused a
DPOA without either rule appearing in chat. No role list is written in chat, and
nothing is broadened: a form you cannot create in Forms you cannot obtain by
asking Sunny for it.

**"EPP" is ambiguous on purpose.** The library publishes six — SDIT, TSD,
ASD-SDIT, FTTC and two DMIT readings — so "start an EPP" names a family. Sunny
lists them and asks.

## C — Location authorization (the Phase 4 item moved forward)

**The gap.** `POST /api/forms/instances` read `locationId` and `locationName`
from the request body and passed both to `createInstance` unchecked. The
authenticated identity had carried an `AccessScope` the whole time —
`authorizeForms` was discarding it. A signed-in Salon Director assigned to
`loc-0101` could file a Disciplinary Plan of Action against `loc-0999` by editing
one field, and the record would look, to everybody who opened it afterwards,
exactly like one filed by that salon's own manager.

**Fixed at the route, not in chat.** `/api/forms/instances` is the path every
form-creating caller goes through — the Create a Form workspace today, a
confirmed proposal tomorrow, and anything holding a session cookie right now. A
check that lives in one caller is a check the next caller does not have.

| Actor | `authorizeLocation` | `proposeLocation` (what chat may fill in) |
|---|---|---|
| Salon, id on their assignment | authorized | resolved, when it is their only one |
| Salon, id not on their assignment | **refused, 403** | — |
| Salon, several salons | authorized for each | `needs_selection` — the manager picks |
| Salon, no assignment | refused | `unavailable` |
| **District / region** | **refused** | `unavailable` |
| Global | authorized | `needs_selection` — nothing authoritative to fill in |
| Demo (no scope) | authorized, not enforced | `unavailable` |

### Why district and regional actors fail closed

A salon-scoped manager's authorized set is knowable from authenticated data
alone: their primary area and the areas they also cover **are** salon ids.

A district manager's `primaryAreaId` is a **district** id, and nothing in this
system maps a district to its salons. There is no salon roster table, and
`DEMO_LOCATIONS` is a seeded demo file, not an authority. So "is this salon in
your district?" currently has **no truthful answer**.

The two honest options were accept-and-record-that-it-was-unverified, or refuse.
**This refuses.** An accepted-but-unverified salon on an HR record reads exactly
like a verified one to everybody who opens it later, and the record outlives the
caveat. A refusal is visible today and fixable by connecting a roster; a wrong
salon on a disciplinary document is neither.

**The cost is real and is not hidden:** until a roster exists, a district or
regional manager cannot create a form that names a salon. They can still ask
Sunny anything, still create a form with no salon, and a salon-scoped manager is
unaffected.

### The name follows the id

A location id and a display name must not become two independent authorities. A
caller that sent an unauthorized id with a plausible name would otherwise leave
the name on the record after the id was refused, so `locationName` is dropped
whenever `locationId` is.

**What this does not do:** verify that the name describes the id. There is no
roster to resolve a display name from, so it remains caller-supplied text
attached to a server-validated id. Correspondingly, `ChatFormProposal.locationName`
is **always null** — a fictional salon name in front of a manager about to file a
disciplinary record is the class of thing this phase exists to stop.

## D — The actor does not come from the browser

`answerQuestion(request, actor)` takes the actor as a **separate argument** from
the parsed body. There is no field on `AskRequest` for a role or a scope, so a
browser that sends one has nowhere for it to land. `/api/chat` fills it from
`authorizeRequest`'s validated context.

The corpus-authority sweep in `corpus-authority.test.ts` was narrowed rather than
deleted for this: it used to assert the string `identity.scope` appeared in no
knowledge route, which was a proxy for the real rule. It now asserts the rule
directly — **every** assignment of a corpus, in every one of those routes, reads
`activeKnowledgeCorpus()` — plus a named carve-out saying chat is the one route
that reads a scope and what it is allowed to do with it. `primaryAreaId` and
`alsoCovers` stay banned outright.

## E — The UI

The proposal renders as a card inside the answer bubble: template name, employee,
salon, and a **"Proposal — nothing created"** badge. A missing value reads as
missing ("Not yet — tell Sunny who this form is about"), never as an empty row.

**No controls at all.** No Create, no Finalize, no Download PDF, no Start
another — confirming a proposal into a record is Phase 3, and a button that did
nothing would be a worse lie than the prototype's.

> **SUPERSEDED IN PHASE 3 for one path.** A **ready Coaching Form** proposal now
> carries a working **Create draft** action and becomes a real `form_instances`
> row edited inline. Every other proposal state still carries no control at all,
> and Finalize / PDF / Start another / View in Form Monitoring remain absent
> everywhere. See `docs/chat-phase-3.md`. The DOM test asserts zero
`button`, `a`, `input`, `select` and `textarea` elements inside a rendered
proposal, because a source scan cannot see that a control is present but inert.

**Pre-Phase-2 conversations.** Chat lives in browser IndexedDB, so a manager can
still scroll back to a turn carrying a `formHandoff`. Those turns render as the
prose they always were, plus one line saying the draft no longer opens in Create
a Form. **The redirect is gone and is not replaced**, and the stored values are
never put back on screen — they were never facts.

**Preview mode declines honestly.** `MockAIProvider` has neither the published
library nor a verified scope, so it says so rather than producing a convincing
coaching document from neither. It reads the sentence with the same
`detectTemplateIntent` the server uses, so preview and live agree on what counts
as a form request.

---

## Gate

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npx vitest run` | **2512 passed, 7 skipped, 127 files** |

Baseline before Phase 2 was 2397 / 7 / 120. The file count is +7 (six new suites,
minus the deleted `chat-flow.test.ts`).

### Mutation checks

A test that passes against the pre-fix implementation has proved nothing. Each
unsafe behaviour was reintroduced and the suite re-run:

| # | Mutation | Result |
|---|---|---|
| A | `detectTemplateIntent` returns coaching for an ambiguous request | **11 failed** |
| B | employee falls back to `"Jane Kowalski"` | **3 failed** |
| C | `extractEmployeeNames` accepts a capitalised leading word | **5 failed** |
| D | `authorizeLocation` authorizes district / region | **5 failed** |
| E | `/api/forms/instances` trusts `body.locationId` again | **5 failed** |
| F | `/api/chat` reads role and scope from the body | **3 failed** |
| G | the "Open in Create a Form" redirect returns | **2 failed** |
| H | chat skips the template's `required_permission` | **4 failed** |
| I | chat proposes an unpublished / inactive template | **3 failed** |

Every mutation was reverted and the full suite re-run green.

### What the tests cover

| Requirements | Where |
|---|---|
| 1–6 which form, and the refusal to guess | `lib/forms/template-intent.test.ts` |
| 7–17 what a proposal may contain | `lib/forms/proposal.test.ts` |
| 18–26 which salon a form may name | `lib/forms/location-scope.test.ts` |
| 27–30 location authority at the route | `app/api/forms/location-authority.test.ts` |
| 31–33 existing forms behaviour at the route | `app/api/forms/location-authority.test.ts` |
| 34–36 the fillRule guard, and the retirement | `lib/forms/fill-rules.test.ts` |
| 37–43 template validation, permission, nothing written | `lib/ai/form-proposal.test.ts` |
| 44 the actor comes from the session | `app/api/chat/actor-authority.test.ts` |
| 45–48 the card, and the legacy turn | `features/chat/form-proposal.dom.test.tsx` |

The route suite opens with a **guard on the guard**: an authorized salon is
proved to go through and be stored before any refusal is asserted, so the
refusals are real results rather than a route that stores nothing whatever it is
sent.

---

## Not done, and deliberately

- ~~**Confirming a proposal into a form.**~~ **DONE in Phase 3**, for the
  Coaching Form only. See `docs/chat-phase-3.md`.
- **Inline form editing, finalize, PDF from chat.** Phase 3+.
- **A salon roster.** Until one exists, district and regional managers cannot
  name a salon on a form, and no proposal shows a salon *name*.
- **The Phase 2 escape copy** — *"To file a form today, use Create a Form"* — was
  removed from the ready Coaching path in Phase 3 and kept everywhere else. It
  contradicted the target workflow once inline creation existed.
- **`fillCheckboxDefaults`' `coaching_type` default.** It picks an arbitrary
  coaching type when the manager selected none. That is the **Create a Form**
  drafting path, where the field is marked `ai_populate` by the business and the
  manager edits before signing — a different path from chat, and out of this
  brief. Worth revisiting in Phase 3.
- **Preview QA.** Not performed. Laptop and mobile Preview checks against this
  branch are outstanding and are **not** claimed here — jsdom is not a browser.

## Preview QA checklist (for a human, on Preview)

1. Ask *"create a form for Sarah"* → Sunny asks **which** form and lists only the
   ones your role can create. No coaching form appears.
2. Ask *"I need a coaching form"* → proposal card, **Employee: Not yet**.
3. Say a name → proposal card with the name, and the salon filled in **only** if
   your account has exactly one.
4. Confirm the card carries **no buttons at all**, on laptop and on mobile.
5. Ask *"what is the tardiness policy?"* → an ordinary grounded answer, unchanged.
6. Scroll back to an older conversation with a chat draft, if you have one →
   it renders, and offers no way into Create a Form.
7. Create a Form itself → unchanged end to end.
