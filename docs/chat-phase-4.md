# Phase 4 — finalize, PDF, monitoring, and the live-flow correction

Branch: `feature/ask-sunny-forms-template-engine` (the login-enabled Preview branch)
Started from: `70f878d`
Status: **implemented, automated gate green, Preview QA outstanding.**

**No migration. No schema change. Nothing merged to `main`. Production untouched.**

---

## Root cause of the pseudo-form response

Paulyne's Preview answered a coaching-form request with prose — *"here's a draft
body you can paste into whichever official form Create a Form gives you"*, a
markdown "Coaching Record — Draft", and *"the knowledge base … contains no
coaching or corrective-action template"*.

**Traced, not assumed.** Two live reads settled it:

| Check | Result |
|---|---|
| `form_templates` on Ask Sunny Dev | `coaching` **active**, current version **published** — the library was never the problem |
| `app_users` | one real account: **`role: admin`, `scope_level: global`, `scope_primary_area_id: null`** |

Then the code path:

```
proposeLocation(global)  →  { needs_selection, authorizedIds: [] }   ← the bug
buildProposal            →  status "needs_location"  (not "ready")
supportsInlineDraft      →  false
FormProposalCard         →  no Create draft, plus the Phase 2 escape copy
                            "Nothing has been created … use Create a Form"
next manager turn        →  no open proposal it could continue
answerQuestion           →  ordinary retrieval
Claude                   →  reads the KNOWLEDGE BASE, correctly reports it has
                            no coaching template, writes a facsimile, and
                            paraphrases the escape copy it can see in history
```

**One line made the whole feature unreachable for the only kind of account that
exists.** A global actor was treated as *missing an answer* about their salon,
when in fact a salon does not apply to them — and `authorizeLocation` already
permitted them a form naming none.

Everything downstream followed from that: the escape copy is what Claude
paraphrased, and the pseudo-form and the $25 assigned-opener paragraph are what
the RAG path produces when a form request reaches it.

**Not** MockAIProvider, **not** a legacy `formHandoff`, **not** `pendingFormValues`,
**not** a stale follow-up suggestion, **not** a branch mismatch.

## Forms repository vs knowledge base

The wrong answer's premise — "the knowledge base contains no coaching template" —
is the conceptual error the brief names. **Availability is a fact about
`form_templates`.** `proposeFormForTurn` resolves it through
`listTemplateSummaries()` and touches retrieval not at all; tests pin that the
proposal module contains no knowledge import, and that `answerQuestion` returns
the proposal **before** `knowledge.match` runs.

Knowledge retrieval still grounds **policy** where a template field is marked
`policyGrounded` — and the **Coaching Form marks none**, which is pinned by test.
So no policy text can enter a coaching record through the form path at all.

## Chat → real form flow

Unchanged from Phase 3 and now reachable:

```
"Build me a coaching form for Sarah Test for that."
  → template from the published library, permission from the template row
  → employee from the manager's own turns
  → salon from the authenticated scope, or NOT APPLICABLE
  → Create draft → POST /api/forms/instances (source: ask_sunny)
  → reference persisted immediately → POST .../draft → canonical reload
  → the real form, inline
```

`proposeLocation` gained **`not_applicable`**, distinct from `unavailable`:

| Actor | Salon | Create draft |
|---|---|---|
| salon, exactly one | filled in | **yes** |
| salon, several | **picker of the authorized ids** | yes, once chosen |
| **global** | **none — stated on the card** | **yes** |
| district / region | refused | no — still fails closed |

The multi-salon picker offers **ids, not names**: there is no roster, and the
only source of a display name is seeded demo data. Whatever is chosen is
re-authorized by `POST /api/forms/instances`.

## Missing-data conversation flow

Unchanged from Remediation 1 and still tested: *"Build me a coaching form for
that."* → *"Who is this for?"* → *"Sarah Test"* continues the **same** proposal
through the bounded continuation hint, and does not become a knowledge query.
Manager name, business date and — for a single-salon actor — the salon are never
asked for, because the authenticated context already answers them.

## Inline editing · Save · canonical reload

Unchanged from Phase 3: canonical `PATCH`, `enforcePersonEdit` still rejects a
field a person does not own, states are **clean → dirty → saving → saved**, and
"Saved" appears only after the server confirms. A failed save keeps the typing.

## Follow-up date control

**A real date input in the action area**, not a sentence. It writes through
`PUT /api/forms/instances/[id]/follow-up`, which validates the calendar date and
records `follow_up_started` / `follow_up_date_changed`.

It **starts blank** unless the server already holds a date. There is no
deterministic product rule for a default, and the prototype's "today + 14 days"
was exactly the manufactured HR fact this workstream removed.

## `[Follow-Up Date]` placeholder status

**Gone, and guarded twice.**

The model was writing *"I will check in with Sarah on [Follow-Up Date]"* into
`coaching_details` — stored as a canonical value, rendered in the editor, printed
into the PDF. On a signed HR document that is a sentence which reads as a
commitment while naming no date, in a field nobody proof-reads.

- **The prompt** now forbids placeholders and forbids mentioning follow-up at all.
- **`lib/forms/drafted-text.ts`** strips them from what comes back, *before*
  anything is stored. A model instruction is a request; this is the boundary.

**The whole sentence goes, not the bracket** — deleting the token leaves "check
in with Sarah on to review her attendance", still a commitment and now broken. If
nothing survives the field is left **empty**, which is what the drafting contract
already promises for anything the model cannot support.

The published Coaching Form has **no follow-up field**, so narrating one put a
single fact under two authorities that would disagree the moment a manager moved
the date.

## Policy extrapolation guard

The $25 assigned-opener paragraph came from the **RAG path**, not from drafting —
proven by the template: coaching has **zero `policyGrounded` fields**, so
`groundPolicy` never runs for it. Fixing "a recognized form request never reaches
RAG" removes it at the source, and a test pins the template property so a future
edit that opened that path has to come past it.

## Finalize / Approve & track

`POST /api/forms/instances/[id]` with `action: "finalize"` and the canonical
follow-up date. **Refused while the editor is dirty** — disabled, and refused
again in the handler — because finalizing freezes what the *server* holds, and a
manager who typed and finalized without saving would freeze the version without
their change with only a revision as a way back. After success the instance is
reloaded, status becomes Finalized, and every field goes read-only.

## PDF flow

`GET /api/forms/instances/[id]/pdf` through `downloadFormPdf`, which carries the
Forms headers — a plain link carries none and downloads a JSON error. Never
constructed from React state; a test scopes that assertion to the download
function so the save path's legitimate use of `edits` cannot mask it.

**Finalized only.** A draft offers Save and Finalize; a finalized record offers
Download PDF, View in Form Monitoring and Start another. Crossing them over would
hand somebody an unsigned document that looks final.

## View form · View in Form Monitoring · Start another

The inline responsive renderer **is** the form view — same `FormDocument`, same
field keys, same responsibilities, no paper geometry. **View in Form Monitoring**
links the existing workspace at `/forms/monitoring`; no second monitoring store
exists and `listInstances` still has no source filter. **Start another** puts the
manager back at the composer with the opening of a fresh request in the same
thread — the finalized instance is untouched, and the next form gets its own row.

## Mobile responsive status

Unchanged from Phase 3 and still asserted: no fixed pixel width anywhere in the
rendered form, `field_row` is `grid-cols-1 sm:grid-cols-2`, `min-w-0` throughout,
and the action row wraps. `DocumentSurface` and `lib/forms/paper` are imported by
neither chat module.

---

## Files changed

**New** — `src/lib/forms/drafted-text.ts`, `src/lib/forms/drafted-text.test.ts`,
`docs/chat-phase-4.md`

**Modified** — `location-scope.ts` (`not_applicable`), `proposal.ts` (ready when
the salon is settled; `authorizedLocationIds`), `types/index.ts`,
`ai/form-proposal.ts` (wording), `ai/prompts.ts` (facsimile ban),
`instances/[id]/draft/route.ts` (placeholder guard + prompt rules),
`features/chat/inline-form.tsx` (follow-up, finalize, PDF, monitoring, start
another), `features/chat/message-bubble.tsx` (salon picker, start another),
`features/chat/chat-screen.tsx`, plus the affected suites.

## Tests

| Area | Where |
|---|---|
| root cause, Forms-vs-KB, facsimile ban | `lib/ai/form-proposal.test.ts` (P4-RC) |
| placeholder guard, policy-grounding property | `lib/forms/drafted-text.test.ts` (P4-1) |
| follow-up, finalize, PDF, monitoring, start another | `features/chat/inline-form.dom.test.tsx` (P4) |
| global `not_applicable` | `lib/forms/location-scope.test.ts` |

## Mutation results

| # | Mutation | Result |
|---|---|---|
| A | Coaching request routed back through prose RAG | **1 failed** |
| A2 | global actor blocked again (the root cause) | **4 failed** |
| B | `[Follow-Up Date]` allowed back into Details | **1 failed** |
| C | PDF built from React state | **2 failed** |
| D | Finalize allowed with unsaved edits | **1 failed** |
| E | facsimile-form ban removed from the prompt | **1 failed** |
| F | a second record filed on finalize | **2 failed** |

All reverted, suite re-run green, none committed.

## Gate

| Check | Result |
|---|---|
| `npx vitest run` | **2721 passed, 7 skipped, 135 files** |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run build` | clean |

Baseline verified at 2687 / 7 / 134 before starting.

---

## Preview manual QA required

Not claimed — jsdom is not a browser, and no form was created against the live
database. With **synthetic** data (`Sarah Test`):

1. Sign in, describe the tardiness, ask for a coaching form.
2. **No pseudo-form prose.** A proposal card with **Create draft**.
3. Salon reads *"Not recorded — your account covers every salon"* (admin/global).
4. Create draft → loading state → the real form appears prefilled from your own
   words, with **no `[Follow-Up Date]`** and no assigned-opener/$25 paragraph.
5. Edit Details → Save changes → "Saved" only after the server answers.
6. Set the follow-up date → Set date.
7. Finalize → frozen, read-only.
8. Download PDF → contains the **edited** value.
9. View in Form Monitoring → the same record, `ask_sunny`, finalized.
10. Start another → a fresh request; the finalized form is untouched.
11. Mobile ~360px: one column, no horizontal scroll, date picker usable.

## Not done

- **Conversational field edits** ("change the coaching type to retraining") — the
  clickable editor is complete and required; NL editing is documented for a
  bounded next phase rather than half-built.
- **A salon roster** — district and regional actors still cannot name a salon,
  and no salon *name* is stored anywhere.
- **Network-retry idempotency** — still needs a migration; still not claimed.


---

# Addendum — the current-published-template contract

Added after the official Coaching Form was handed to the Forms-template
workstream. **No canonical template content was edited, cloned or published from
this session.**

## Audit result: the runtime contract was already correct

Traced end to end. Every layer already resolves the version the right way, and
**no production code changed**:

| Layer | Version source | Correct? |
|---|---|---|
| `createInstance` | `getCurrentVersion(template.id)` at CREATE time, pinned to `template_version_id`; **throws** if nothing is published | ✅ |
| `loadInstance` | `getVersion(instance.templateVersionId)` — the pin, never re-resolved | ✅ |
| `InlineForm` / `ResponsiveForm` | `loaded.version.document` | ✅ |
| `POST .../draft` | `loaded.version.document` | ✅ |
| `GET .../pdf` | `renderFormPdf(loaded.version.document, …)` | ✅ |
| `reviseInstance` | current version for the NEW revision; the original keeps its own | ✅ (documented, deliberate) |

**No caching anywhere** — every forms route is `force-dynamic`, and
`getCurrentVersion` reads `form_template_current` fresh on each call.

**No hard-coded coaching structure.** `TEMPLATE_SEEDS` in `lib/forms/library.ts`
is consumed only by `ensureTemplateLibrary` (seeding), never by a render path.

**No demo/seeded leak.** `DEMO_FORM_TEMPLATES` is reachable only from
`app-store.tsx`, which the chat form path never reads — the inline editor gets
its document from the API, which gets it from Postgres.

## What was added

Only tests and one test-double extension:

- `src/lib/forms/template-version-pinning.test.ts` — the adversarial fixture.
- `src/test/fake-supabase.ts` — gained `form_templates` and
  `form_template_current`, insert-returning (`.single()`), and a real `upsert`
  with a conflict target. Without those the fake could only test the halves.

## The two-version fixture

`coaching` v1 (OLD TOPIC ALPHA/BETA) and v2 (NEW TOPIC PUNCTUALITY/OTHER, plus a
section v1 lacks), current = v2. The documents are **test fixtures, not a
proposal for the official form** — content belongs to the other workstream; this
asserts the plumbing carries whatever they publish.

Every assertion reads **rendered output**, not ids alone, and a guard-on-the-guard
test proves the two documents genuinely differ first.

| Assertion | Result |
|---|---|
| new form pins v2 | ✅ |
| moving the published pointer changes what a NEW form pins, with no code change | ✅ |
| nothing published → refuses rather than guessing | ✅ |
| editor renders v2 for a new form | ✅ |
| editor renders **v1** for a v1 record while v2 is current | ✅ |
| existing instance is **not migrated** when the pointer moves | ✅ |
| PDF prints v2 for a new form | ✅ |
| PDF prints **v1** for a v1 record after v2 is published | ✅ |
| eight render-path modules name no coaching field, option or seeded import | ✅ |

**Mutation-checked:**

| # | Mutation | Result |
|---|---|---|
| TV-A | `createInstance` pins the oldest version instead of current | **6 failed** |
| TV-B | `loadInstance` re-resolves "latest" instead of the pin | **2 failed** |
| TV-C | chat hard-codes a coaching field list | **1 failed** |

All reverted; none committed.

## Live state — waiting on the template workstream

Read from Ask Sunny Dev, no writes:

| Version | Status | Current |
|---|---|---|
| coaching **v1** | published | **yes** |
| coaching **v2** | **draft** ("Cloned from version 1") | no |

**The corrected official version is not published yet.** Until it is, a new
coaching form correctly pins v1 — which is why the Preview still shows the old
structure. That is the contract working, not failing.

**No Chat code change will be needed when v2 is published.** That is the
acceptance criterion, and TV-1's "follows the pointer" test is exactly it.

## Gate

2748 passed, 7 skipped, 136 files · `tsc` clean · `lint` clean · `build` clean.
Baseline before this work: 2721 / 7 / 135.
