# Deliverable 2 — Teams test rollout fix report

**Date:** 22 September 2026
**Branch:** `claude/compassionate-clarke-s3gj5a` (from `main` @ `0171630`)
**Commit:** `9e223d8`

Five of the six reported issues are fixed and verified. One is **BLOCKED** on a
source document nobody has given us.

---

## 1. "Rate this conversation" exposed across every conversation

### Root cause

`ConversationRating` is rendered at **one position** in the chat tree — the foot
of the thread. Selecting another conversation changes its **props**, not its
position, so React reconciles it rather than remounting it. `open`, `draft` and
`problem` are component state and survived the switch untouched.

It was **not only visual.** `save()` reads `turnId` from the *current* props and
the draft from *state*, so a complaint typed about conversation A and submitted
after switching to conversation B was filed against **B's turn id** — carrying
A's words and A's star rating. `ask_sunny_feedback` is keyed to
`activity_events.id`, so the resulting row named the wrong conversation, the
wrong surface and the wrong topic, and nothing in the ratings dashboard could
have revealed it.

### Files changed

- `src/features/chat/conversation-rating.tsx`

### What was fixed

The control resets `open`, `draft`, `problem` and `busy` whenever its **rating
identity** (`conversationId` + `turnId`) changes, using React's render-time
state-adjustment pattern rather than an effect — an effect would paint the
previous conversation's open form for one frame, which is the bug in miniature.

The reset lives in the **component**, not in a `key` at one call site, because
nine surfaces mount this control (chat tab, Overview band, five report ask bars,
Google Reviews bar, Sales Totals panel) and a rule enforced at one call site is a
rule the next host forgets. A `draftFrom()` helper now feeds both the initial
state and the reset, so those two can no longer disagree.

Existing behaviour and analytics are untouched: same `submitFeedback`, same
endpoint, same table, same turn-level grain, same "already rated" logic.

### Regression tests added — `src/features/chat/rollout-fixes.dom.test.tsx`

- does not carry an open rating form into another conversation
- **does not carry a typed complaint onto another conversation's turn**
- shows an unrated conversation as unrated after leaving a rated one

### Result

**PASS.** All three failed before the change (the second reproduced the data
corruption directly: the textarea rendered with `id="comment-<Beta's turn>"`
containing `"Alpha specific complaint"`).

---

## 2. No way to go back into a past chat

### Root cause

Two things, and the second is the one the client actually hit.

1. **Server-backed chat history had not reached them.** It merged to `main` in
   PR #31, *today*. `chat_conversations` and `chat_messages` are still **empty
   (0 rows)** in the Ask Sunny Dev project, although the migration is applied
   (`20260921185551_chat_history`). Until that deploys, history is browser-local
   only and does not follow a person between devices.
2. **The history rail was `display:none` on their screens.** It was
   `hidden … xl:block` — visible at **1280px and up only**. A Microsoft Teams tab
   is narrower than that, so on the pilot's actual screens the rail was not merely
   hard to find, it was not on the page. The only remaining route back to a thread
   was a "History" button that looked like a different feature from the rail
   nobody could see.

Reopening and continuing themselves were **not broken** — verified by test
against current `main` before any change.

### Files changed

- `src/features/chat/chat-screen.tsx`

### What was fixed

One history panel at **every width**, opened by one clearly labelled control that
is on screen wherever the chat is. Same `ConversationList`, same props, same
deletes, same Clear History. See issue 6 — the same change answers both reports.

Verified explicitly: the full conversation loads, existing messages are
preserved, continuation appends to the same conversation id, and **no duplicate
conversation is created**. Permission and location scope are untouched —
`/api/chat/conversations` still scopes every statement by
`context.identity.subject` and there is no parameter through which another
person's id can travel.

### Regression tests added

- loads the whole thread when one is selected from history
- continues it in place rather than opening a duplicate (asserts the earlier
  turns survive **and** the history still holds exactly two threads)

### Result

**PASS.**

---

## 3. "Create a form from this conversation" failing

### Root cause — two defects, both reproduced

**Evidence first.** `activity_events` shows a `form_request` turn at
2026-09-22 01:16:19Z followed by a `coaching_form` turn at 01:16:24Z, both
`succeeded = true` — and **no `form_instances` row was created**. The most recent
form instance is from 2026-09-21 15:37Z. The conversation reached a proposal and
no form was filed.

*(Note: Vercel runtime logs for this project returned 403 for our token, so the
server-side trace could not be read. The root causes below were found in code and
reproduced in tests; see "Diagnostics added" for why this will not happen again.)*

**Defect A — the action was live-looking and silently dropped.**
`send()` refuses a second turn while one is in flight, correctly. But
`createFormFromConversation` repeated that check and returned silently
(`if (busy) return;`), and the rail button was only ever disabled on
`!onCreateForm`. So during an answer — and Opus 5 turns are not instant — the
button looked live, was pressed, and did **nothing at all**. That is precisely
the report shape, and precisely the failure this codebase already removed once
when it took out the mandatory-rating gate.

**Defect B — a click that was never sent created a form nobody asked for.**
Far more serious. The "the manager chose this document by name" signal was a
boolean ref, `chosenFromPicker`, and the handler set it **before** calling `send`:

```js
chosenFromPicker.current = true;   // set unconditionally
void send(phrase);                 // …which may refuse and return immediately
```

So a form card clicked mid-turn sent nothing and left the flag armed. The flag
was consumed by **whichever proposal card mounted next** — which meant the
already-running turn's answer, if it carried a ready proposal, auto-created a real
`form_instances` row for a **different document than the one clicked**. A failed
turn, or a turn that answered without a proposal, left the flag armed
indefinitely, waiting to arm itself onto some later unrelated proposal.

Reproduced end-to-end: clicking **Corrective Action Form** during an in-flight
turn produced `POST /api/forms/instances` **and** the follow-on draft call for a
**Coaching Form**, from a click that never left the browser.

### Files changed

- `src/features/chat/chat-screen.tsx`
- `src/features/chat/context-panel.tsx`
- `src/features/chat/message-bubble.tsx`
- `src/lib/analytics/telemetry.ts`
- `src/features/chat/feedback-surfaces.test.ts` (source-scan assertions updated
  to pin the new, stricter invariant)

### What was fixed

- `send()` now takes the picker intent as an argument and **returns whether it
  accepted the turn**. The intent is recorded *inside* `send`, after the guard
  that decides whether the turn goes out, and **only when the answer actually
  carries a proposal**.
- The intent is now the **id of the answer it belongs to** (`autoDraftMessageId`),
  matched by the card against its own message — not a boolean armed for "whatever
  mounts next". It is read-and-cleared, so it can be spent once and can never
  outlive the render that armed it.
- The rail control is **disabled while a turn is in flight** and says why
  ("Sunny is answering. This will be ready the moment that finishes."), rather
  than swallowing the press.

Nothing was widened. `POST /api/forms/instances` still re-resolves the template,
requires it active with a published current version, pins that version, applies
the template's own `required_permission`, and re-authorises `locationId` against
the AccessScope. The one-click-creates-the-form behaviour for a document the
manager genuinely picked by name is preserved and is covered by its own test.

### Diagnostics added

Per the brief's requirement that failures produce useful diagnostics: two new
telemetry events, both logged at `warn`:

- `form.create.failed` — the create was refused. Carries the template **key**
  (a published document name, not a person), where it failed
  (`create` vs `draft`), and the server's own refusal text.
- `form.draft.failed` — the row **exists** and Sunny could not prefill it. A
  different operational response, so a separate event.

Previously a create failure was a sentence on one card on one screen and nothing
anywhere else — which is why this reached us as "it's failing" with no detail.

### Regression tests added

- says it is waiting instead of swallowing the press mid-turn (and is live again
  the moment the turn lands)
- **never files a form from a choice whose request was refused**
- still creates the form when the card's own choice is the one that answered

### Result

**PASS.** Both first two tests failed before the change.

### Honest limitation

We reproduced and fixed two real defects on this path that match the reported
symptom. We could **not** read the pilot's own failing conversation — the Vercel
logs are not readable with our token, and `chat_messages` is empty because
server-backed history has not deployed yet. If the client can reproduce again
after this ships, the new telemetry will name the failing half directly.

---

## 4. Exit Form template

## BLOCKED — Exit Form source/template not found

Searched exhaustively:

| Where | Result |
|---|---|
| Working tree, all file types | no match for `exit form`, `exit_form`, `exit-form`, `exit interview`, `offboard`, `separation`, `termination form` |
| **All git history, all branches** (`git log --all --diff-filter=A`) | no such file has ever been committed |
| `TEMPLATE_SEEDS` (`src/lib/forms/library.ts`, `hiring-library.ts`) | 13 templates, none is an Exit Form |
| **Live `public.form_templates`** | 14 rows: coaching, dpoa, policy-review, sdit-epp, tsd-epp, asd-sdit-epp, fttc-epp, dmit-epp-tsd, dmit-epp-dmit, prescreen-phone-interview, tanning-consultant-interview, management-interview-round-1, management-interview-round-2, follow-up-coaching. **No Exit Form.** |
| **`public.knowledge_documents`** | no title matching exit/separation/offboard/termination |
| **All four storage buckets** (`knowledge-documents`, `forms-templates`, `reporting-sources`, `training-videos`) | no object matching those terms |
| `src/test/fixtures/forms/` | coaching-form.docx, coaching-form.pdf, prescreen-form.doc only |

The single occurrence of the word in the repository is a **test input string** —
`"do you have an exit interview document?"` in
`src/lib/forms/inventory-question.test.ts:49` — one of the questions the inventory
reader is tested against. It is not a template.

**No Exit Form was manufactured.** The other thirteen templates were reproduced
block-for-block from authoritative source documents (`01. Coaching Form.docx`,
`03. Tanning Consultant Interview Form`, and so on) and invented HR questions
would be indistinguishable on screen from real ones.

### What is required to unblock

The **actual Exit Form document Marissa sent** — `.docx` preferred, `.pdf`
acceptable — the same way every other template was supplied. It did not arrive in
this repository, the database, or any storage bucket. Please ask Marissa which
channel she sent it through (email, Teams, Woven), and forward the file.

Once it exists, adding it is the established path and is small: a `TemplateSeed`
in the library with its real fields and wording, plus its bundled PDF.

---

## 5. L10 meeting link restricted to admin accounts

### Root cause / starting position

There was no permission governing it. The L10 link lived in two demo-build
surfaces — the Overview shortcut row (`DEMO_QUICK_ACTIONS`) and the Manager
Resources catalogue (`DEMO_RESOURCES`) — and the Overview also named
"L10 Meetings" as a plain chip to every manager. The destination
(`https://preview--leadership-sync-tool.lovable.app/`) was a string in a data
file, so it was **compiled into the client JavaScript of every demo build** —
which is the build the Teams pilot is running.

That last point is why UI hiding would not have been enough: the address would
still have been readable in devtools by every Salon Director who opened the page,
and the link's own `href` would still have worked when pasted.

### Files changed

- `src/types/index.ts` — new `view_l10_meetings` permission
- `src/lib/permissions/index.ts` — registered, admin-only, locked in the matrix UI
- `src/lib/config/l10-link.ts` *(new)* — destination config + gated path constant
- `src/app/api/resources/l10/route.ts` *(new)* — the authorization boundary
- `src/data/quick-actions.ts` — shortcuts can declare a required permission
- `src/data/demo/dashboard.ts` — L10 shortcut carries the permission; href is the gated path
- `src/data/demo/resources.ts` — **the preview host is gone**; the tile points at the gated path
- `src/components/shell/jump-to-row.tsx` — filters shortcuts by permission
- `src/features/resources/resources-demo-screen.tsx` — withholds the tile
- `src/features/dashboard/overview.tsx` — the Overview chip is gated too
- `.env.example` — documents `L10_MEETINGS_URL`

### What was fixed

**Authorization, not UI hiding.**

- `view_l10_meetings` is granted to `admin`, `owner`, `developer` and to nobody
  else — denied to every manager role by **absence**, which is how this matrix
  fails closed. It is also **locked** in the permissions matrix screen, so an
  administrator cannot widen it by ticking a box.
- The destination is **server-side configuration** (`L10_MEETINGS_URL`,
  deliberately **not** `NEXT_PUBLIC_`, so Next never inlines it into client code).
- Every surface links to **`/api/resources/l10`**. That route calls
  `authorizeRequest(request, "view_l10_meetings")` — the same guard every other
  protected route uses, resolving the role from `app_users` on a **verified**
  session — and only then issues a `307` with `cache-control: no-store`.
- A non-admin who types the path gets **403 with no destination in the body**, and
  gets the **identical** refusal whether or not a destination is configured, so
  nothing leaks about whether there is something there.
- **No email address appears anywhere in this path.** The rule is a permission on
  a role; there is nowhere in the check to put one.

**No URL was invented.** The only address this repository ever held is a Lovable
*preview* host, which is why `src/data/resources.ts` already refused to publish
it. Unset is a supported state: an administrator gets a 404 naming the variable
to set, and no surface renders a dead link.

### Verified in the built output

- Production build: the address appears in **no** emitted asset.
- Demo build (`NEXT_PUBLIC_DEMO_MODE=true`): the address appears in **no** client
  asset and **no** emitted JS. The only remaining occurrences are the explanatory
  comments in this change, inside server-side sourcemaps.

### Regression tests added — `src/app/api/resources/l10/l10-authorization.test.ts`

14 tests, driving the **real** permission matrix rather than a stubbed answer:

- the permission is held by `admin`/`owner`/`developer` and by nobody else
- **every role in `ROLES` is decided**, so a role added later is denied by default
- it is locked in the matrix UI
- an administrator is redirected (307, correct `location`, `no-store`)
- **a manager is refused 403 with no destination in the body** — asserted for
  `employee`, `assistant_salon_director`, `salon_director`, `district_manager`
  and `regional_manager`
- an unauthenticated caller gets 401
- a manager's refusal is byte-identical configured vs unconfigured
- an administrator is told which variable to set
- the destination is never guessed: relative values, non-http schemes and blanks
  are all rejected
- the variable is not `NEXT_PUBLIC_`

### Result

**PASS — 14/14.**

---

## 6. Hide chat history by default

### Files changed

- `src/features/chat/chat-screen.tsx`
- `src/features/chat/new-chat-discoverability.dom.test.tsx` (updated to open
  history first — the property under test is unchanged)

### What was fixed

The permanent rail is gone. There is now **one history panel at every width**,
**closed on arrival**, opened by the existing "History" control in the chat
header — which now renders at every width instead of `xl:hidden`, and carries
`aria-expanded` so assistive technology is told whether history is showing.

Selecting a conversation **closes the panel**, so the conversation is what is left
in front of the person. "New chat" also closes it.

Nothing was removed: same `ConversationList` component, same props, same delete
and Clear History controls, same data. Only *when it is on screen* changed. It
follows the application's existing visual system — it is the drawer that was
already there, promoted to the only history surface.

This is also the fix for issue 2's real-world cause, which is why one change
answers both.

### Regression tests added

- is closed on arrival (no conversation rows, no Clear History control)
- offers one clearly labelled control to open it, at any width
- gets out of the way once a conversation is chosen
- **keeps every conversation — hiding the panel deletes nothing** (close, reopen,
  both threads still there)
- starts a new chat without opening history first

### Result

**PASS.**

---

## Quality gates

| Gate | Result |
|---|---|
| **Typecheck** (`tsc --noEmit`) | **PASS**, no errors |
| **Lint** (`eslint`) | **PASS**, no errors, no warnings |
| **Full test suite** (`vitest run`) | **PASS — 337 files, 7903 tests passed, 52 skipped** (baseline was 335 files / 7875 tests) |
| **Production build** (`next build`) | **PASS** — compiled successfully |
| **Demo-boundary bundle check** (`verify:bundle`) | **PASS** — no fabricated demo content in any emitted client asset |

### Migrations

**None.** No schema change was required or made.

### Database changes

**None.** The database was read during this work (form templates, knowledge
documents, storage objects, activity events, form instances, chat tables, column
inventory) and **nothing was written**.

### Security / RLS changes

- **No RLS policy was changed, relaxed or removed.**
- **No authentication was weakened.** Nothing bypasses `authorizeRequest`, no
  guard was removed, and no permission was widened.
- **One permission was added and it only narrows access:** `view_l10_meetings`,
  granted to the three administrator roles, denied to everyone else, locked in
  the matrix UI, enforced server-side on a verified identity.
- **No additional employee PII is exposed or stored.**
- One address was **removed** from client bundles (the L10 preview host).

### Authorization verified explicitly

| Role | L10 link visible | `GET /api/resources/l10` |
|---|---|---|
| `admin`, `owner`, `developer` | Yes | **307** → configured destination |
| `regional_manager` | No | **403**, no destination in body |
| `district_manager` | No | **403**, no destination in body |
| `salon_director` | No | **403**, no destination in body |
| `assistant_salon_director` | No | **403**, no destination in body |
| `employee` | No | **403**, no destination in body |
| unauthenticated | No | **401** |

---

## One pre-existing failure fixed along the way

`src/lib/chat/payload.test.ts` minted its fixture ids from the **wall clock**
(`createId`, which stamps `Date.now()`) and validated them against a **frozen**
`NOW` of 2026-09-21 12:00Z. `isClientConversationId` refuses an id minted more
than 24 hours ahead of the `now` it is given, so the file passed for exactly
twenty-four hours after it was written and then went red — **at noon today**, on
code nobody had touched. Confirmed by running it against unmodified `main`:
12 failures, identical.

Fixed by anchoring the fixture ids to `NOW`, plus one new case that exercises the
**real** generator against the **real** clock — the property the frozen fixtures
cannot cover, and the reason the file must not simply hard-code ids.

Also updated: `boundaries.test.ts` asserted a permission count of 24. It is a
deliberate tripwire requiring any new permission to be acknowledged where chat
boundaries are guarded, so it was updated to 25 with a note explaining what was
added and why it touches no chat route.

---

## Not changed, deliberately

- Core Ask Sunny knowledge-answering behaviour — untouched.
- Retrieval, grounding, citations, the system prompt, the model configuration.
- Form templates, the forms engine, the drafting guards, PDF rendering.
- Reporting, Google Reviews, videos, the knowledge base.
- Existing conversations, ratings and filed forms — all preserved.
