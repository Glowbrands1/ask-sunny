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
   `npm run build`. At `2849d68` the suite is **2227 passed, 7 skipped, across
   111 files** — a checkpoint that lowers the passing count owes an explanation.
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

- `docs/architecture-constraints.md` — settled decisions later work may not
  reopen.
- `docs/authentication-setup.md`
- `docs/production-demo-posture.md` — what live mode may and may not show.
- `docs/reporting-ingestion-contract.md`
- `supabase/README.md` — migration and re-embed rules.
