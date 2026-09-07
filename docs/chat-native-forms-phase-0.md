# Chat-native forms — Phase 0 architecture audit

Branch: `feature/chat-native-forms-marissa-feedback`
Base: `feature/ask-sunny-forms-template-engine` @ `22e63da`
Status: **audit only.** No source changed, no migration, no deployment.
Review verdict: **Phase 0 PASS — implementation planning approved.** Sequencing in
§15 is the approved one. No phase starts without a bounded brief from Paulyne.

Every claim below was read out of the tree at the base commit. Where something is
a proposal rather than a finding it says so.

---

## 1. Current chat architecture

**Conversations are browser-local.** `ChatScreen` reads and writes
`useAppStore().conversations`, which `app-store.tsx` persists to IndexedDB under
`chat_conversations`. There is no `chat_conversations` table, no chat API beyond
a single stateless turn endpoint, and no server record that a conversation
happened. A conversation does not survive a different browser, a different
device, or cleared site data.

This is the same shape the training-video library had before `fef5d04` moved it
to Supabase, and it is the single fact that decides most of the architecture
below.

**One stateless endpoint.** `POST /api/chat` (`src/app/api/chat/route.ts`)
guards mode → configuration → `authorizeRequest(request, "ask_questions")` →
rate limit → validation, then calls `answerQuestion`. It holds no state. The
browser sends the whole `history` array back on every turn; the server keeps
nothing.

**Structured non-text message parts already exist.** `ChatMessage`
(`src/types/index.ts:295`) is not a bag of prose. Alongside `content` it already
carries `citations`, `recommendedVideoIds`, `coverage`, `followUpSuggestions`,
`error: ChatTurnError`, and three form-specific fields — `formHandoff`,
`pendingFormTemplateId`, `pendingFormValues`.

That matters more than it looks. The precedent for "this turn renders something
other than prose" is established and `MessageBubble` already branches on it
(`message.error` renders a `ChatErrorBubble` instead of an answer bubble). An
inline form block is a fourth branch of an existing pattern, not a new concept.

**Stale context is prevented by nothing, in chat.** `findPendingFormTurn`
(`chat-flow.ts:144`) walks backwards through history and stops at the first
assistant message, returning its pending form state. There is no fingerprint, no
conversation identity check, no guard against an answer landing in a thread that
has moved on. The Sales Totals analyser solved exactly this problem with
`view-fingerprint.ts` and an atomic `Conversation` object whose `settle()`
refuses to append to a conversation that changed — chat itself has no equivalent.

**What is sent on a follow-up turn.** `history` (whole array, bounded by
`parseHistory`), `question`, `mode`, `scopeId`, and a `context` object of
`{ userName, locationName, todayIso }`. `locationName` comes from
`useSession().primaryLocationName`, and `todayIso` is hardcoded to
`DEMO_ANCHOR.slice(0, 10)` — a demo anchor date, not today, on the live path.

**Entities are not represented.** There is no employee or location entity in the
chat model. `pendingFormValues` is a flat `Record<string, string>` in which
`employee_name` and `location` are ordinary strings with no provenance and no
validation.

---

## 2. Current form architecture

Mature, server-authoritative, and materially better than the chat side.

**The chain.** `form_templates` → `form_template_versions` (immutable published
document) → `form_instances` → `form_instance_values` → `form_instance_events`.

`form_instances` (`20260904001000_forms_engine.sql:230`) holds
`template_version_id` with `on delete restrict`, `variant_key`, `employee_name`,
`employee_role`, `location_id`, `location_name`, `created_by`, `created_by_role`,
`source`, `status`, `form_date`, `follow_up_date`, `finalized_at`, `exported_at`,
`revises_instance_id`, and a check constraint that a non-draft must carry
`finalized_at`.

**`source` already has an `ask_sunny` value.** `POST /api/forms/instances`
accepts `source: "manual" | "ask_sunny"` and defaults to `manual`. The data model
anticipated this feature.

**End-to-end flow, verified:**

| Step | Where |
|---|---|
| List publishable templates | `listTemplateSummaries()`, filtered on `active && currentVersion` |
| Create instance | `POST /api/forms/instances` → `createInstance()` — resolves the template's **current version** server-side, inserts, seeds `system` fields from the record, records a `created` event |
| AI draft | `POST /api/forms/instances/[id]/draft` → field list from the **stored version**, not the request; `enforceResponsibilities` filters the output; `writeValues(..., "ai")` tags authorship |
| Manual save | `PATCH /api/forms/instances/[id]` — refuses hand-filled and signature lines |
| Finalize | `POST /api/forms/instances/[id]` with `action: "finalize"` and an optional `followUpDate` |
| Monitoring | `GET /api/forms/instances` behind `view_form_monitoring` |
| PDF | `GET /api/forms/instances/[id]/pdf` — renders from the version the form was **filled from**, records the export |

**The AI boundary is already correct and already enforced.**
`enforceResponsibilities` (`responsibility.ts`) drops any key that is not a field
on this template version, any `signature` field, and any field whose
responsibility is not in `AI_WRITABLE` — and returns what it rejected so the
attempt is visible. `policy-grounding.ts` withholds policy-quoting fields when
retrieval found nothing to quote.

**No employee directory exists.** `employee_name` is `text not null` free text.
Nothing anywhere in the tree resolves an employee to a record. Confirmed by
search, not assumed.

---

## 3. Current chat → form handoff

It works, and it does exactly what Marissa complained about.

`MessageBubble.handleOpenForm` (`message-bubble.tsx:78`) maps the conversation's
invented template id (`tpl-coaching`) to a published key via
`PUBLISHED_TEMPLATE_KEY`, then does
`router.push('/forms/create?from=chat&template=<key>&employee=<name>')`.
`CreateFormPage` reads those on the server and passes `fromChat`,
`initialTemplateKey`, `initialEmployeeName` down.

| Carried | Not carried |
|---|---|
| Template key | The incident description |
| Employee name | Everything Sunny drafted |
| — | The location (a dropdown defaulting to `locations[0]`) |
| — | The follow-up intent |

The page says so itself, in a `Notice` at `create-form-flow.tsx:257`:

> "The form and the employee came across. The wording Sunny drafted in chat did
> not — it was written against the old template, not the published version this
> form prints from."

That is an honest notice about a real constraint: `buildFormDraft` in
`chat-flow.ts` writes field ids (`details`, `expected_action`, `support_offered`)
belonging to a pre-versioning coaching form, so copying its text into a published
version would put words under the wrong labels on a disciplinary record. **The
existing behaviour is correct given where the drafting happens. The fix is to
move the drafting, not to start trusting the old draft.**

So the manager, today: leaves the thread → lands on a four-step builder → the
template and name are pre-filled → **re-types the incident into a `notes`
textarea** → presses "Ask Sunny to draft" → the real drafting happens there
against the real version.

The incident is described twice. That is the complaint.

---

## 4. What can be reused

Nearly all of it. This is the good news and it is the reason no second forms
system is needed.

- `POST /api/forms/instances` — already takes `source: "ask_sunny"`,
  `locationId`, `locationName`, `employeeName`, `formDate`.
- `POST /api/forms/instances/[id]/draft` — **already takes exactly the input
  chat needs**: `{ notes?: string; topic?: string }`. The conversation-derived
  incident summary goes into `notes`. No new drafting endpoint.
- `PATCH /api/forms/instances/[id]` — inline edits.
- `POST /api/forms/instances/[id]` `action: "finalize"` with `followUpDate`.
- `GET /api/forms/instances/[id]/pdf` — unchanged.
- `enforceResponsibilities`, `policy-grounding`, `authorizeForms`, the whole
  event trail, `revises_instance_id`.
- `ChatMessage`'s existing structured-part precedent and `MessageBubble`'s
  existing branch-on-kind rendering.

**Nothing in the Forms API needs to change for Phase 1.** What is needed is a
chat orchestration layer that calls it, plus a renderer.

---

## 5. What must change

1. **A form block in the chat message model** — carrying a `formInstanceId`, not
   form values. (§9, decision 1.)
2. **A responsive inline renderer** — `DocumentSurface` is the paper surface and
   must not be embedded in the thread. (§8.)
3. **Location resolution that is not `DEMO_LOCATIONS[0]`.** (§6.)
4. **A bounded conversation-context contract** for `notes`. (§7.)
5. **Server-side validation of a chat-proposed template key** against published
   templates.
6. **`createInstance` must validate `locationId` against the actor's scope.** It
   currently accepts whatever the body sends. This is a real gap today, reachable
   from the existing builder, not something chat introduces.
7. **The `todayIso: DEMO_ANCHOR` hardcode** must not reach a `form_date`.

---

## 6. Location resolution

**What the session knows.** `app_users` carries real scope columns —
`scope_level` (`global | region | district | salon`), `scope_primary_area_id`,
`scope_also_covers_area_ids` — written at invite time and read into
`AccessScope`. The scope *model* is real.

**What it resolves against is not.** `session-context.tsx:238`:

```
if (user.scope.level === "salon" && user.scope.primaryAreaId) {
  return DEMO_LOCATIONS.find((l) => l.id === user.scope.primaryAreaId)?.name ?? "All salons";
}
```

The area ids are `loc-101`-style ids from `src/data/demo/locations.ts`. There is
no `locations` table. `CreateFormPage` passes `DEMO_LOCATIONS` as the dropdown's
options in live mode too.

**Answers to the brief's questions:**

- *Can a salon-scoped manager's location be inferred authoritatively?* The
  **level and the area id** can — those are authenticated. The **name** cannot,
  because it resolves through a demo file. A real salon roster is a prerequisite.
- *District/regional/global users?* `primaryAreaId` names a district or region,
  not a salon. There is no expansion from a district to its salons anywhere in
  the tree. So for these roles the set of candidate salons is currently
  **unknowable**.
- *Can a manager cover multiple salons?* Yes — `alsoCoversAreaIds` exists for
  exactly that.
- *More than one possible?* Nothing handles it. The builder silently picks
  `locations[0]`.

**Proposed rule (unchanged from the brief, and I endorse it):**

1. `scope.level === "salon"` and exactly one authorized salon → fill it
   automatically, show it, let the manager change it.
2. Otherwise → Sunny asks in chat with **bounded choices drawn from the
   authenticated scope**, never a free-text location.
3. **The server re-validates the chosen `locationId` against the actor's scope on
   `createInstance`.** Mandatory regardless of what the UI offered.
4. A location named only in assistant prose is never used.

**Dependency:** rule 1 and rule 3 both need a real salon roster keyed by the same
ids `app_users.scope_primary_area_id` holds. Until that exists, chat-native forms
can still ask (rule 2), but cannot auto-fill honestly.

---

## 7. Employee resolution

There is no employee directory. **Do not invent one** — the brief says so and the
data model agrees: `employee_name` is free text and `createInstance` takes it as
a string.

`extractEmployeeName` (`chat-flow.ts:104`) already exists and is already careful.
It matches `for <Name>`, rejects articles, and accepts a standalone capitalised
word only with evidence — two capitalised words, or the word being the entire
message. Its own comment records why: "Create a coaching form for a performance
concern" used to yield the employee name **"Create"**.

**Proposed contract:**

- Extract only when unambiguous, reusing that function's existing caution.
- **Display the inferred name prominently in the proposal state, before the
  instance is created** — creation is the point of no return for the audit trail.
- The manager can correct it inline.
- Ambiguous or missing → Sunny asks. No guessing.
- Persist through `createInstance({ employeeName })`. Same semantics as the
  builder, same column, same monitoring row.

---

## 8. Inline form UX (design only — not built)

**Do not embed `DocumentSurface`.** It is the paper representation, sized for
print, and it is the cause of Marissa's horizontal scrollbar. PDF continues to
come from `pdf-render.ts` unchanged.

Four states, as the brief specifies:

**1 — Proposal.** "I can create a Coaching Form for Jane Doe at Riverbend
Commons." Actions: `Create form` · `Change employee` · `Change form`. Nothing is
persisted yet. Ambiguity is resolved here, before an instance exists.

**2 — Drafting.** Compact status. The instance now exists as a draft and is
already in Form Monitoring — which is correct and should be stated, not hidden.

**3 — Draft.** Template name + version, employee, location, follow-up date, the
editable AI/manager fields, and the fields Sunny cannot fill clearly marked with
the same responsibility chips the builder and audit trail already use. Actions:
`Save draft` · `Finalize`.

**4 — Finalized.** Status, follow-up date, `Download PDF`, `View in Form
Monitoring`, `Start another`.

**Layout, to survive long forms without horizontal scroll:**

- Single column, `min-w-0` on every flex ancestor. The reporting page's
  horizontal-shift bug is what happens when that is missed.
- **Collapsible sections keyed to the document's own block groups** — the
  template already has structure; reuse it rather than inventing groupings.
- Progressive disclosure: fields Sunny filled expand by default, fields the
  manager must complete are surfaced above them, signature blocks collapse to a
  single "signed in person" line.
- Long text fields grow; nothing is a fixed pixel width.
- On mobile the actions sit at the end of the block rather than sticky — a sticky
  bar inside a chat thread that already has a composer costs too much viewport.

---

## 9. Architecture decisions

**1. New structured `ChatMessage` part, or reconstruct from a linked
`formInstanceId`?**
**Both, with a strict split.** A new part `form: { instanceId, templateName,
templateVersion, status }` — an identifier plus *presentation* metadata only.
The form's values are never in the message. Rendering fetches the instance.

**2. Canonical `conversation_id ↔ form_instance_id`?**
**One conversation → many instances**, and the reference lives on the **message**,
not the conversation ("Start another" produces a second form in the same thread).
The instance does not need to know its conversation; provenance is already
recorded by `source: 'ask_sunny'` and the `created` event.

**3. Full form data in chat, or reference only?**
**Reference only, and this is the most important decision here.** Chat is
IndexedDB. Copying form values into a message would create a second, per-browser,
silently divergent copy of an HR record that no server-side rule governs — the
exact failure the video milestone was built to remove. One source of truth:
`form_instances`.

**4. Surviving refresh / reopening?**
The message carries the id; the renderer fetches
`GET /api/forms/instances/:id` on mount and renders from the response. A 404 or a
403 renders "this form is no longer available to you" — never a cached copy.
Note honestly: the **conversation** itself does not survive a new browser today.
The **form** does, and appears in Form Monitoring. (§11.)

**5. Finalized → read-only?**
Already enforced server-side and needs nothing new: `applyAssistantDraft` throws
on non-draft, and `PATCH`/draft return 409 "This form is finalized. Create a
revision to change it." The inline UI reads `status` from the fetch, so it cannot
disagree with the server.

**6. "Start another"?**
A fresh `POST /api/forms/instances` → new id → new message with a new block. The
prior message keeps its own id and stays rendered at its own state. No id reuse,
no overwrite.

**7. Conversation context → the draft endpoint?**
`POST /api/forms/instances/:id/draft` **already accepts `{ notes, topic }`**. The
orchestrator builds `notes` per §10 and posts it. No API change.

**8. Ambiguity?**
Resolved in the proposal state, before an instance exists, with bounded choices.
Server re-validates template key, location and permission regardless.

**9. Schema changes?** See §11 — **no**, for Phase 1.

**10. Change the Forms API, or add an orchestration layer?**
**Orchestration layer only**, plus one gap-fix: `createInstance` must validate
`locationId` against the actor's scope. That is a defect in today's code, not a
new requirement.

---

## 10. Conversation context contract

The riskiest part of this feature: turning a chat into an HR record.

**Recommended contract.**

1. **Bounded window.** The last N manager turns in this conversation (start at
   N = 6), hard-capped by characters. Never the unlimited thread.
2. **Manager turns only.** `role === "user"`. An assistant paraphrase is Sunny's
   interpretation; promoting it to a factual disciplinary record is the worst
   failure mode available here. Assistant turns may inform the *proposal*
   (which template, which employee) and must not enter `notes`.
3. **Recency wins.** A later manager statement outranks an earlier one, and both
   outrank anything Sunny said. Same ordering rule the Sales Totals prompt
   already uses ("report grounding outranks prior turns").
4. **Explicit review before finalize.** The draft state shows every drafted field
   and every value is editable. Finalization stays an explicit user action.
5. **Provenance is recorded by the existing mechanism.** `writeValues(..., "ai")`
   vs `"manager"` already tags authorship per field and the events table already
   records `drafted`. Nothing new is needed; nothing new should be invented.
6. **The structured action the model may emit** is narrow and validated:
   `{ intent: "create_form", candidateTemplateKey, employeeName, incidentSummary,
   followUpIntent? }`. The server validates the template key against published
   templates, resolves the version itself, resolves location from scope, and
   applies permissions. The model never sees or supplies a version id, location
   id, instance id, status or PDF path.

---

## 11. Monitoring / PDF invariants, and the schema question

Because a chat-created form is created by the **same** `createInstance` call as a
builder-created one, every invariant holds by construction rather than by a
second implementation being kept in step:

| Invariant | Why it holds |
|---|---|
| Appears in Form Monitoring | Same `form_instances` row; `GET /api/forms/instances` filters on view, not on source |
| Template version | `createInstance` resolves the current version server-side and stores `template_version_id` |
| Employee / location | Same columns, same insert |
| Follow-up date | Same `finalize` action argument |
| Status transitions / revisions | Same `status` column, same `revises_instance_id` |
| PDF | Same route, rendering from the filled-from version |
| Survives reload and a new browser | It is a Postgres row |

**Migration requirement: none for Phase 1.**

`source: 'ask_sunny'` already exists. The conversation↔form link can live in the
chat message, which is client-side — and that is acceptable *precisely because
the link is not the record*. Losing it loses a rendering convenience, not an HR
document.

**When a migration would become necessary,** stated now so it is a decision and
not a surprise: if conversations are moved server-side (so a thread and its
inline forms reopen on another device), that needs a `chat_conversations` /
`chat_messages` schema. At that point — and only then — an additive
`form_instances.conversation_id text null` becomes worth adding, so Monitoring
can link back to the conversation. Existing schema cannot represent that link
today; nothing else is missing. **No SQL is written or applied in Phase 0.**

---

## 12. Permissions

Current, from `DEFAULT_PERMISSION_MATRIX`:

| Role | `ask_questions` | `create_coaching_form` | `view_form_monitoring` |
|---|---|---|---|
| `employee` | ✅ | ❌ | ❌ |
| `assistant_salon_director` | ✅ | ❌ | ✅ |
| `salon_director` | ✅ | ✅ | ✅ |
| `district_manager` / `regional_manager` | ✅ | ✅ | ✅ |
| `admin` / `owner` / `developer` | ✅ | ✅ | ✅ |

**Employee and Assistant Salon Director can ask Sunny and cannot create forms.**
That combination is the whole reason server enforcement is mandatory: the inline
action must be hidden for them *and* refused server-side.

Rules for Phase 1:

- **Do not broaden anything.** The permission required is the **template's own**
  `requiredPermission`, exactly as `POST /api/forms/instances` already reads it —
  a Salon Director may create a coaching form and not an EPP, and that is data on
  the template, not a rule in chat.
- Hiding the inline action is a courtesy. `authorizeForms` on every call is the
  control.
- A role with `ask_questions` but not the template's permission gets a plain
  spoken refusal from Sunny, not a button that 403s.

---

## 13. Chat sizing findings

Measured against the tree, not eyeballed.

| Element | Current | Finding |
|---|---|---|
| Message viewport | `h-[calc(100dvh-3.5rem)]`, messages in `flex-1 overflow-y-auto` | Structurally correct — the composer is what eats the space |
| Composer block | `pt-3.5 pb-4` + a `mb-3` mode row + a disclaimer line | Roughly **150–170px** before a single character is typed |
| Answer mode | Full `SegmentedControl` **plus** a helper sentence, on its own row above the input | The largest single cost; the helper duplicates what the label says |
| Textarea | `rows={1}`, auto-grows to `min(200, scrollHeight)` | **Already correct.** Marissa's "should start as one line and grow" is satisfied |
| Attach / image / voice | Three `disabled` buttons at `!opacity-40` + a "Coming later" label | Honest, and pure cost. Hide until functional |
| Disclaimer | `MANAGER_NOTE`, 232 characters, always rendered | Should become one short line or an info affordance |
| Citations | `SourceCardList`: `.eyebrow` title + `<Badge>{citations.length}</Badge>`, cards numbered `index + 1` | **This is Marissa's stray "3"** — see below |

**The stray "3" is confirmed and located.** `source-card.tsx:71-76` renders the
title and then a separate unlabelled badge containing `citations.length`,
immediately above cards numbered 1, 2, 3. With three excerpts from one document
the title reads "Source" and the badge reads a bare "3" — a number with no unit
sitting directly before a numbered list. The title already carries the count in
`sourceListTitle` ("Sources — 3 documents"), so the badge is both redundant and
in a different unit (excerpts vs documents).

---

## 14. Marissa's other feedback — classified

**P0 — blocks or directly serves the chat-native forms initiative**

| # | Item | Note |
|---|---|---|
| 3 | Form responsiveness | Not a fix to `DocumentSurface` — the inline form is a *different* renderer. §8. |
| 7 | Chat sources stray "3" | Located: `source-card.tsx:71-76`. One-line fix. |
| — | Chat sizing | §13. Inline forms need the vertical space. |
| — | `createInstance` location not scope-validated | Security gap found during this audit. |

**P1 — real, independent of this initiative**

| # | Item | Finding |
|---|---|---|
| 1 | Mobile reporting | `ranking-table.tsx:103` `min-w-[640px]` inside `ScrollTable`, which **does** carry `overflow-x-auto`. So the containment exists and something outside it is shifting the page — most likely a missing `min-w-0` on a flex ancestor. **Hypothesis, not verified.** |
| 4 | Salon count 12 vs 15 | **Root cause confirmed.** 12 = `DEMO_REVIEW_METRICS.length` (12 entries), used by `overview.tsx:423` and `reviews-screen.tsx:140`. 15 = real ingested Sales Totals rows, "the recipient's 15 salons". **Not a bug in either number — they are different corpora.** The demo one is seed data; the reporting one is real. Canonical source *should* be a real salon roster; none exists (§6). Same missing table blocks location resolution. |
| 5 | "JV & Associates" → "JB & Associates" | **9 occurrences**: `src/lib/brand/index.ts:27` (`operatorName`, the real source), `src/app/layout.tsx:57` (metadata), and 7 in `src/data/demo/resources.ts`. The demo file should read from the brand constant rather than restating it. |
| 8 | Pitch/demo copy | Two named examples located: `reviews-screen.tsx:86` ("Nobody opens twelve Google listings…") and `data/demo/chat.ts:180,187` ("What the seeded policy says"). The first is **live-mode copy** and is the real problem; the second is demo-answer text and is correctly demo-only. Marissa's structural point stands: this should be governed by live/demo posture centrally. |
| 9 | Accessibility contrast | **Confirmed and measured.** `--subtle-foreground: #8b8b8e` on the canvas = **3.35:1**, below WCAG AA 4.5:1. `.eyebrow` uses it at 11px — normal text size, so AA applies. `--muted-foreground: #6e7074` = 4.89:1 and passes. The eyebrow class is the specific failure. |
| 10 | Overview action-orientation | Design work, no blocker found. |

**P2 — smaller or externally controlled**

| # | Item | Finding |
|---|---|---|
| 2 | Navigation | **Partly inaccurate as reported.** A persistent desktop sidebar already exists (`app-shell.tsx:103`, `lg:block`); the hamburger is `lg:hidden`. What is real: the rail can be collapsed to icons via a persisted preference (`ask-sunny:sidebar-collapsed`), which likely produced the impression. The colour request is genuine — `--sidebar: var(--rail)`. Mobile drawer stays. |
| 6 | Vercel toolbar | **Not in the codebase.** No `@vercel/toolbar` dependency, nothing in `next.config.ts`, no `vercel.json`. It is injected by the platform for Preview deployments to logged-in team members. **Project-settings change, not a code change.** |

---

## 15. Implementation phases — APPROVED

Approved at review, with one sequencing correction that this document originally
got wrong.

**What was corrected, and why it mattered.** The first draft of this section
classified the unvalidated `locationId` as **P0** and then scheduled location
work as **Phase 4**. Those cannot both be true. Building an inline form workflow
on top of an unenforced permission boundary means the boundary gets harder to
add later, not easier — every new caller written in the meantime is another
caller to go back and fix. Authorization moves to Phase 2, before any form is
created from chat.

**The approved sequence:**

**Phase 1 — Chat workspace cleanup. ✅ SHIPPED.** Compact composer, dead
attachment/image/voice controls removed, disclaimer to one line, stray citation
count badge removed. **No forms behaviour.** See `docs/chat-phase-1.md`.

Two defects were found in the layout chain while doing it, beyond the cosmetic
list: `ChatScreen` asked for `lg:h-dvh` beneath a 56px shell header, overflowing
the page by exactly the header's height on every laptop; and the conversation
column between the fixed-height root and the scrolling message list was missing
`min-h-0`, so a long answer could push the composer off-screen rather than
scrolling inside its pane. Both were in scope for Requirement 4 and are fixed.

**Phase 2 — Security + structured form proposal. ✅ SHIPPED.** Server-side
`locationId` scope validation; the structured form intent; employee / template /
location ambiguity handling; the proposal card. **No instance is created and
nothing is finalized.** See `docs/chat-phase-2.md`.

It also **deleted** `lib/forms/chat-flow.ts` rather than leaving it beside the
new path. That module defaulted the employee to "Jane Kowalski", the reason to
repeated tardiness and the template to Coaching Form whenever the manager had
supplied none of them — and offered the result as a one-tap follow-up chip. A
fallback kept for compatibility is a fallback that still runs.

**Phase 3 — Inline form draft. ✅ SHIPPED.** Create the canonical instance with
`source: 'ask_sunny'`; send bounded manager-only incident context to the existing
draft endpoint; responsive field renderer; save and edit. Everything persists to
the Forms backend. See `docs/chat-phase-3.md`.

Scoped to the **Coaching Form** — the workflow Marissa asked for, and the one
whose inline editor has been built and tested. Every other published template
still proposes and offers no create action.

Three things this phase established that the audit had assumed rather than
checked:

- **`primaryLocationName` is not authoritative.** It resolves through
  `DEMO_LOCATIONS` (`session-context.tsx:238`), and `areaLabel()` falls back to
  the raw id when the lookup misses. So a chat-created form carries the
  **validated `locationId` and `locationName: null`**, and the inline editor
  shows the id rather than a salon name nobody verified.
- **`form_instances` offers no no-migration idempotency hook.** No proposal-id
  column, no jsonb metadata, no reusable unique constraint. The UI guard is
  implemented; strict network-retry idempotency needs a migration and is not
  claimed.
- **The paper renderer cannot go in chat.** `DocumentSurface` draws a fixed
  816px `Sheet` scaled by transform rather than reflowed — exactly the
  horizontal scrollbar Marissa named. A second *renderer* was built from the same
  `FormDocument`; there is no second field model, and the PDF path is untouched.

**Phase 4 — Finalize.** Follow-up date, finalize, PDF, View in Form Monitoring,
Start another. **None of these exist yet**, in chat or anywhere Phase 3 touched —
asserted by test, because a dead Finalize would reproduce exactly the "Coming
later" problem Phase 1 removed.

**Phase 5 — Mobile / reporting / nav / Overview / polish.**

### What Phase 2's authorization fix actually requires

Smaller than §5 implied, and with one decision that will stall the phase if it is
not made up front.

**The scope is already on the identity.** `AuthenticatedIdentity` carries
`scope: AccessScope` (`src/lib/auth/types.ts:52`), so `authorizeRequest` already
returns it. `authorizeForms` **discards it** — it returns `{ id, role, verified }`
and drops the scope on the floor (`access.ts:95-103`). So the fix is: carry
`scope` on `FormsActor`, and check it in `createInstance`. No new lookup, no new
plumbing through the request.

> **DONE in Phase 2, with one correction to the plan above.** The check went at
> `POST /api/forms/instances`, not inside `createInstance`: the route is where a
> refusal can be a 403 with a reason the caller sees, and `createInstance` is a
> data-layer function that would have had to invent an error channel. Same
> coverage — every form-creating caller goes through that route.

**Enforceability differs by scope level, and this is the decision:**

| Level | Authorized set | Enforceable today? |
|---|---|---|
| `salon` | `{primaryAreaId} ∪ alsoCoversAreaIds` | **Yes, fully.** Both are authenticated columns on `app_users`. No salon roster needed. |
| `global` | everything | Yes, trivially. |
| `district` / `region` | the salons under that area | **No.** `primaryAreaId` names a district or region, and nothing in the tree expands one into its salons. |

So salon-scoped managers — Marissa's case, and the majority of form authors — can
be validated exactly, **now**, with no dependency on the missing roster.

District and regional managers are the open question, and it is a product
decision rather than a technical one:

- **Fail closed** — refuse any `locationId` not directly in their scope ids. This
  is correct, and it **breaks DM/RM form creation** until a roster exists, because
  a DM's scope id is a district and the form's location is a salon.
- **Accept and record** — allow it, and stamp the instance so an unvalidated
  location is visible in the audit trail rather than silently indistinguishable
  from a validated one.

**Recommendation: accept-and-record for `district`/`region`, fail-closed for
`salon`.** It closes the gap for the roles that can be checked, does not remove
working functionality from the roles that cannot, and makes the remaining
exposure visible instead of invisible. Fail-closed everywhere becomes correct the
day a real salon roster lands — which is the same dependency as auto-filling a
location and as the 12-vs-15 salon count.

**Paulyne's call, in the Phase 2 brief.** This document does not decide it.

> **DECIDED — FAIL CLOSED EVERYWHERE.** The Phase 2 brief overrode the
> recommendation above: *"For an HR record, an unverifiable salon must not be
> treated as authorized."* Accept-and-record was rejected on the grounds that an
> accepted-but-unverified salon reads exactly like a verified one to everybody
> who opens the record later, and the record outlives the caveat. District and
> regional actors are refused until a salon roster exists. Shipped in Phase 2;
> see `docs/chat-phase-2.md` §C.

### Not scheduled

**Server-side chat persistence.** Conversations are IndexedDB, so an Ask Sunny
thread does not follow a manager from laptop to phone today. This does **not**
block chat-native forms: the form itself is a Postgres row and survives refresh,
a new device and a new browser, and it appears in Form Monitoring regardless of
where it was created. Making the *conversation* follow the manager is its own
milestone, is the only item here that needs a migration, and should be decided on
its own merits rather than carried in under this feature.

## 16. Risks

1. **An HR record built from a conversation.** The mitigation is §10 — manager
   turns only, bounded, reviewable, explicit finalization — and it is a contract
   to hold to, not a control that enforces itself.
2. **Creating the instance too early.** An instance is a Monitoring row and an
   audit trail from the moment it exists. Resolve ambiguity in the proposal
   state, before creation.
3. **Location.** Auto-filling from a demo roster in live mode would put a
   fictional salon name on a real disciplinary record. Rule 3 in §6 is not
   optional.
4. **The temptation to cache form values in the message.** It would make
   rendering simpler and would recreate the per-browser divergence problem on HR
   data. Decision 3 exists to close it.
5. **`DEMO_ANCHOR` reaching a `form_date`.** Chat currently sends a demo anchor
   date as `todayIso`.
6. **Long forms in a narrow thread.** §8; verify at 360px before shipping.
7. **Scope creep.** Marissa raised ten things. Nine of them are not this feature.
