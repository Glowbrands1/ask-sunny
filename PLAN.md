# PLAN: one form record per chat, one model call per turn (Ask Sunny + Ask Bubbles)

Status: **plan only, nothing built.** The same file is on `claude/router-plan` in
both repositories. Every step is built the same way in both apps, in the same
session, as one commit per app (`Port from Ask Sunny (<sha>): …` /
`Port from Ask Bubbles (<sha>): …`). QA alone merges and flips flags.

## Decisions (owner, 5 Nov 2026)

1. **Where the record lives.** It goes under the `formRecord` key of the
   existing `chat_form_state.state` column, merged with what is already there
   and never overwriting it.
2. **"No extra model calls"** covers the form readers only. The retrieval
   helpers (query rewrite, recall, long-context summary) stay as they are for
   now.
3. **Transcripts.** sf-s21 to sf-s29 and sf-b6 have been received, with names
   replaced. They are summarised in Step 0. In the case files, "Employee R"
   becomes an invented roster name, used the same way in every fixture.
4. **New tool wording.** The four new tool descriptions (`answer`,
   `start_form`, `finalize_draft`, `ask_one_question`) are drafted for approval
   before they are used.
5. **Scope now: Steps 0 and 1 only**, built on `claude/router-plan` in both
   repos, with no merge and no pull request to `main` without QA. Steps 2 to
   7 wait until the owner says the sales fix is stable. Step 1 is both parts
   (no picker or heading while a form is in progress, and the final
   dangling-heading check) behind `REPLY_CUT_CHECK_ENABLED`, off by default.
   Tool wording is held until Step 4.
6. **Before any step's flag is switched on,** its replay cases must also pass
   once on **the production model for each app** (Sonnet in Bubbles, Opus in
   Sunny). Haiku live runs alone are not enough.
7. **The approved template changes are built elsewhere** (the Corrective
   Action revision in Bubbles #424 / Sunny #512 and the `CA_SALES_POLICY`
   track). This plan builds, copies and changes none of that. It reads the
   form's pinned template version and today's behaviour as they are. See
   "Compatibility with the approved template changes" below.

## Progress (5 Nov 2026): Steps 0 and 1 built, not merged

Both are on `claude/router-plan` in both repos, the same mechanism in each,
with each app's own wording and fixtures.

**Step 0: replay cases** (`src/app/api/chat/replay-pack/`):

- **Case files:**
  - `nov5-silent-failure-cases.ts`: sf-s21 to sf-s29 and sf-b6.
  - `nov5-picker-heading-cases.ts`: the 9 earlier Bubbles replies that ended
    on "I can prepare:".
  - `nov5-template-changes-cases.ts`: tc-1 to tc-8.
- **Helpers in `cases.ts`, additive:** `endsAsSentence` and
  `noAsYouSaidUnlessSaid` (structural, no phrase list).
- **Harness, additive:** `pinVersion` in the harness, which puts a form on an
  earlier template version with that version's own ticks.

**Invented names**, each checked against both apps' employee directories
(0 matches):

- Odessa Quillfeather is "Employee R".
- Rhea Vantress is the other employee in sf-s21 and sf-s22.
- Talia Brennick is the sf-b6 employee.
- Ember Thistlecombe is the employee in the tc cases.

**How each case runs on production's flags today.** "open" fails on its own
assertion, as production did. "fixed" already holds.

| Case | Ask Sunny | Ask Bubbles |
|---|---|---|
| sf-s21 | open (full remap pinned, see below) | fixed: the other employee's facts never land here |
| sf-s22 | open | open |
| sf-s23 | open | open |
| sf-s24 | open (full remap pinned) | fixed: no false "as you said" here |
| sf-s25 | open (full remap pinned) | open (observation is the question) |
| sf-s26 | open | open |
| sf-s27 | open (full remap pinned) | open |
| sf-s28 | open | fixed: the previous turn's incident is used here |
| sf-s29 | open | fixed: the question goes to the forms on file here |
| sf-b6-reply | open → **holds with `REPLY_CUT_CHECK_ENABLED`** | open → **holds with `REPLY_CUT_CHECK_ENABLED`** |
| sf-b6-policy | — | open (a later step) |
| sf-b6-card | — | open (a later step) |
| pk-1026-a…e (5) | fixed | fixed: the picker's cards come with the heading |
| pk-1102-a…d (4) | fixed | fixed: `OPEN_FORM_NO_SELECTION` since 3 Nov; also hold with Step 1 |
| tc-1 removed box never saved | fixed | fixed |
| tc-2 "Standards of Conduct — Cell Phone" | fixed | fixed |
| tc-3 cleaning → Other | open (not in this app yet) | open → holds with `CA_SALES_POLICY_ENABLED` |
| tc-4 old draft keeps its version | fixed | fixed |
| tc-5 old tick not converted by chat | fixed | fixed |
| tc-6 sales/MSB cites Standards of Conduct + page | fixed | open → holds with `CA_SALES_POLICY_ENABLED` + `CHAT_GLOSSARY_ENABLED` |
| tc-7 action plan two sentences | fixed (plan is manager-only here) | **open: an attendance CA's plan is saved as five sentences** |
| tc-8 payroll amount only the manager's | fixed | fixed |

**Findings for QA and the other tracks** (nothing here changes them):

1. **`FORM_FULL_REMAP_ENABLED` in Sunny production.** sf-s21, sf-s24, sf-s25
   and sf-s27 have a card shape ("**Policy:** …, as you said") that only
   `form-full-remap.ts` writes. Sunny's `production-flags.json` lists that
   flag as off.
   - Those four cases switch it on for their own run, with a comment saying
     so.
   - QA should confirm the production setting and update
     `production-flags.json` (QA's file) if it is on.
   - With the remap on, the card also says "**Job title:** … , as you said" and
     "**Salon:** …, as you said" for words the manager never wrote.
2. **tc-7, for the CA revision track.** With Bubbles' production flags, an
   attendance CA's action plan is saved as five sentences, written by code,
   not the drafting model.

**Step 1: `REPLY_CUT_CHECK_ENABLED`**, off by default, in both apps:

- **Code:**
  - `src/lib/chat/reply-ends.ts` (`checkedReplyEnd`).
  - One guarded block in `src/app/api/chat/route.ts`, after every reply
    rewrite.
  - The flag in `chat-quality-flags.ts` (Bubbles `CHAT_QUALITY_FLAG_NAMES`;
    Sunny `NEW_FLAGS` in `flags-off-parity.test.ts`).
- **Unit tests:** `src/lib/chat/reply-ends.test.ts`, 18 tests. They cover:
  - the sf-b6 reply;
  - the heading in the middle of a reply;
  - a picker with nothing in progress, which stays;
  - a list, a table, a citation marker, a time and a question, all left
    exactly as they were;
  - a reply is never left empty;
  - the flag reading off for unset, empty, 0, false, off and no;
  - the route loading the module only inside the flag.
- **Flag off is byte-identical.** The whole replay pack was run with replies
  recorded (`REPLAY_RECORD`) on `main` and on this branch, with the same case
  files. Every reply of every case is identical: 243 cases in Bubbles and 246
  in Sunny.
- **Not built: the live runs** (`ROUTER_LIVE=haiku` / `production`). This
  session has no Anthropic key, so a live harness could not be run even once.
  It is needed before any flag is switched on (decision 6).

## Found, not fixed (listed only; not built)

1. **Sunny's stream reader.** `collectModelResult` (`call-claude.ts`) returns
   partial text as a full answer when a stream ends without a `message_delta`
   (the stop reason stays `null`). Bubbles uses `finalMessage()`, which throws
   instead.
2. **Sunny's chat revision.** The `chat-revision.ts` model call is not wrapped
   in `withTruncationRetry`, so a revision cut off at `max_tokens` can be
   saved. Bubbles wraps it. The file is protected, so the fix needs approval.
3. **The cross-chat guard's sentence split** (both apps).
   `withoutCrossChatClaims` (`lib/chat/cross-chat-guard.ts`) treats every "."
   as a sentence end: decimals, "a.m.", "e.g.", `[p.12]` page markers. When
   it removes a sentence, it can leave a cut one. It did not cause sf-b6, and
   no reported case shows it yet.

## Why the bugs keep coming back

No single place says which form is open in a chat, who it is about, which
fields are filled and what step it is at. Every turn, separate readers guess
these again:

- **Type:** `template-intent`, `form-type-switch`, `form-opportunity`,
  `ca-offer` and `form-tool-understand`.
- **Person:** `intent-extraction`, `intent-slots`, `grounded-entities`,
  `first-name-*`, `roster-name-gate`, `team-subject` and others.
- **Store/salon:** `location-mention`/`salon-mention`, `store-cue`/`salon-cue`,
  `place-state`, `keeps-own-place`.
- **Fields:** `form-full-remap`, `keep-filled-slots`, `terse-slots`,
  `warning-level`, `incident-dates`.
- **Step:** `slot-only-turn`, `new-request-turns`, `proposal-currency`.

When two of them disagree, a fix adds another rule. There are also more than
three code paths that write field values:

- `chat-correction`
- `chat-policy-change`
- the `edit_form` handler
- `form-patch-turn`
- `chat-redraft`
- same-form copy
- `chat-revision`
- the draft route
- `chat-reopen` (Sunny only)

All of them end in `writeValues`.

The fix: **one saved record** of the open form, **one model call** that reads
that record and answers with a tool, and **one function** that applies the
tool's ops and is the only thing that writes.

## What already exists and is reused, not rebuilt

| Piece | Where (both apps) | Used for |
|---|---|---|
| `ai` 6.0.322 + `@ai-sdk/anthropic` 3.0.138 | `package.json` | The new main call (`generateText`). |
| `form-patch-call.ts` | `src/lib/forms/` | Template for loading the SDK: dynamic `import("ai")`, `createAnthropic`, `maxRetries: 0`, `AbortSignal`, spend-meter usage. |
| `edit_form` schema + description | `src/lib/ai/form-tool-schema.ts` (`editFormSchema`, `EDIT_FORM_TOOL_DESCRIPTION`) | The `edit_form` tool. The description is the owner's approved wording and is used exactly as written. |
| `writeFormEdits` + `applyPatch` | `src/lib/forms/form-write.ts`, `form-reducer.ts` | Already the "one writer" behind `FORM_EDIT_SINGLE_WRITER_ENABLED` (off). Refuses the whole patch if any op fails, rereads the form, returns `snapshotDiff`. The new apply function calls it directly. |
| `ConversationFormState` + `chat_form_state` | `src/lib/ai/form-state.ts`, `form-state-store.ts` | Where the record is stored (see step 2). |
| `truncation.ts` | `src/lib/ai/` | Retry once with a larger budget, then `AiError("truncated")`. Extended in step 1, not replaced. |
| Pinned template version | `forms/document.ts` (`fieldsForVariant`, `checkboxGroupsForVariant`), `responsibility.ts` (`draftableFields`) | The real field keys and the missing-field list. |
| Policy checks | `forms/policy-grounding.ts` (`refuseUnverifiedPolicyValues`); Sunny `ai/citation-verify.ts`; Bubbles `ai/policy-from-manual/verify.ts` | Step 6 checks. |
| Replay pack | `src/app/api/chat/replay-pack/` | Every case, first. |

## Rules for every step

- **Additive only.** One new flag per step, default off. Each flag goes in
  `chat-quality-flags.ts` with the "Same name in both apps. Default off." doc
  comment and is added to `CHAT_QUALITY_FLAG_NAMES` (Bubbles) / `NEW_FLAGS`
  (Sunny `flags-off-parity.test.ts`). It is **not** added to
  `production-flags.json` until QA flips it.
- **No UI change, no database schema change, no migration.**
- **Existing prompts untouched.** `buildSystemPrompt`, the rule blocks and the
  revision prompts are not changed, and `prompts.base.fixture.txt` / Sunny's
  `prompts-main-*.template.txt` stay byte-identical.
- **No phrase lists.** Anything new matches against data the app already has:
  template names and keys from the form library, field labels from the pinned
  version, roster names, manual headings, the manager's own messages.
- **Same code in both apps.** Only the company config differs (store ↔ salon,
  Forms Register ↔ Form Monitoring). No company wording is copied across.
- **Flags-off proof.** Each step adds a `*-flags-off.test.ts` that records the
  Anthropic request body and route output with the flag unset and compares
  them byte for byte to `main`. This is the same pattern as
  `chat-glossary-flags-off.test.ts`. `form-patch-flags-off.test.ts` already
  checks that `ai` is not loaded with flags off; it is extended to cover the
  new modules.
- **Live tests use Haiku only** (`CLAUDE_READER_MODEL`), with `maxRetries: 0`.
  They are opt-in by env var and never run in CI.
- **Tests before pushing:** `npm run lint`, `npx tsc --noEmit -p .`, the
  touched tests, then `npm test`.

---

## The steps, in order

### Step 0: the reported cases become replay cases first (no flag)

The cases go in before any fix.

- **Where:** `src/app/api/chat/replay-pack/nov5-silent-failure-cases.ts` and
  `nov5-template-changes-cases.ts`, **in both apps**. Every case is in both
  repos.
- **Company wording:** each app's copy keeps the mechanism and uses that app's
  own fixtures (store ↔ salon). Sunny wording never goes into Bubbles, and
  Bubbles wording never goes into Sunny.
- **Status:** each case starts as `status: { open: "…" }`, so it runs as
  `it.fails` and CI flags the day it starts passing. A step that fixes it sets
  `fixFlags: [...]`.
- **Assertions:** cases assert invariants, never model wording. They use the
  existing helpers in `cases.ts` plus two additive ones:
  - `endsAsSentence(reply)`: the reply does not end on a heading, a colon or a
    cut word.
  - `noAsYouSaidUnlessSaid(reply, managerTurns)`: an attributed claim
    ("as you said") only stands for words in the manager's own messages. It is
    a structural check: the attributed span must appear in the manager's
    turns. There is no phrase list.
- **Wording in the case files:** each case quotes the manager's wording
  exactly as QA supplied it. The only change is that "Employee R" becomes the
  invented roster name.

#### Live runs (opt-in, never in CI)

Live runs use a new `src/app/api/chat/replay-pack/live.test.ts`:

- `ROUTER_LIVE=haiku` runs the cases through the real route with
  `CLAUDE_READER_MODEL` (Haiku) and `maxRetries: 0`.
- `ROUTER_LIVE=production` runs the same cases once on each app's own
  `CLAUDE_MODEL`. This is the gate in decision 6, run before any flag is
  switched on.
- Neither mode retries. Results go to
  `docs/flag-classification/<FLAG>.live.md`.

#### The silent-failure cases

| Id | App reported | What happened | Invariant the case asserts |
|---|---|---|---|
| sf-s21 | Sunny | A CA request with the employee's metrics. The bot claimed the policy "as you said". A pasted CA for another employee was used as a template; the bot twice said it hadn't changed the form; "fill in the information for me" saved the **other** employee's month and numbers in the observation, policy text was only names, and there was no policy violated or action plan. | Only Employee R's facts on the form. No "as you said" for a policy the manager didn't say. The requested changes are applied and the reply matches the saved diff. The pasted CA's facts never reach a field. |
| sf-s22 | Sunny | "It needs to be a CA, not a coaching form". The bot went back to a Coaching Form twice after "Its a CA". Another employee's reviewer notes were pasted into the observation. | The type the manager typed wins and stays on every later turn. Another person's notes never reach the observation. |
| sf-s23 | Sunny | "not pay roll deductable" went into the observation, and the payroll question was asked again. "it should be under performance not standard of conduct" changed the policy, but the action plan and policy text still said Standards of Conduct. | The answer fills the payroll Yes/No field and is not asked again. A policy change updates the action plan and policy text too. |
| sf-s24 | Sunny | "it should be must see behaviors and she also had coaching on file … 10/22 and … 10/15" got a false "as you said". The whole message was dumped into the observation, and the saved policy differed from the card. | The card and the saved form agree. No false "as you said". The observation is not the whole message. |
| sf-s25 | Sunny | A CA with times (scheduled until 9:15PM, clocked out 9:01, equipment down at 8:11 PM) got an invented "as you said" policy, and the observation held an earlier question. | No invented policy claim. The observation is the incident, not a question. |
| sf-s26 | Sunny | "Edit [misspelled name] CA" asked who it was for. In a new chat, "Change Employee R CA" started a new form. | The existing CA is found and opened for editing. No new form. |
| sf-s27 | Sunny | "Create a coaching form." then the name. The bot said "Everything I need is here" with no draft and no incident. | It asks what happened, and never says everything is ready when a required field is missing. |
| sf-s28 | Sunny | The incident was asked about in one turn, then "write me a ca for Employee R from <salon>". The bot said "You haven't told me what happened yet", and the observation was the question. | The incident from the previous turn is used. The observation is never the question. |
| sf-s29 | Sunny | "are there any coaching and ca's for Employee R" described the CA form type. | The past-forms lookup runs and lists that employee's forms on file. |
| sf-b6-reply | Bubbles | The reply ended "Based on what you've described, I can prepare:". | `endsAsSentence`. No form picker while a form for this chat is already in progress (Step 1). |
| sf-b6-policy | Bubbles | The bot said no source states a policy and it would leave the field for the manager; the saved form then had an AI-filled policy. | No AI-written policy field after the reply said it would leave it blank. Policy fields only from a retrieved manual section. |
| sf-b6-card | Bubbles | The next card ignored the detail added after the first card. | The card after an added detail includes that detail. |

sf-b6 is split into three cases because Step 1 fixes only the reply. The
other two stay open until their own steps.

#### The approved template changes: replay cases only, no build

Each case reads the form's **pinned** template version. A case passes or
fails on today's behaviour plus the flags of the track that owns it
(`CA_SALES_POLICY_ENABLED`, `ACTION_PLAN_SENTENCES_ENABLED`, the payroll
flags). This plan adds no behaviour for them.

| Id | Invariant |
|---|---|
| tc-1 offense boxes | A new CA on the newest version offers Type of Offense = Attendance Policy / Standards of Conduct / Dress Code Violation / Other. Absenteeism is not offered. |
| tc-2 conduct sections | A Cell Phone, Social Media or Animals incident reads "Standards of Conduct — <section>", with the section from the retrieved manual. |
| tc-3 cleaning | A cleaning CA (e.g. not signing the cleaning checklist) ticks **Other**. |
| tc-4 old draft stays | A draft pinned to the older version keeps its version and boxes on every chat edit. The missing-fields list is computed from **its** version. |
| tc-5 revise converts | "Edit as new draft" on a newer version maps old ticks as #424/#512 do. The filed form, its version, its rows and its PDF are unchanged. |
| tc-6 sales/MSB policy | A sales or must-see-behaviours CA cites Standards of Conduct, with heading and page from the manual section retrieved that turn. It runs with `CA_SALES_POLICY_ENABLED` on as that track defines it, and the case only observes. |
| tc-7 action plan | The CA action plan is exactly two sentences. |
| tc-8 payroll amount | The payroll amount comes right after payroll Yes/No. It is asked once, only when Yes, and filled only from the manager's own number. A No never asks for it, and an amount never comes from the model. |

- **Touches:** two new case files per app, two additive helpers in
  `cases.ts`, and one live test file per app. No source file outside the
  replay pack.

### Step 1: the sf-b6 reply that ended on "I can prepare:" — `REPLY_CUT_CHECK_ENABLED`

**The cause, confirmed from `chat_traces`** (Bubbles production, the
4 Nov 2026 19:45 UTC turn):

- **The model finished normally.** The trace row has `stop_reason: end_turn`,
  617 of 2,048 output tokens, `claude-sonnet-5`, with `form_in_progress: true`.
  Nothing was truncated, so `truncation.ts` correctly had nothing to catch.
- **Code added the last line.** `server-ask.ts` (~1185 / ~1218) adds
  `formOpportunityLead()` (`forms/form-opportunity.ts:303`, "Based on what
  you've described, I can prepare:") after the model's text whenever
  `suggestedFormsFor` returns a form selection. The stored message has
  `metadata.formSelection` (Corrective Action + Coaching).
- **The guard that should remove it didn't fire.**
  `OPEN_FORM_NO_SELECTION_ENABLED` (on in production) strips the selection
  and its lead only when `parsed.activeFormInstanceId` is set (`route.ts`
  ~789). On this turn no instance existed yet: the CA was a proposal card in
  progress (`continueProposalTemplateKey`, which is what made the trace's
  `form_in_progress` true). So the reply kept a form picker heading for the
  form the manager was already making, under an answer about adding a detail.
- **It is not a one-off.** The same ending is on at least 9 earlier Bubbles
  replies (26 Oct and 2 Nov).
- **Sunny has the same code:** `form-opportunity.ts:303`, the same guard on
  `activeFormInstanceId` only (`route.ts` ~772). It is fixed the same way.

**The cross-chat guard theory in the first draft was wrong.** That guard did
not run on this reply's text. Its "." sentence split is a latent risk only, is
not fixed here, and is listed under Risks.

**The fix, behind one flag, in both apps:**

1. **No picker while a form is in progress.** The no-selection rule applies
   while a form is in progress, not only once an instance exists. "In
   progress" is the same expression `server-ask.ts` already uses for the
   trace: `continueProposalTemplateKey || openForm || activeFormInstanceId`.
   The selection is dropped, and its lead is removed by
   `formOpportunityLead()`'s own text, not a new phrase.
2. **Last-chance check, after every reply rewrite in `route.ts`.** A reply
   whose last line is a heading ending in ":" with nothing under it, and no
   `formSelection` or proposal card to show, has that line removed. The trace
   records it as `reply_cut_fixed`.

The remove-only check in (2) cannot change a reply that is already complete.
The flag-off test proves nothing changes with the flag unset.

**Touches** (both apps):

- `route.ts`: one guarded block next to `OPEN_FORM_NO_SELECTION`.
- `chat-quality-flags.ts`: the flag, with its comment.
- A new `src/lib/chat/reply-ends.ts`.
- A new `reply-cut-check-flags-off.test.ts`.

Nothing protected is touched. `server-ask.ts` is not changed: it already
exposes the in-progress inputs on the request.

Three related issues were also found; they are listed under "Found, not
fixed" below and are not part of Step 1.

**Tests:** sf-b6-reply moves from `open` to `fixFlags:
["REPLY_CUT_CHECK_ENABLED"]` in both apps. A regression test uses the
manager's exact sf-b6 wording, with the name replaced; it is shown failing
before the fix and passing after.

### Step 2: the form record — `FORM_RECORD_ENABLED`

A new `src/lib/ai/form-record.ts` holds a zod schema, versioned (`v: 1`):

```ts
FormRecord = {
  v: 1,
  formType: TemplateKey | null,        // dpoa | coaching | follow-up-coaching | policy-review | …
  typeSetBy: "manager" | "model" | null,
  subject: { kind: "employee", employeeId, name } | { kind: "team" } | null,
  storeId: string | null,              // salonId in Sunny (config name only)
  instanceId: string | null,           // the form_instances row once one exists
  templateVersionId: string | null,    // the pinned version the field keys come from
  fields: Record<fieldKey, { value?: string; checked?: string[] }>,
  step: "gathering" | "drafting" | "editing" | "finalized",
  sourceNotes: { turn: number; text: string }[],   // pasted forms, never copied into fields
  updatedTurn: number,
}
```

**Where it is stored, with no schema change.** `chat_conversations` has no
data column, so the record goes in the existing `chat_form_state` row
(one per `user_id` + `conversation_id`, in both apps). It is saved under the
`state.formRecord` key of the existing `state jsonb` column.

- The column is shared: Sunny's live `intent-extraction` already writes
  `state`. So the store does a read-merge-write that never overwrites other
  keys, and it is tested for that.
- **This is a decision for you**, because you said "the existing chat row's
  data". The other option is `chat_messages.metadata` on each assistant
  message, which gives one copy per turn and needs a "latest wins" read. I
  recommend `chat_form_state`.

**The pinned template version decides the keys.** `templateVersionId` is
the form's own pinned version (`form_instances` → `form_template_versions`),
never "the newest".

- A draft on an older Corrective Action version keeps that version's keys,
  boxes and missing-fields list, and the record never converts it.
- Conversion happens only where #424/#512 already do it: "Edit as new draft"
  opening a revision on the newer version. The record then follows the new
  instance's pinned version.
- Saved forms and PDFs are never rewritten.
- Before an instance exists, the record uses the version
  `form_template_current` would pin at creation, and re-reads it when the
  instance is created.

**`fields` is never a second copy.** Once an instance exists, the record's
`fields` are refreshed from the reread that `writeFormEdits` already does after
each save. Before an instance exists, `fields` holds the gathered values.

**Sending it to the model.** `form-record-block.ts` renders the record plus a
**missing fields** list as a data block appended to the turn. The missing list
is computed by code: required fields and groups of the pinned version and
variant that have no value or checked entry. It reuses `fieldsForVariant`,
`checkboxGroupsForVariant` and `responsibility`. No prompt text changes.

**In this step, shadow only.** With the flag on, the record is built after
each turn from what today's path did: the instance, its values, the proposal
card's slots. It is saved and logged to the trace. It does not change any
reply and is not sent to the model yet.

- **Touches:** new `form-record.ts`, `form-record-store.ts`,
  `form-record-block.ts` and tests; `route.ts` gets one guarded call after the
  turn. Nothing else.

### Step 3: the main call on the AI SDK — `ROUTER_MAIN_CALL_ENABLED`

A new `src/lib/ai/router-call.ts` makes the turn's single call with
`generateText`.

- **Same model and budgets as today:** `CLAUDE_MODEL` (Sonnet in Bubbles, Opus
  in Sunny, from config) and the quick/standard/detailed `max_tokens`.
- **Same prompt:** the same `buildSystemPrompt` output, the same context blocks
  in the same order (`QUESTION` last), and the same history window.
- **Thinking and caching:** adaptive thinking and effort go through
  `providerOptions.anthropic`. The prompt-cache breakpoints go on the static
  system block and the manual block (`providerOptions.anthropic.cacheControl`),
  matching `claudeSystemPayload` / `prompt-cache.ts`.
- **Retries and timeout:** `maxRetries: 0` (Sunny's `MODEL_RETRY_ENABLED`
  behaviour is reproduced only if that flag is on), with an `AbortSignal`
  under the route's 120 s.
- **Accounting:** usage goes to the spend meter and `noteModelCall` / chat
  trace, as `form-patch-call.ts` already does.
- **Truncation:** checked on `finishReason` with the same allow-list as step 1:
  `length` retries once via `withTruncationRetry`, and `other`/`unknown`
  counts as not finished.

The way in is additive. `answerQuestion` in `server-ask.ts` gets an optional
`call` parameter, defaulting to `callClaude`. All retrieval, grounding and
citation work stays where it is, and only the transport changes. `server-ask.ts`
must keep zero `process.env` reads; the flag is read in `route.ts` via
`chat-quality-flags.ts`.

In this step the call offers **no tools**: it is a parity step. The flags-off
test proves nothing changes, and a flag-on test proves the same answer path,
citations and guards run on the SDK's result.

- **Touches:** new `router-call.ts`; `server-ask.ts` (one optional parameter);
  `route.ts` (choose the caller); `truncation.ts` (a `finishReason` adapter).
  `call-claude.ts` is unchanged and stays the default.

### Step 4: tools, and an explicitly typed form type wins — `ROUTER_TOOLS_ENABLED`

The same single call now offers five tools, defined with zod. **No tool has
`execute`**, so the SDK runs one step and hands the calls back to code:

| Tool | Input | Code does |
|---|---|---|
| `answer` | `{ text }` | The reply. Plain text with no tool call is treated as `answer`. |
| `start_form` | `{ type }` (template keys from the library) | Sets `formType` (unless the manager typed one), `step: "gathering"`. |
| `edit_form` | `editFormSchema(keys of the open form)`, approved description as written | Hands the ops to step 5's apply function. |
| `finalize_draft` | `{}` | Moves `drafting` → `editing` after the draft is saved (step 5). |
| `ask_one_question` | `{ field, question }` | Asks one question about one missing field; the reply is the question. |

- **No extra model calls.** With this flag on, the form readers are not
  called for that turn:
  - `reader/read.ts`
  - `intent-extraction`
  - `form-tool-understand`
  - `form-full-remap`
  - the `chat-revision` model call
  - `form-patch-call`

  Bubbles' second `callClaude` fallback in `server-ask.ts` is also not called.
  Every "Updated"/"Draft ready" reply is written by code from the save result.
- **Retrieval helpers not covered.** The query rewrite, recall and long-context
  summary are retrieval, not form, and are left alone. Whether "no extra model
  calls" should cover them too is **a question for you**.

**An explicitly typed form type wins** (`explicit-form-type.ts`):

- Before the call, code matches the latest manager message against each
  template's **own names and key from the form library**: title, key, and the
  existing `CA_SHORTHAND`/`canonicalShorthand` in `template-intent.ts` (reused,
  not copied).
- On a match, `formType` is set with `typeSetBy: "manager"` and sent in the
  record.
- If the model's `start_form` names a different type, code keeps the
  manager's, records the disagreement in the trace, and does not ask.

**Thinking and `tool_choice`.** Extended/adaptive thinking allows only
`tool_choice: auto` (forcing a tool is rejected with thinking on). So
`toolChoice` stays `auto`, and "plain text = answer" is how a turn always
resolves to exactly one action.

Two decisions this step needs:

- **Tool descriptions.** The four new tools need short descriptions. They are
  new text, not edits to existing prompts, so **I'll bring the wording to you
  for approval** the same way the `edit_form` wording was approved.
- **More than one tool call in one turn.** Only the first is acted on. An
  `edit_form` beside an `answer` uses the code-written reply.

- **Touches:** new `router-tools.ts`, `explicit-form-type.ts` and
  `router-turn.ts` (maps a tool call to an action); `route.ts` (one guarded
  branch before today's chain; the chain is unchanged when the flag is off).

### Step 5: one apply function, the only writer — `FORM_OPS_APPLY_ENABLED`

A new `src/lib/forms/apply-form-ops.ts` exposes
`applyFormOps(record, ops, turnContext)`:

1. Validates every op against the **real field keys** of the pinned version.
   An unknown key fails the whole call.
2. Runs step 6's checks.
3. Calls `writeFormEdits` (the existing single writer: one patch, all or
   nothing, reread and diff).
4. Updates the record's `fields` and `step` from the reread and saves the
   record.
5. Returns `{ saved, changed: diff }`.

**Replies come from the result, never from the model:**

- `saved && changed.length > 0` → `"Updated: <label>: <value> …"` (the existing
  `form-edit-tool.ts` format).
- `saved && changed.length === 0` → the existing `nothingChangedAnswer()`.
- Save refused or failed → says nothing was changed and why, with the existing
  wording.
- "Draft ready" only after `finalize_draft`'s save succeeded with a non-empty
  diff.

**Replacing the three writers named in the brief, without editing them:**

- **`chat-revision`** is a PROTECTED file (`flags-off-parity.test.ts`). With the
  flag on, the route sends the edit to `applyFormOps` instead of calling it.
  The file itself is not touched.
- **The draft route** (`app/api/forms/instances/[id]/draft/route.ts`) keeps
  its own model call, because it is a separate request the card makes and not
  a chat turn. With the flag on, its final write goes through `applyFormOps`
  in place of `reduceDraftWrite`/`applyAssistantDraft`, under one guarded
  branch. The JSON it returns is unchanged, so there is no UI change.
- **The patch reducer** (`form-patch-turn.ts`) is not reached when the router
  is on. It is retired in step 7.

The other writers (`chat-correction`, `chat-policy-change`, same-form copy,
`chat-redraft`, Sunny `chat-reopen`) are not reached on the router path. Each
is retired by its own flag in step 7. Card Save
(`PATCH /api/forms/instances/[id]`) and `createInstance` stay as they are: they
are the manager's own UI save and the system seed, not chat writers.

**The rules the template changes rely on keep applying.** `applyFormOps`
goes through `writeFormEdits` → `applyPatch` and today's write guards
unchanged. So the following still hold exactly as their own tracks define
them:

- the two-sentence action plan (`ACTION_PLAN_SENTENCES_ENABLED`);
- the manager-only action plan;
- the payroll amount: asked once after Yes/No, only the manager's number
  (Bubbles `PAYROLL_DEDUCT_AMOUNT_ENABLED`; Sunny `PAYROLL_AMOUNT_FIELD_ENABLED`
  + `MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED`);
- the offense-box mapping;
- the `CA_SALES_POLICY` sales/MSB citation.

`ask_one_question` takes its next question from the missing-fields list in
the pinned version's field order, so the payroll amount comes right after
payroll Yes/No and only when Yes.

- **Touches:** new `apply-form-ops.ts`; `route.ts` / `router-turn.ts`; the
  draft route (one guarded branch at the write). `form-write.ts` is reused
  unchanged.

### Step 6: checks before anything is saved — `FORM_OPS_CHECKS_ENABLED`

Inside `applyFormOps`, before `writeFormEdits`. A failed check refuses that op,
and the reply says what was not saved.

1. **Policy citation from this turn's manual sections.** Any value that names
   a policy section, or goes into a `policyGrounded` field, must match a heading
   and page **in the manual chunks retrieved for this turn** (the `manualPlan`
   the answer path already built).
   - It reuses `refuseUnverifiedPolicyValues` (`policy-grounding.ts`) and, in
     Sunny, `citation-verify.ts`.
   - Bubbles' `policy-from-manual/verify.ts` ("nothing imports this yet") is
     the shared mechanism to bring into both apps, so the check is the same
     code in both.
   - `policy-citation.ts` is protected and is only read.
   - A sales or must-see-behaviours CA's Standards of Conduct citation is
     produced by the `CA_SALES_POLICY` track. This check only verifies that
     its heading and page were retrieved that turn; it never picks or changes
     the policy.
2. **Quoting the manager.** Text put in quotation marks or attributed to the
   manager in a field value must appear verbatim in the manager's own messages
   in this chat, not in assistant turns and not in `sourceNotes`.
   - This is checked structurally (quoted spans against the manager's text),
     not with a list of phrases.
   - The existing `copies_message` refusal in `form-reducer.ts` stays.
3. **A pasted form goes to `sourceNotes`.** A manager message counts as a
   pasted form when it contains several of the open (or named) template's
   **own field labels** from the pinned version (structural, no phrase list).
   That message is saved to `sourceNotes` with its turn number. Any op whose
   value is copied from it is refused. The model sees `sourceNotes` in the
   record and may only use it to ask about, or have the manager confirm, a
   value.

- **Touches:** new `form-ops-checks.ts`; `apply-form-ops.ts`; Bubbles
  `policy-from-manual/*` brought into Sunny (port, one commit).

### Step 7: retire the old paths one at a time — one flag each, `ROUTER_RETIRES_<PATH>_ENABLED`

Each retirement is its own pull request with its own flag, default off. A
retired path is skipped only when both the router flags and that path's flag
are on, and the code stays in place. QA flips a retirement only after
**every replay case that touches that path passes** with production flags +
the router flags + that flag. The case list is written in the PR body.

The order goes from least to most live:

1. `form-patch-turn` / `form-patch-call` (off in production today)
2. `form-tool-understand` / `form-tool-route` (off)
3. `form-full-remap` (off)
4. `chat-redraft`
5. same-form copy
6. `chat-policy-change`
7. `chat-correction` + `ca-chat-corrections`
8. `chat-revision` routing (the route stops calling it; the file is never edited)
9. `reader/read.ts` (on in Bubbles)
10. `intent-extraction` (on in Sunny)
11. the step/type readers (`slot-only-turn`, `new-request-turns`, `form-type-switch`, `form-opportunity`)
12. the store/salon readers
13. the person readers (last, because they are the most used)

- **Touches:** one guarded `if` at each call site in `route.ts` /
  `server-ask.ts` / `grounded-turn.ts`. No reader file is deleted while its
  flag exists.

---

## Compatibility with the approved template changes (both apps)

These are built in other sessions (Corrective Action revision: Bubbles #424
as revision 7, Sunny #512 as revision 8; the `CA_SALES_POLICY_ENABLED`
track). This plan **does not build, copy or change any of it**. It only reads
what they produce.

| Approved change | How this plan stays compatible | Replay case |
|---|---|---|
| New CA version: Type of Offense = Attendance Policy / Standards of Conduct / Dress Code Violation / Other; Absenteeism removed | Field and box keys always come from the form's **pinned** version (`fieldsForVariant` / `checkboxGroupsForVariant`); no key is hard-coded. `edit_form`'s key enum is built from that version, so a removed box can't be set on a new form and an old draft keeps its own boxes. | tc-1, tc-4 |
| Cell Phone, Social Media, Animals stay "Standards of Conduct — <section>" | Read as-is from the existing drafting/mapping. The record stores whatever box and section the existing writers produce. | tc-2 |
| Cleaning CAs go to "Other" | Same. Not re-decided by the router. | tc-3 |
| Old drafts stay on their version; converted only when a revision lands on the newer one (#424) | The record follows `instance.template_version_id`. Conversion stays in `reviseInstance` (protected, already approved). Saved forms and PDFs are never rewritten. | tc-4, tc-5 |
| Sales/MSB CAs cite Standards of Conduct from the retrieved manual section | `CA_SALES_POLICY_ENABLED` behaviour unchanged; Step 6 only checks the citation was retrieved that turn. | tc-6 |
| Action plans are exactly two sentences | The existing guard (`ACTION_PLAN_SENTENCES_ENABLED`, on in both production lists) stays in the write path. | tc-7 |
| Payroll amount right after payroll Yes/No, asked once when Yes, only the manager's number | The existing payroll flags stay in the write path. `ask_one_question` follows the pinned field order; amount ops are refused unless the number is in the manager's own message (Step 6 check 2). | tc-8 |

**Different version numbers per app** (Bubbles revision 7, Sunny revision 8):
nothing in this plan names a revision number. It only ever reads "this form's
pinned version".

## Draft tool wording (for approval; not used until approved)

These are new text; no existing prompt changes. `edit_form` keeps its
approved wording exactly.

- **`answer`**: "Reply to the manager in the chat. Use this when the latest message asks a question or needs an answer, and no change to the open form was asked for. Do not describe a form change here; form changes are made only with edit_form."
- **`start_form`**: "Start a new HR form in this chat. Use this only when the manager asks for a form and no form of that type for that person is open. Give the form type from the list provided. If the manager typed the form type, that type is used whatever you choose."
- **`finalize_draft`**: "Mark the open form's draft as ready for the manager to review. Use this only when the missing-fields list provided with this message is empty and the manager has asked for the draft. Do not say the draft is ready in text; the app says so after it is saved."
- **`ask_one_question`**: "Ask the manager one question about one field on the missing-fields list provided with this message. Name the field key and write one short question. Never ask about a field that already has a value, and never ask two things at once."

## Protected files (not edited by any step)

From the `PROTECTED` list in `src/lib/ai/flags-off-parity.test.ts` (an empty
`git diff` is enforced):

- `src/lib/ai/`:
  - `form-proposal.ts`
  - `violation-policy.ts`
  - `prior-coaching-optional.ts`
  - `glossary.ts`
  - `form-field-state.ts`
  - `chat-data-plan.ts`
- `src/lib/forms/`:
  - `location-scope.ts`
  - `proposal.ts`
  - `form-date-answer.ts`
  - `payroll-deduct.ts`
  - `ca-action-plan.ts`
  - `required-closing.ts`
  - `chat-revision.ts`
  - `revision.ts`
  - `policy-citation.ts`
  - `instances.ts`
- Sunny also: `salon-mention.ts`, `salon-text.ts`.
- Also `payroll-deduct-answer.ts` (`default-on.ts`).

Also left alone:

- Approved and pinned wording: `EDIT_FORM_TOOL_DESCRIPTION` (used as written),
  `CHAT_GLOSSARY`, `prompts.ts` and its fixtures, `phase-2a-wording`, and
  `guest-terminology`.
- `production-flags.json`: QA only.
- `supabase/migrations/*`: there is no migration.
- `.github/workflows/*`.
- UI files outside the parity allow-list.

`server-ask.ts` gets one optional parameter (step 3) and no `process.env`
read. `instances.ts` is only called, through `writeFormEdits`.

## Risks

1. **AI SDK parity of the request.**
   - `@ai-sdk/anthropic` 3.0.138 must send adaptive thinking, `effort`
     (`output_config`) and cache breakpoints exactly as the raw SDK does.
   - If it can't, step 3 stops there and reports, rather than changing the
     request.
   - The flags-off and flag-on request-body tests catch any drift.
2. **Thinking forbids a forced tool.** `toolChoice` must stay `auto`, so the
   model can always answer in plain text. Mitigation: plain text = `answer`, and
   edits only happen through `edit_form` (never inferred from the text).
3. **The shared `chat_form_state.state` column.** Sunny's live
   `intent-extraction` already writes `state`. A careless write would wipe the
   record or its data. Mitigation: merge-write under the `formRecord` key, with
   a test that both survive.
4. **The draft route is reached from the card (UI) as well as the chat.**
   Rerouting its write must keep its JSON response byte-identical.
5. **Fewer model calls also means fewer second opinions.** Turning off
   `reader/read.ts` (Bubbles) and `intent-extraction` (Sunny) removes checks the
   live path relies on today. That is why they are retired late, each behind
   its own flag, only after their replay cases pass.
6. **Models differ per app** (Sonnet in Bubbles, Opus in Sunny), and live tests
   run on Haiku. A case passing on Haiku is a floor, not proof for production
   models. QA's flip check remains the gate.
7. **Sentence-ending checks without a phrase list.** Step 1's reply-level
   check only removes a final heading line ending in ":" when no card follows.
   Its tests include replies ending in a list, a table, a citation marker and
   a heading that does have a card under it, and none of those change.
8. **Pasted-form detection by label count.** A manager who writes naturally
   but uses two or three field labels could be treated as pasting. The
   threshold comes from the template's label count, and the case where it
   wrongly fires is a test.
9. **The cross-chat guard's sentence split (latent, not observed).**
   `withoutCrossChatClaims` treats every "." as a sentence end (decimals,
   `[p.N]` markers). It did not cause sf-b6. It is left for its own reported
   case.
10. **Template changes landing in parallel.** The CA revision and the
    `CA_SALES_POLICY` track change the same CA fields. The tc-1 to tc-8 cases
    pin the agreed outcome. This plan never edits those modules, so a conflict
    can only show as a failing case, not a silent change.
11. **Other sessions running now.** Their changes to `route.ts` and
    `server-ask.ts` will conflict. Each step rebases on `main` before its
    pull request, and no other session's branch is touched.

## Time estimate (session time, both apps, per step)

| Step | Estimate |
|---|---|
| 0. Replay cases (9 sf-s, 3 sf-b6, 8 template-change) in both apps, plus the live harness | 1.5 days |
| 1. sf-b6 (cause confirmed): no picker while a form is in progress, plus the reply-end check | 0.5 day |
| 2. Form record, store, missing fields, shadow write | 1.5 days |
| 3. Main call on the AI SDK (parity, no tools) | 2 days |
| 4. Tools + explicit type | 2 days |
| 5. `applyFormOps` as the only writer, replies from the diff | 2 days |
| 6. Checks (citation, quotes, pasted forms) | 1.5 days |
| 7. Retire 13 paths, about 0.5 day each | 6 to 7 days |
| **Total** | **about 17 to 18 working days**, plus QA's flip checks between steps |

Steps 0 to 2 can merge and sit off while 3 to 6 are built. Step 7 runs one
path at a time after QA has had the router flags on in staging.

## Open questions for you

1. **The live harness.** It can't be built and run in this session (no
   Anthropic key). Should it be built in a session that has one, before QA
   switches `REPLY_CUT_CHECK_ENABLED` on?
2. **`FORM_FULL_REMAP_ENABLED` in Sunny production.** QA to confirm (see
   Progress, finding 1).
