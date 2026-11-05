# PLAN: one form record per chat, one model call per turn (Ask Sunny + Ask Bubbles)

Status: **plan only, nothing built.** The same file is on `claude/router-plan` in
both repositories. Every step is built the same way in both apps, in the same
session, as one commit per app (`Port from Ask Sunny (<sha>): …` /
`Port from Ask Bubbles (<sha>): …`). QA alone merges and flips flags.

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

### Step 0: the silent-failure cases become replay cases first (no flag)

The replay cases go in before any other code.

- **Sunny:** `src/app/api/chat/replay-pack/nov5-silent-failure-cases.ts` holds
  **sf-s21 to sf-s29**.
- **Bubbles:** the same file name holds **sf-b6**.
- Each case is ported to the sibling app wherever the mechanism reproduces
  there.

How each case is written:

- It uses the reporter's exact wording, with every real person swapped for an
  invented name that is checked against the roster
  (`no-real-people.test.ts`).
- It asserts invariants, never model wording:
  - `noClaimWithoutUpdate`
  - `replyMatchesDiff`
  - `savedForm`
  - a new `endsAsSentence` (the reply does not stop mid-sentence)
- Each case starts as `status: { open: "…" }`, so it runs as `it.fails` and
  CI flags the day it starts passing.
- A later step sets `fixFlags: [...]` on the cases it is meant to fix.

New: `src/lib/ai/router-live.test.ts`. It is skipped unless `ROUTER_LIVE=1`,
and runs the same cases against Haiku with `maxRetries: 0`.

- **Touches:** two new case files per app, one helper in `cases.ts`
  (`endsAsSentence`, additive), one live test file per app.
- **Blocker:** none of sf-s21 to sf-s29 or sf-b6 are in either repo. The
  repos only hold sf-s1 to sf-s20 and sf-b1 to sf-b5. **I need the transcripts
  for today's ten cases** (QA's scan, or the sessions running now).

### Step 1: why the Bubbles reply stopped mid-sentence (sf-b6) — `REPLY_CUT_CHECK_ENABLED`

Why `truncation.ts` did not catch it: it checks only
`stop_reason === "max_tokens"` on the model's response. The likeliest cause is
code that runs **after** the model call, where no stop reason exists. Ranked
by evidence:

1. **The cross-chat guard splits at a full stop that does not end a sentence
   (most likely).**
   - `withoutCrossChatClaims` (`src/lib/chat/cross-chat-guard.ts`;
     `CROSS_CHAT_REPLY_GUARD` is assumed on) splits a line into "sentences"
     with `SENTENCE = /[^.!?\n]+(?:[.!?]+…|$)\s*/g`.
   - That regex treats every `.` as a sentence end, including:
     - the `.` inside `[p.12]` page markers
     - decimals ("$10.25")
     - "a.m."
     - "e.g."
   - When a later fragment reads as "you told me … in another chat", the guard
     deletes it, and the kept text ends at `…policy [p` or `…was $10.`.
   - **Why Bubbles is hit harder:** in Bubbles the guard runs **after**
     `citePolicyAnswer` has inserted `[p.N]` markers (`server-ask.ts` ~1211 →
     1229). Sunny runs it on the raw model text, before its citation step.
   - The same decimal bug was fixed for `forms/incident-issue.ts` behind
     `DECIMAL_NOT_SENTENCE_END_ENABLED`. That fix never reached this guard.
2. **`honestFormReply`** (`forms/form-content-turn.ts`) drops whole lines that
   claim a form change. It can leave a lead-in like "Here's what I changed:"
   with nothing after it.
3. **`withoutSpeakersManagerTitle`** (`reply-guards.ts`) deletes from
   `**Position:**` to the end of the line.
4. **Another stop reason.** A `stop_reason` other than `max_tokens`, such as
   `model_context_window_exceeded` with the full manual on Sonnet, is returned
   as a full answer.

How to confirm which cause it was:

- the `chat_traces` row for that turn (`stopReason`), and
- the `noteCrossChatRemoval` log line for that turn.

Found while reading, Sunny only:

- `collectModelResult` returns partial text when a stream ends without a
  `message_delta` (`stopReason` stays `null`).
- Sunny's `chat-revision` model call is not wrapped in `withTruncationRetry`.

The fix, behind one flag:

- **Sentence split.** The cross-chat guard's split does not end a sentence
  inside a marker, a decimal or an abbreviation. It shares one sentence
  splitter with `incident-issue.ts`'s fixed version.
- **Stop reasons.** Truncation uses an allow-list, not a deny-list: only
  `end_turn`, `tool_use` and `stop_sequence` count as finished, and a `null`
  stop reason counts as cut off.
- **Last-chance check.** A reply-level check runs after every rewrite. A reply
  that ended mid-sentence before a guard ran must still end as a sentence after
  it; otherwise the guard's cut is undone (the original reply is kept) and the
  trace logs it.

- **Touches:** `cross-chat-guard.ts`, `truncation.ts` (add `isFinished(stopReason)`;
  existing exports unchanged), Sunny `call-claude.ts` `collectModelResult`,
  `route.ts` (one guarded call after the rewrites), and a new `sentence-split.ts`.
  `incident-issue.ts` is read, not changed.
- **Tests:** sf-b6 (and the Sunny mirror) moves from `open` to `fixFlags`.

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
   check must not flag replies that end with a list, a table or a citation
   marker. Its tests include those shapes.
8. **Pasted-form detection by label count.** A manager who writes naturally
   but uses two or three field labels could be treated as pasting. The
   threshold comes from the template's label count, and the case where it
   wrongly fires is a test.
9. **Cases not in the repo yet.** Step 0 can't start until the transcripts for
   sf-s21 to sf-s29 and sf-b6 are supplied.
10. **Other sessions running now.** Their changes to `route.ts` and
    `server-ask.ts` will conflict. Each step rebases on `main` before its
    pull request, and no other session's branch is touched.

## Time estimate (session time, both apps, per step)

| Step | Estimate |
|---|---|
| 0. Replay cases sf-s21 to sf-s29 and sf-b6, plus the Haiku live harness | 1 day, once transcripts are in |
| 1. sf-b6: confirm the cause from the trace, fix the split and stop-reason checks | 1 day |
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

1. **Storage.** Is `chat_form_state.state.formRecord` acceptable as "the chat
   row's data"? The alternative is `chat_messages.metadata` per turn.
2. **Model calls.** Does "no extra model calls" also cover the retrieval
   helpers (query rewrite, recall, long-context summary), or only the form
   readers?
3. **Transcripts.** Please send the transcripts or report for sf-s21 to sf-s29
   and sf-b6.
4. **Tool descriptions.** Do you want to approve the four new tool
   descriptions before step 4 starts?
