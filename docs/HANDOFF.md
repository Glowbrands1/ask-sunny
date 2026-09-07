# Ask Sunny — session handoff

Written so a new chat can pick this work up without the previous conversation.
It covers what the project is, how the work is run, the rules that are settled,
what has shipped, what is deliberately unfinished, and what is next.

Keep it current. A handoff that describes last month's tree is worse than none.

---

## 1. What this is

**Ask Sunny** — a Next.js 16 + Supabase salon-management app for **Glo Brands**
(Suntan City). Reporting, a knowledge base with retrieval, forms, and a training
video library, behind a permission matrix.

Stack: Next.js 16 App Router, React 19, TypeScript, Tailwind, Supabase
(Postgres + Storage + pgvector), Vitest, Vercel.

## 2. How the work is run

Development proceeds as a series of **bounded checkpoints**. Each one arrives as
a tightly-scoped brief with explicit `DO NOT` constraints, and comes back as an
implementation plus a report in the sections the brief asked for.

What is expected of every checkpoint, in order:

1. **Audit before changing anything.** Read the code that exists. Verify rather
   than assume — several briefs say so in those words.
2. **Stay inside the brief.** A `DO NOT` is a boundary, not a preference. If
   something outside the scope is broken, name it in the report; do not fix it.
3. **Mutation-check the tests.** A test that passes against the pre-fix
   implementation has proved nothing. Revert the fix, watch the test fail, put
   the fix back, and report which tests failed and how many.
4. **Run the full gate**: `npm test`, `npx tsc --noEmit`, `npm run lint`,
   `npm run build`. On the chat-native-forms branch the suite is **2687 passed,
   7 skipped, across 134 files** — a checkpoint that lowers the passing count owes an explanation.
   (2397 / 7 / 120 before Phase 2; 2512 / 7 / 127 before Phase 3; 2597 / 7 / 130
   before Remediation 1; 2655 / 7 / 133 before Remediation 2.)
5. **Report honestly.** Say plainly what is unverified. Never describe a manual
   QA pass that was not performed, and never call something proven when it is
   only proven against a faked client.
6. **Return exactly the requested sections, in the requested order.**

Assume the report will be checked against the tree. It has been before — one
approval read *"I checked the actual `888d9b0` commit and the current SQL, not
just Claude's report."* Write reports that survive that.

## 3. Standing rules

### Branches

- Feature work: **`feature/ask-sunny-forms-template-engine`**.
- **Chat-native forms (Marissa feedback):**
  **`feature/chat-native-forms-marissa-feedback`**, branched from
  `feature/ask-sunny-forms-template-engine` @ `22e63da`. Its eventual merge
  target is that branch — **never `main`** — and only after Paulyne approves
  final QA.
- Mirror pushes to **`claude/ask-sunny-reporting-checkpoint-3-ylk91d`** (a stop
  hook checks for unpushed commits on `claude/*`).
- **Never merge `main`.** Never force-push. Never create a merge commit.
  Fast-forward only.
- **Never deploy Production.** Preview auto-deploy from a pushed branch is the
  QA path and is fine.

### Supabase

- **For Ask Sunny work, the only authorized Supabase target is Ask Sunny Dev
  `rbkylaavthsjepsczccv`.** The presence or absence of other connected projects
  is environment-specific. **Never modify another Supabase project unless
  explicitly authorized for that project.**
- **Never apply a migration without explicit approval**, after the migration and
  the code that needs it have been reviewed. When approval comes, apply the file
  **verbatim, in one transaction** — not selected statements, not half of it.
- Migrations are **additive**. No destructive change to shipped columns.
- **Free plan: the global Storage upload ceiling is fixed at 50 MB**
  (`Storage → Files → Settings`). A per-bucket limit above that is a fiction the
  API will reject.
- New SQL functions must be closed to callers:
  `revoke all on function ... from public, anon, authenticated;` — **all three.**
  Postgres grants `EXECUTE` to `PUBLIC` on creation, and on a Supabase project
  `ALTER DEFAULT PRIVILEGES` *also* grants it to `anon` and `authenticated`
  directly, so revoking `public` alone leaves the door open.

### Secrets, in the words the briefs used

- Never log, render, or echo a token. Never send a raw token to an app API.
- Never expose the Supabase secret key to the browser. `import "server-only"` is
  what enforces it — every module that touches the secret key carries it.
- Never invent, generate, store, email, display, or hard-code anybody's
  password. Never choose one for the user. Never ask for one in chat.
- Password changes go through the official Supabase Auth API. Never
  `update auth.users.encrypted_password` with SQL.
- A report never includes a password, a password hash, an access or refresh
  token, or the Supabase secret key. Environment variable **names** are fine;
  their values are not.

### Architecture invariants

- RLS is **enabled and forced** with **no policies**. All access is server-side
  under the secret key, behind the permission matrix. A missing policy is the
  design, not an oversight.
- Buckets stay **private**. No public URLs. Signed URLs are minted per request.
- **No video bytes through Vercel** — the browser uploads directly to Supabase
  Storage with a signed token, and plays back from a signed URL.
- Storage paths are derived **server-side from a validated UUID**, never taken
  from a request, so a crafted request cannot address another object.
- Report figures are re-read from Supabase on every question. Never trusted from
  the browser.
- **Missing is not zero.** PPTA is never summed. Estate figures are per-salon
  averages, never totals. MTD is never summed across dates.
- No transcript text without a real provider. `not_configured` is the honest
  state; fabricating transcript text is prohibited.
- Demo data appears only in demo mode. Live mode never shows a demo record, a
  demo note, or invented activity.

### Coding notes that have already cost a round each

- `Object.hasOwn` for allowlist membership, never the `in` operator — `in` walks
  the prototype chain, so `"constructor"` and `"toString"` pass.
- `Record<Union, string>` to prove exhaustiveness. `satisfies readonly Union[]`
  proves the members are *valid*, not that the list is *complete*.
- **Competition ranking ("1224")** for any ranking users see: equal values share
  the smallest rank, and quartiles are derived *from the rank* so a tie cannot
  split across bands.
- `createSignedUploadUrl(path, options?)` takes **no expiry argument**. The
  Storage API fixes the TTL. (Verified in the installed SDK source.)
- Vitest: `vi.hoisted`, `vi.doMock`/`vi.doUnmock`, and
  `vi.resetModules()` **per** `loadRoute()` call. `fireEvent` over `.click()`.
- Tests that assert on source text must **strip comments first**. These files
  explain the rules they must not break, so raw-text matching hits the
  explanation.
- Next.js lint: `module` is a reserved identifier. `react-hooks/set-state-in-effect`
  forbids a synchronous `setState` in an effect body — use a lazy `useState`
  initializer.

### Commit style

Descriptive subject in the imperative. End every commit with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: <session url>
```

No model identifier anywhere else in a pushed artifact.

---

## 4. What has shipped

Most recent first. All on `feature/ask-sunny-forms-template-engine`, mirrored to
the `claude/*` branch.

| Commit | What |
|---|---|
| `bdcb1d2` | Knowledge ingestion — HTTP 546 subdivision, batch 16 → 4 |
| `2849d68` | Video admin remediation — single-video status boundary, needs-attention cleanup control |
| `e03f7f1` | Video library admin UX — edit, delete, real previews, category-first layout |
| `e9995cd` | Trigger-function revoke gap closed (`anon`, `authenticated`) — **applied** |
| `888d9b0` | Video ceiling aligned to the 50 MB the project can accept |
| `d17a4df` | Video state machine — demo seed, status partition, pending cleanup, error contract |
| `1da97a0` | Video cloud wiring — the UI actually pointed at the backend |
| `fef5d04` | Video cloud foundation — migration, APIs, player, transcript seam |
| `f004839` | Report answers rendered through `RichText` |
| `c79663d` | Signal correctness — competition ranking for ties, median-percent wording |
| `49651ad` | Interpretation quality — deterministic signals layer |
| `5e1b2fa` | Sales Totals AI milestone 1 remediation |
| `5d1cc04` | Sales Totals AI milestone 1 — "Ask Sunny about this report" |

### Sales Totals AI analysis

**`src/lib/ai/call-claude.ts`** — the single place the app calls Claude. One
model id, one effort setting, one error contract. Never rethrows an SDK error:
the error echoes the request, and the request carries the grounding text.

**`src/lib/reporting/analysis/sales-totals-signals.ts`** — deterministic
comparisons, so the model explains rather than eyeballs. Competition ranking;
quartiles derived from rank; `highest`/`lowest` are **arrays** (every salon
sharing that rank) alongside `allValuesEqual`. Deliberately **not** computed:
cross-metric spread, IQR, z-score, percentile, or any performance judgement.
`baselineAvailable: false` is a field, not a comment.

**`src/lib/reporting/analysis/sales-totals-context.ts`** — `boundSalonRows()`
keeps **both** ends (top half and bottom half, slices made disjoint), and
unreported salons get a reserved share so they are never presented as the
bottom.

**`src/lib/reporting/analysis/view-fingerprint.ts`** — identifies the view a
question was asked about, so an answer cannot land in a conversation that has
moved on.

**`src/lib/reporting/analysis/analysis-prompt.ts`** — FACT / SIGNAL /
INTERPRETATION, with CAUSE prohibited. The selected metric leads broad answers;
no invented priority; "high" or "low" needs its basis in the same sentence;
measures are never ranked by spread; report grounding outranks prior turns.

**`src/features/reports/sales-totals/ask-sunny-panel.tsx`** — one atomic
`Conversation` state object carrying its own fingerprint; `settle()` refuses to
append an answer to a conversation that has moved. Renders through `RichText`.

**`src/lib/reporting/read/sales-totals-view.ts`** — `selectionInvalid`
distinguishes "no filter" (means all salons) from "an explicit filter that
matched nothing" (means none). Decided from what was *requested*, not from what
resolved.

### Training video library

Both migrations are **applied** to `rbkylaavthsjepsczccv`:

- `supabase/migrations/20260906001000_training_videos.sql` — private
  `training-videos` bucket, `file_size_limit 52428800`, MIME
  `video/mp4|webm|quicktime`; `training_videos` table, two enums, RLS enabled and
  forced with zero policies, `updated_at` trigger, and two load-bearing
  constraints (`..._ready_has_object`, `..._ready_transcript_has_text`).
- `supabase/migrations/20260906001100_training_video_function_revoke.sql` — the
  trigger function closed to `public`, `anon`, `authenticated`.

**`src/lib/videos/policy.ts`** — the limits, the MIME allowlist, the playback
TTL, and `storagePathFor()`, which throws unless the id is a UUID.

**`src/lib/videos/categories.ts`** — the one runtime vocabulary for the seven
categories, keyed as a `Record<VideoCategory, string>`. `src/data/demo/videos.ts`
re-exports it rather than restating it.

**`src/lib/videos/repository.ts`** — `listTrainingVideos`,
`failPendingTrainingVideo` (guarded on `status = 'pending_upload'`),
`updateTrainingVideoMetadata` (six named parameters to six named columns — no
spread, no `Partial<>`, no `updated_at`), `deleteTrainingVideoRow`.

**`src/app/api/videos/route.ts`** — `GET` returns ready videos, plus a
`needsAttention` list that is empty unless the caller holds `manage_videos`
(partitioned at the database, not in the client). `POST` issues a signed upload
capability and returns an explicit `recordCreated` boundary.

**`src/app/api/videos/[id]/route.ts`** — `GET` / `PATCH` / `DELETE`. `GET`
enforces the **same status boundary as the list**: `ready` to anybody holding
`view_videos`, `pending_upload` and `failed` only with `manage_videos`, and a
withheld row is refused with the identical 404 a missing row gets so the
endpoint cannot confirm which UUIDs are real. Delete order
is **row first, then object**: a private orphaned object is safer than a visible
"ready" row pointing at missing media. A storage-cleanup failure reports
`{ deleted: true, storageCleaned: false, warning }` and names no path; a
row-delete failure never claims success.

**`src/features/videos/cloud-upload.ts`** — three calls: `POST /api/videos`,
then `uploadToSignedUrl` **direct to Supabase**, then
`POST /api/videos/:id/finalize`. Five named stages. Uses the server's explicit
`recordCreated` rather than inferring it from an HTTP status.

**`src/features/videos/video-preview.tsx`** — lazy `IntersectionObserver`,
signed URL fetched per card, `preload="metadata"`, `#t=1`, muted, no autoplay,
no loop, `aria-hidden`, `tabIndex={-1}`. Any failure renders the placeholder.

**`src/features/videos/videos-screen.tsx`** — `live ? cloudVideos : localVideos`,
never merged. Counts are over the whole library, not the filtered view. Category
sections in canonical order. Demo note and demo activity are demo-only.

**`src/features/videos/uploads-needing-attention.tsx`** — the pending and failed
rows, each with a delete control naming its video that opens the one shared
`DeleteVideoDialog`. It never deletes itself, checks no permission of its own
(`needsAttention` is empty unless the server judged the caller may manage), and
renders nothing at all on an empty list.

**`src/lib/videos/transcription.ts`** — the `VideoTranscriptionProvider` seam,
with an `UnconfiguredTranscriptionProvider` that **refuses** rather than
returning empty text. No provider is wired: every hosted option costs money, and
the brief said to skip it if it does.

### Knowledge ingestion — the embedding batch

**`src/lib/config/models.ts`** — `EMBEDDING_MAX_BATCH` is **4**, not 16. This is
a measured number, and the measurement is written down beside it: a 58-page PDF
failed on its first batch of 16 with HTTP 546, and the `embed` function's logs
recorded `sb_error_code: WORKER_RESOURCE_LIMIT` with `CPU Time exceeded` at
2357 ms and 2451 ms. A one-input request on the same deployment returns in
173-202 ms, so ~11-15 gte-small inferences fit a ~2 s per-request CPU budget and
16 sat on top of it. Raising it again without new measurements re-opens the bug.

**`src/lib/embeddings/types.ts`** — `EmbeddingResourceLimitError` and
`WORKER_RESOURCE_LIMIT_STATUS` (546). A distinct class rather than a status
compared at a call site, because it is the ONE embedding failure smaller work
can fix. 404, 429, 401, and every dimension/model/count mismatch must not be
retried: `instanceof` is what stops that widening by accident.

**`src/lib/embeddings/supabase-provider.ts`** — `embedAdaptive` halves a batch
on 546 and retries both halves, recursing until it succeeds or reaches a single
input, which throws. Termination is structural (each call strictly shortens the
list; a list of one does not recurse), so depth is bounded by log2(batch) and
requests by 2n-1 — no retry counter. Halves run sequentially, head before tail,
so `out[i]` is always the vector for `texts[i]`. There is no partial success.

**Not fixed, deliberately — re-uploading a failed document duplicates it.**
`buildStoragePath` includes the version, and a re-upload of the same title
increments `version` and appends the old one to `previous_versions`. So each
failed re-upload writes ANOTHER copy of the original to the private bucket:
the Safety Binder's failed row carries two objects totalling 2.7 MB and zero
chunks. The supported recovery path is `reindexDocument` (Retry), which re-reads
the stored original in place, keeps the version, and adds no object. The
duplication was outside the 546 brief and is named here rather than changed.

## 5. Verified against the live system, and not

The line between these two lists matters more than either list does. Everything
in the second one is proven only by test against a faked Supabase client, and a
report that describes any of it as working has overclaimed.

### Verified by real use

**Video upload, end to end.** Paulyne uploaded the real video *Adamant: In a
hurry* through the browser and it appeared in the live Training Videos library.
Because the library returns **ready rows only**, that single observation
establishes all of:

- a real browser upload was attempted and **completed successfully**;
- the video reached the **cloud-backed** library, not local storage;
- the row reached **ready / finalized** state — the `..._ready_has_object`
  constraint means an object exists in the bucket;
- the persisted video is **visible after server-backed library retrieval**.

**Sales Totals analysis, post-remediation.** At least one **real** Claude
analysis call has been made against the report analyser *after* the
deterministic-signal and prompt work, asking *"What should I look at first?"*,
and the returned answer was **manually reviewed**. Broad-question
selected-metric behaviour has therefore been inspected by a person.

**The 546 root cause.** Read from the `embed` function's own logs on
`rbkylaavthsjepsczccv`: two `POST | 546` on `/functions/v1/embed`, each with
`sb_error_code: WORKER_RESOURCE_LIMIT` and a matching `CPU Time exceeded` plus
worker shutdown. Not inferred from the status code.

### Not verified — do not claim these

Not disproven; simply never exercised against the live system:

- **Seek / scrubbing** in the player.
- **Cross-browser playback.**
- **`DELETE`** against a live row and its object.
- **`PATCH`** against a live row (the Leadership → Training edit is still
  pending QA — see §6).
- **Card-frame previews** as shipped in `e03f7f1`.
- **Every other prompt path and follow-up conversation turn** in the report
  analyser. One reviewed answer to one broad question is not exhaustive
  coverage of the prompt.
- **Everything in `2849d68`.** The single-video status boundary is proven
  against a faked Supabase client and the real permission matrix; the
  needs-attention delete control is proven in jsdom. Neither has been exercised
  against `rbkylaavthsjepsczccv` or a real signed-in Employee.
- **Everything in Phases 2 and 3, and their remediations.** The proposal path, the location refusals, the
  proposal card, the create-and-draft flow and the inline editor are proven
  against faked repositories, a faked auth context, a faked `fetch` and jsdom —
  never against `rbkylaavthsjepsczccv`, a real signed-in Salon Director or a real
  browser. **No form has been created against the live database by this
  workstream, and none should be except with synthetic employee data.** **jsdom
  is not a browser**, and no laptop or mobile Preview QA has been performed on
  this branch by anyone, for Phase 1, 1.1, 2 or 3.
- **That `bdcb1d2` actually indexes the Safety Binder.** The 546 diagnosis is
  from the live function's own logs, but the fix is proven only against a faked
  worker. No document has been re-ingested since — the brief forbade
  re-uploading it, and the failed row was left untouched.

## 6. What is next

**No new implementation without confirmation.** But note the order below: the
video administration milestone **has not passed final QA**. The two Important
findings raised against `e03f7f1` were remediated in `2849d68` — by code and
test only. Do not treat the milestone as finished.

### Order of work

1. ~~Remediate the two open Important findings.~~ Done in `2849d68`; see the
   next subsection for what was changed and what that does *not* establish.
2. **Independent QA / review of that remediation** — not self-certified. **This
   is the next step.**
3. **Then** manual Preview QA of the video administration milestone:
   - the **Leadership → Training** edit on *Adamant: In a hurry*;
   - grouped **category counts and section movement** after that edit;
   - the **real card preview** frame;
   - **playback**;
   - **refresh persistence**;
   - **delete of a disposable video** — never a live one Paulyne relies on;
   - **Employee-role behaviour** (no manage controls, no pending or failed rows);
   - **an Employee requesting `GET /api/videos/:id` for a known pending or
     failed UUID** — must be a 404 that reads exactly like a missing row;
   - **clearing a stuck upload** from *Uploads needing attention* — the named
     confirmation, then the row gone after the refetch.

### QA findings against `e03f7f1` — remediated in `2849d68`, not yet reviewed

Both were raised independently of each other, and both are closed **in code**.
Neither has been independently reviewed or exercised in Preview, so the
milestone is not complete.

**IMPORTANT 1 — single-video status authorization.** *Was:*
`GET /api/videos/:id` authorized `view_videos` and returned
`getTrainingVideo(id)` with no status predicate, so a viewer who knew a UUID
could read a row the list endpoint deliberately withheld.

*Now:* the route reads `manage_videos` from `DEFAULT_PERMISSION_MATRIX` against
the identity `authorizeRequest` returned, and refuses unless the row is `ready`
or the caller may manage. The refusal is the **same 404** a missing row
gets — same status, same code, same wording — so the response cannot be used to
confirm which UUIDs name real videos. A distinct 403 would have been an oracle
for guessing them.

**IMPORTANT 2 — needs-attention cleanup UI.** *Was:* the *Uploads needing
attention* section rendered title, status and badge only. `DELETE` already
accepted a pending or failed row and `DeleteVideoDialog` already carried the
wording for one, but nothing on the page could reach either.

*Now:* each row carries a delete control naming its video, which opens the one
shared `DeleteVideoDialog` and refetches on success — the same flow, and the
same confirmation, a library card uses. The section moved into
`src/features/videos/uploads-needing-attention.tsx` so the control could be
tested by **rendering and pressing it** rather than by matching source text; it
returns `null` on an empty list and checks no permission of its own, because
`needsAttention` is empty unless the server judged the caller may manage.

**What the tests establish, and what they do not.** Mutation-checked both ways:
removing the boundary fails 4 of the 7 new API tests (a 403 in place of the safe
404 fails 3), and removing the control fails 8 tests across the two files. That
is a faked Supabase client and jsdom. It is **not** evidence about a live row, a
real Employee session, or the rendered Preview — see §5.

### Chat-native forms — Marissa feedback (Phase 0 complete)

`docs/chat-native-forms-phase-0.md`, on
`feature/chat-native-forms-marissa-feedback`. Read-only audit: no source
changed, no migration, nothing deployed.

**The ask.** Chat becomes the front door. A manager describes an incident, says
"build me the coaching form for that", and the real form is created, drafted,
edited, finalized and downloaded **inside the thread** — using the existing Forms
backend, not a second one.

**What the audit settled:**

- **No migration is needed for Phase 1.** `form_instances.source` already has an
  `ask_sunny` value, and `POST /api/forms/instances/[id]/draft` already accepts
  exactly the `{ notes, topic }` a conversation can supply. The work is an
  orchestration layer plus a renderer, not a change to the Forms API.
- **Chat is browser-local.** Conversations live in IndexedDB under
  `chat_conversations`; there is no chat table and no server record. So a chat
  message may hold a `formInstanceId` and presentation metadata and **never the
  form values** — copying them would recreate the per-browser divergence the
  video milestone was built to remove. One source of truth: `form_instances`.
- **The existing handoff carries the template and the employee and loses the
  incident**, which is why the manager describes it twice. The lost draft is
  correct behaviour, not a bug: it was written against pre-versioning field ids.
  The fix is to move the drafting, not to start trusting the old draft.
- **Location cannot be inferred honestly yet.** The scope model is real
  (`app_users.scope_*`) but resolves through `DEMO_LOCATIONS`, and
  `createInstance` does not validate `locationId` against the actor's scope — a
  gap that exists today, reachable from the standalone builder.
- **There is no employee directory, and none should be invented.**

**Also confirmed while auditing** (findings only, nothing changed): the salon
count 12 vs 15 is two different corpora — 12 is `DEMO_REVIEW_METRICS`, 15 is real
ingested Sales Totals rows; the stray "3" before citations is the unlabelled
`<Badge>` at `source-card.tsx:71-76`; `.eyebrow` fails WCAG AA at **3.35:1**; the
Vercel toolbar is a platform setting with nothing in the codebase; "JV &
Associates" appears 9 times with `lib/brand/index.ts:27` as the real source.

**Reviewed and approved.** Phase 0 passed independent review — the branch was
checked against the tree, not taken from the report. Implementation planning is
approved; no phase starts without a bounded brief.

**The approved sequence** (§15 of the Phase 0 doc), with one correction to what
this workstream first proposed:

1. ~~**Chat workspace cleanup**~~ — **SHIPPED**, see `docs/chat-phase-1.md`.
   Composer compacted (mode control moved inside the input surface), dead
   attachment/image/voice controls removed, disclaimer to one visible line with
   the full note on a focusable info affordance, stray citation count badge
   removed. Two real layout defects were found and fixed while auditing the
   height chain: `ChatScreen` claimed `lg:h-dvh` beneath a 56px shell header
   (overflowing the page by exactly the header height on every laptop), and the
   conversation column was missing `min-h-0`. **Preview QA on laptop and mobile
   is outstanding — no human has looked at it yet.**
1.1 ~~**Chat cleanup + Knowledge preview/re-download**~~ — **SHIPPED**, see
   `docs/chat-phase-1-1.md`. Both chat source surfaces removed (the in-thread
   block and the context rail's "Sources for this answer") with retrieval,
   citations and coverage untouched; Knowledge Base gained Preview and Download
   original for the stored original, behind `view_knowledge`, via a short-lived
   signed URL. The "Coming later" controls were **already absent at `f31aacb`** —
   most likely a stale Preview on the baseline branch's URL, unprovable from here
   because Vercel `list_projects` returns empty for the team. Nothing was changed
   to chase the screenshot; the requirement is now pinned repo-wide instead.
   **Remediation 1 applied:** QA found the new file route read the knowledge
   corpus from `?scope=`, so an authenticated Sun Tan City manager could name
   `bcs-core` — a real brand in `lib/brand` — and be handed another company's
   file. Now bound to `ACTIVE_BRAND.knowledgeScopeId` server-side, with the
   parameter removed from the client too. Proven exploitable: with the fix
   reverted the attack test gets a 200 and a signed URL.
   **Remediation 2 closed the same pattern on five more routes** — list, delete,
   reindex, search, upload and chat. Two of those (upload and chat) were missed
   by the first audit, which reported four. All seven knowledge entry points now
   derive the corpus from one shared authority, `activeKnowledgeCorpus()`; no
   first-party client sends a corpus; `GET /api/knowledge/documents` was aligned
   from `ask_questions` to the `view_knowledge` its page requires. Each route has
   a two-corpus adversarial test that seeds real foreign data and proves it is
   reachable when its own corpus asks, before proving the browser cannot make
   the corpus ask. **`bcs` is Buff City Soap** — the Phase 1.1 write-up called it
   "Beach Comber Suns"; corrected in the docs, history not rewritten.
   **No live cross-brand data access is claimed:** the tests prove the code path
   allowed it where foreign data exists.
   **Preview QA outstanding.**
2. ~~**Security + structured form proposal**~~ — **SHIPPED**, see
   `docs/chat-phase-2.md`. Chat used to **draft** an employment document; it now
   **proposes** one and says what it does not know.

   `lib/forms/chat-flow.ts` is **deleted**, not deprecated. It defaulted the
   employee to "Jane Kowalski", the reason to repeated tardiness, the job title
   to "Tanning Consultant", the follow-up to today + 14, and any unrecognised
   form request to the Coaching Form — then offered the result as a one-tap
   follow-up chip. Its `extractEmployeeName` accepted a capitalised leading word,
   so "Create a coaching form for a performance concern" named an employee
   **Create**. What survived is the fillRule guard, now `lib/forms/fill-rules.ts`
   with its tests carried across unchanged in substance.

   In its place: `template-intent.ts` (which form the manager NAMED — never a
   default), `proposal.ts` (manager turns only, bounded, no fallbacks),
   `location-scope.ts` (which salon), `ai/form-proposal.ts` (validate against the
   published active library, apply the template's own `required_permission`,
   write nothing). A `ChatFormProposal` carries no HR field values at all.

   **The location gap is closed at `POST /api/forms/instances`** — the route every
   form-creating caller goes through, not in chat orchestration. It read
   `locationId` and `locationName` from the body and stored them unchecked while
   `authorizeForms` discarded the `AccessScope` it already had. Proven
   exploitable: with the fix reverted, filing against a foreign salon returns 200.

   The proposal card carries **no controls at all** — no Create, Finalize, PDF or
   Start another — because confirming a proposal is Phase 3. Nine mutation checks
   were run and every one failed the suite. **Preview QA outstanding.**
3. ~~**Inline form draft**~~ — **SHIPPED**, see `docs/chat-phase-3.md`. This is
   the checkpoint where Marissa's request became a feature: a conversation
   becomes a real `form_instances` row, drafted from what the manager actually
   said, edited and saved without leaving the thread.

   **Phase 2 remediation first.** QA found `managerContext()` walked its bounded
   window oldest → newest and stopped at the first overflow, so a long earlier
   statement could spend the whole budget and the manager's newest correction
   never entered the context — "Sarah was late three times" surviving while
   "Correction — it was twice" was dropped. Every other bounding failure gives a
   thin draft; this one gives a confident wrong one. Retention now runs
   newest-first, presentation is restored to chronological order, and
   `sourceMessageIds` names only what was actually retained.

   **Scoped to the Coaching Form.** Every other published template still
   proposes and gets no create action — not a disabled one.

   **The server stays the authority.** The proposal is browser-local IndexedDB
   and is treated as untrusted orchestration metadata: `POST
   /api/forms/instances` re-resolves the template, pins the published current
   version, applies the template's own `required_permission` and authorizes
   `locationId` against the `AccessScope`, every time. One hardening was added —
   the route now refuses an **inactive** template with a 404 instead of letting
   it reach `createInstance` as a 500.

   **Chat stores an id, never a copy.** `ChatMessage.formInstanceRef` carries
   `instanceId`, `proposalId` and a presentation label. No field values, no
   status, no follow-up date — those change on the server, and a copy in chat
   would be stale in the most dangerous direction. Every render fetches by id;
   404 and 403 say so and **never recreate the form**.

   **Create succeeds, draft fails** is handled explicitly: the reference is
   reported the moment the row exists, a prefill failure becomes a warning, and
   nothing is deleted, retried or duplicated.

   **The paper renderer is not used.** A second *renderer* was built from the
   same `FormDocument` — fluid, one column on mobile, `min-w-0` throughout —
   because `DocumentSurface` is a fixed 816px sheet and that scrollbar is what
   Marissa named. There is no second field model and the PDF path is untouched.

   **No Finalize, no PDF, no Start another, no View in Form Monitoring.** Phase
   4. Ten mutation checks run, every one failing meaningful tests.

   **REMEDIATION 1 — five QA findings, all closed.** See
   `docs/chat-phase-3-remediation-1.md`.

   1. **Reference durability.** The instance reference was returned only after
      drafting settled — up to two minutes during which a real HR record existed
      and chat still offered "Create draft". Now an `onCreated` callback fired
      before the drafting request.
   2. **Atomic message patch.** Persisting it mapped over a snapshot of the
      conversation, erasing any turn sent in the meantime. The store patches one
      message against current state; `send()` appends instead of rewriting.
   3. **Proposal continuation.** Answering "who is this for?" with a bare name
      was routed into retrieval. A bounded hint — a template key and nothing
      else — continues the proposal, honoured only when the turn yields a name,
      and revalidated server-side against the library and the actor's
      permission. Explicitly not `pendingFormValues`.
   4. **Existing-instance access scope.** THE BIG ONE. Creation was authorized;
      everything after it was not. A Salon Director who knew a UUID could read,
      edit, finalize, archive, delete and download the PDF of another salon's
      disciplinary record, and Form Monitoring listed every form in the company.
      Every editing verb also hard-coded `create_coaching_form`, so a Salon
      Director could edit an EPP. All nine verbs now go through
      `authorizeInstance`: the template's own permission, the caller's
      AccessScope, and a **404** rather than a 403 so a UUID is not an existence
      oracle. Monitoring is filtered server-side by the same predicate. A form
      with no salon belongs to whoever created it.
   5. **Context parity.** The browser bounded the conversation with a different
      rule from the server's, so an over-4,000-character turn gave a valid
      proposal and an empty drafting context. One implementation now —
      `lib/forms/bounded-context.ts`.

   Also: `locationName` is dropped **server-side in live mode** for every
   caller, closing the standalone builder as well as chat. Nine mutation checks
   run, all failing meaningful tests.

   **REMEDIATION 2 — three follow-on findings, all closed.** See
   `docs/chat-phase-3-remediation-2.md`.

   1. **Prefill / editor race.** Remediation 1's fix was right and exposed a
      second race: the editor rendered immediately, read the seeded values, and
      never refetched while Sunny spent up to two minutes writing the real ones.
      So the manager saw an empty-looking form and concluded prefill had failed
      when it had succeeded — and could type into the same canonical record the
      assistant was still writing. The reference is STILL persisted immediately;
      the form is now read-only with an honest notice until prefill settles,
      then re-reads the canonical instance (a GET, never the draft response) and
      opens editing. On a refresh mid-prefill the form's own `drafted` event
      answers whether prefill completed — still-running versus permanently-failed
      is NOT distinguishable without schema, so the wording claims neither.
   2. **Creator override bypassed current scope.** `createdBy === actor.id` sat
      above the location rule, so a manager who transferred kept access to the
      salon they left, and district/region fail-closed was punched through for
      records they had created. A record naming a salon is now decided by the
      CURRENT scope, full stop; the creator exception applies only where the
      record names no salon.
   3. **Monitoring filtered after a global limit.** The query took the newest 200
      company-wide and the route filtered that page — confidential, but with 22
      locations an authorized record older than 200 foreign ones never entered
      it, so a manager's own history silently lost rows. `listInstances` now
      takes a scope filter: at most two bounded reads, merged and sorted
      server-side, limited to the VISIBLE set. `visibleInstances` still runs
      after it, deliberately, so a drift between query and predicate fails
      closed.

   One defect was found while making change 1 and fixed: `readOnly` covers two
   situations now — frozen and busy — and the status badge was driven from it,
   so a form would have read "Finalized" while it was an unsigned draft being
   prefilled. The badge reports `instance.status`; `readOnly` governs controls.

   Six mutation checks run, all failing meaningful tests. **Preview QA still
   outstanding.**
4. **Finalize** — follow-up date, finalize, PDF, monitoring link, Start another.
5. **Mobile / reporting / nav / Overview / polish.**

Location authorization moved from phase 4 to phase 2. The original plan called
the unvalidated `locationId` P0 and then scheduled it fourth, which cannot both
be true: building the inline workflow first would mean every caller written in
the meantime is another caller to go back and fix.

**That decision was made in the Phase 2 brief: FAIL CLOSED EVERYWHERE.**
Accept-and-record was explicitly rejected — *"for an HR record, an unverifiable
salon must not be treated as authorized"* — because an accepted-but-unverified
salon reads exactly like a verified one to everybody who opens the record later,
and the record outlives the caveat.

So `salon` scope is validated exactly against `{primaryAreaId} ∪ alsoCoversAreaIds`,
`global` is unrestricted, and `district`/`region` are **refused**: their
`primaryAreaId` is an area id, nothing expands an area into its salons, and
`DEMO_LOCATIONS` is seeded demo data rather than an authority.

**The cost is real and is not hidden:** until a salon roster exists, a district or
regional manager cannot create a form that *names* a salon. They can still create
one without a salon, and still ask Sunny anything.

**Phase 3 shipped without the roster**, because the case it needed was already
provable: a salon-scoped actor with exactly one authorized id. The roster is
still the blocking dependency for district and regional inline creation, for a
picker across several salons, and for showing a salon **name** rather than an id
— and Phase 3 established that the only source of a salon name in this app is
`DEMO_LOCATIONS`, so no form created from chat carries one.

**Do not merge this branch anywhere** until every phase is done and tested on
Preview on both laptop and mobile. The merge target is
`feature/ask-sunny-forms-template-engine`, never `main`.

### Known follow-ups, not yet commissioned

1. **A real live training-video activity / audit log, if desired.** As of
   `e03f7f1`, `DEMO_VIDEO_ACTIVITY` is **demo-mode only** and live mode
   **hides** the Recent Video Activity section entirely — live mode does *not*
   render demo activity. What is missing is a real log, which needs its own
   migration and its own approval.
2. **Overview and global search are not pointed at the cloud video library.**
   They will show zero videos in live mode now that the app store no longer
   seeds `DEMO_VIDEOS`.
3. **Normal Ask Sunny chat does not yet recommend cloud videos.**

Also outstanding: **transcription**, deliberately unwired. A self-hosted
Whisper / whisper.cpp path was raised as the likely future option — one-time
model download, own compute, no per-minute charge, and the audio never leaves
our infrastructure. The `VideoTranscriptionProvider` seam accepts either that or
a hosted provider without changing a route or a column.

## 7. Related documents

- `docs/chat-native-forms-phase-0.md` — the read-only architecture audit and the
  approved phase sequence.
- `docs/chat-phase-1.md`, `docs/chat-phase-1-1.md`, `docs/chat-phase-2.md`,
  `docs/chat-phase-3.md`, `docs/chat-phase-3-remediation-1.md`,
  `docs/chat-phase-3-remediation-2.md` — the chat-native-forms checkpoints, in
  order.
- `docs/architecture-constraints.md` — settled decisions later work may not
  reopen.
- `docs/authentication-setup.md`
- `docs/production-demo-posture.md` — what live mode may and may not show.
- `docs/reporting-ingestion-contract.md`
- `supabase/README.md` — migration and re-embed rules.
