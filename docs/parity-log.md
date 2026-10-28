# Parity log: Ask Sunny ↔ Ask Bubbles

## 26 Oct 2026: FOLLOW_UP_NOT_PRIOR_ENABLED — Sunny-only

QA Sunny tester batch 13 (S16, S19): a prior action's date was also printed
as a "**Follow-up:**" card line (`form-card-slots.ts` `followUpDates` counts
every date that is not an incident date). With the flag on, a date the
earlier-step reader lists is never a Follow-up line. Ask Bubbles' card has no
Follow-up lines (`enrichFormCard` does not run on its grounded path), so there
is nothing to port.

## 25 Oct 2026: two unflagged full-remap changes in integration bundle 2 — same in both apps

Neither is behind its own flag, and neither changes production today: both
run only on the full-remap path, and `FORM_FULL_REMAP_ENABLED` is off in Ask
Sunny's production. They come from Ask Bubbles (stray quote from its replay
fixes, and #143's proposal ids), where they already run.
- `remap-incident.ts` (PR 213): `HAS_WORD` — a stray quote or other
  punctuation-only text is never an incident; it reads as none (null).
- `form-full-remap.ts` `proposalFor` (PR 215): each remap card's
  `proposalId` is `randomUUID()` instead of the shared `"form-remap"`, and an
  observation with no letter or digit is null. When the remap is switched on
  this is the P0 fix (a new chat never gets another chat's draft).

## 25 Oct 2026: a follow-up that names its own documents is searched on them — ported to Ask Bubbles

`FOLLOWUP_NEW_TOPIC_RETRIEVAL_ENABLED` defaults off, same name in both apps.
QA Round 17, conv_mvo0ayai2x20aiy: after "I have an employee that is not
verifying documents are signed", "The NCR and Fitzpatrick Skin Type Chart,
EFT Agreements" was searched as "Employment Verification" (the manual-terms
rewrite read the earlier turn), so Consent Forms (p.49, the skin typing
chart) was not retrieved. On, a turn that names two or more words no earlier
manager turn used keeps a rewritten query only when the rewrite still has
one of them; otherwise it is searched on its own words (glossary-expanded).
Ask Bubbles gets the same check after `rewriteRetrievalQuery`.

## 25 Oct 2026: FRAMEWORK_UNPIN_ENABLED — Ask Bubbles only

Ask Bubbles' new default-off `FRAMEWORK_UNPIN_ENABLED` stops its forms draft
route from pinning the Performance Management Framework's sections into a
governed form's prompt. Its uploaded framework was prepared from this app's
framework with only the app name changed, so it still carries this
company's name, examples and metrics. Not ported: this app's framework is
this company's own text, so pinning it here is correct and the same draft
route stays as it is. No code change in this app.

## 24 Oct 2026: the app's own lines are not the manager's words — ported to Ask Bubbles

`MANAGER_WORDS_ONLY_ENABLED` defaults off. Form state, intake augmentation
and grounded entities write lines such as "Job title: CA. It happened at KS
Lawrence." onto the question. On, the card's Job title reads each of those
sentences alone (no more "CA. It happened"), the Observation of Offense skips
lines made only of those sentences and a sentence that only says where the
employee works, and the intent reader keeps a model title only when it is a
known title or a short noun phrase the manager typed: not the form ("CA"),
the employee's own name ("test"), a clause ("test was late opening salon"),
or letters inside another word ("HR"). "ass't salon director" reads ASD, and
a pasted policy is not read for the title.

**Sibling app: ported** on Ask Bubbles branch
`claude/new-session-vowi84-it-happened`, through its live form-full-remap path
and its intent path.

## 24 Oct 2026: a manual citation marks the page the sentence restates — ported from Ask Bubbles

`FULL_MANUAL_CONTEXT_ENABLED` stays off. The loader reads
`metadata.sections`, so each heading in a chunk takes the page ingestion
recorded for it: Facial Hair and Make-up 16, Point of Sale and Alarm
Passwords 20 (the uploaded PDF). The answer pass reads one sentence or
bullet at a time. It removes every `[p.N]` and writes back only the page
whose text the sentence restates; a model page stays when its text still
matches. In a "<section>, JBA Policy Manual p.N" label only the page
number changes, to the page that section is printed on, with one marker
after it. A section on several pages keeps the model's page when it is one
of them. An unknown section, another manual's page, a Buff City Soap or
Crunch sentence, and "see page 99" stay as written with no marker. No other
word, line break or bullet changes. This replaces f44631a's rewrite, which
cut words at commas.

**Sibling app: ported from** Glowbrands1/Ask-bubbles#101 (6ed0630, the
per-sentence marker pass). Sunny's label rule has no Bubbles counterpart,
because Bubbles' model writes `[p.N]` only. No Buff City Soap wording was
copied.

## 24 Oct 2026: a policy quote is not the manager's payroll answer — ported from Ask Bubbles

`INTENT_PAYROLL_MANAGER_ONLY_ENABLED` is new and stays off. With it on,
the intent read takes the payroll amount and the Yes/No from the manager's
turns only. In Ask Bubbles (conv_mvmf4x1i2qxha7u) the manager said "verbal,
no payroll", but the saved state had payroll amount 25 and Yes, taken from
the assistant's quote of the Late Opening policy. This app's `mergeSlots`
had the same rule. "no payroll" now saves No with no amount.

**Sibling app: ported from** Glowbrands1/Ask-bubbles#101 (d2ac87a). The
test keeps the manager's words and uses this app's salon and Form
Monitoring names.

## 24 Oct 2026: one extraction fills the form — ported from Ask Bubbles

`FORM_FULL_REMAP_ENABLED` stays off. On, each turn reads every user message
in this conversation only, then merges that read with the slots already
saved for the same conversation id. A later value replaces a field. A blank
read does not erase one. A discipline word (`verbal`, `written`, a warning)
selects the Corrective Action Form when the manager did not name a form.
"Create a Coaching Form" stays the Coaching Form. "CA" is the Corrective
Action Form. A bare "10-20" is 20 October, not a time. "prior = manual ack
9/01" is the prior action, not the form date, and that line is kept once
even when this turn is already in the history. "at Grand Island out of dress
code" names that salon when there is no comma before "out". A turn that only
names the form is not the incident. The card shows the date, time, type of
warning, prior action, payroll answer, and what happened.

Sunny salons in the replay tests: NE Kearney (`loc-0309`) and NE Grand Island
(`loc-0307`). A later salon edit in the unit test uses KS Lawrence
(`loc-0468`).

**Sibling app: already present.** Ask Bubbles PR 97, merged as `ee6b026`.
This is that mechanism. No Buff City Soap store names were copied.

## 24 Oct 2026: inline printed-page citations — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No ingest change
and no merge. `FULL_MANUAL_CONTEXT_ENABLED` still defaults off. Off, the
prompt, retrieval, and `[S#]` sources are unchanged.

- A policy answer cites `<section>, <manual title> p.<n> [p.n]`. The
  Sources row uses that section as the excerpt and `Page n` as the locator.
  The printed footer (`41 | P a g e`) wins over `metadata.printedPage`
  when that field still holds the PDF sheet. PTO prints 41. Shared dress
  code prints 15, and Jewelry/Accessories and Tattoos print 16. Sun Tan
  City's own Shirts, Pants, and Tanning print 17 and a Sunny answer must
  cite that page for them. Cell Phone/Smart Watch prints 19. Crunch and
  Buff City Soap sections are not cited. Crunch Shirts and Pants print
  16, so a p.17 cite of them is dropped.
- Rewriting that citation inserts the section heading as the label and
  keeps the sentence in front of it. Neither side is trimmed.
  `Director. (Eligibility` stays whole, including a heading glued on
  (`DirEligibility`).
- After the answer, a page or an `[S#]` marker that is not in the loaded
  manual is removed. A heading cited on the wrong page is moved to the
  printed page that heading is on. A DM manual, a Salon Director manual,
  Buff City Soap, and Crunch are not sources.
- With the manual loaded, topic pins and retrieved chunks are not added
  back as `[S#]` policy sources.

## 24 Oct 2026: contents pages, printed pages, chunk overlap — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No ingest change
and no merge. `FULL_MANUAL_CONTEXT_ENABLED` still defaults off.

- PDF sheets 3–6 (`section` "Table of Contents", then a null section)
  stay out of the cached manual block, so a contents line cannot be
  cited. Reference List on sheet 7, which prints 6, stays.
- `[p.n]` and the citation page are the printed page: the `N | P a g e`
  footer on that sheet, else `metadata.printedPage`, else the PDF sheet.
  The footer wins when `metadata.printedPage` still holds the PDF sheet
  (PTO is sheet 42 and prints 41; dress code is sheet 16 and prints 15).
  Cell Phone/Smart Watch is sheet 20 and prints 19. The cover has no
  printed page and is not shifted.
- Consecutive chunks are joined in `chunk_index` order after the
  leading overlap is removed, so a section is not repeated or cut at
  the chunk boundary.

## 24 Oct 2026: full manual in the policy prompt — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No ingest change
and no merge.

- `FULL_MANUAL_CONTEXT_ENABLED` defaults off. Off, a policy question is
  still answered from retrieved chunks.
- On, a policy question loads the current JBA Policy Manual (`status`
  indexed, `superseded_by` null) and sends it as a cached system block.
  Ask Sunny is Sun Tan City only. The block keeps shared JBA policy and
  Sun Tan City sections. Buff City Soap, Crunch, the JBA office, and any
  other brand's policy manual stay out. A missing or oversized manual
  keeps retrieval.
- Citations are `<section>, <manual title> p.<n>`. A page or heading that
  is not in that manual is dropped or corrected. A source marker past the
  sources in hand, such as [S11] when eight sources were retrieved, is
  removed.
- `chat_traces.e2e_latency_ms` is request received until the last token.
  `latency_ms` stays the model call. `cache_read_input_tokens` is the
  existing column.

## 24 Oct 2026: manual heading scan, W-2 note, PTO accrual — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No model call, no
migration, and no merge. The heading pin itself landed in #162.

- `MANUAL_TOPIC_PIN_ENABLED` stays off by default. Off, a score at the
  similarity floor still returns immediately, and no topic note is added.
- On, a policy question whose top results contain no current JBA Policy
  Manual chunk falls through that return into the heading scan. A window
  that already holds the manual does not scan.
- On, a pinned time off, W-2 or direct deposit section gets the same
  manual note a question that names the manual already gets, so the
  answer is not "I don't have that" while the section is in the sources.
- Time off, sick and PTO also pin Eligibility and Provisions. The accrual
  chunk that follows those headings is kept. A form or a corrective
  action does not take these pins.

## 24 Oct 2026: pin time off, W-2 and direct deposit by manual heading — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No model call, no
migration, and no merge.

- `MANUAL_TOPIC_PIN_ENABLED` defaults off. Off, a question is searched and
  ordered as it is today: the topic map is not added to the corrective-action
  synonyms. On, time off, request off, sick days, W-2 and direct deposit pin
  the official manual's PTO, Usage, Schedule Requests, Accessing W-2's and
  Pay Periods sections by heading. The Schedule Requests heading is read
  from the chunk's own lines, including the chunk labelled Time Records.
  Other retrieved chunks stay.

## 24 Oct 2026: chat_traces_live cache columns stay at the end — Sunny-only

Ask Bubbles was not attached. Port the mechanism if Bubbles replaces
`chat_traces_live` the same way. Do not copy company wording. The manual
title stays **JBA Policy Manual**. No production migration apply and no merge.

- `create or replace view` cannot insert columns in the middle. The three
  cache columns are listed after `slots`. Both unapplied replaces, slots
  and cache, set `security_invoker = true`, because a replace without WITH
  clears the option production already has. There is still no row filter.
  Grants stay service_role select. Both replaces revoke all from
  service_role before that grant, and revoke anon and authenticated.
  Production recorded `chat_traces` as version `20261024004307`, so these
  files are applied with `apply_migration`, not `db push`.

## 24 Oct 2026: prompt reorder stays behind the cache flag — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production
migration apply and no merge.

- With `PROMPT_CACHE_ENABLED` off, `buildSystemPrompt` is main's prompt:
  the manager line stays in the opening sentence, the data sections stay
  before TONE, and `---DYNAMIC---` is not sent. The reorder and the marker
  run only when that flag is on. The proof is a frozen copy of main's
  return template (`b9ae362`), because CI checks out only the pull request
  tip. A missing `chat_traces` cache column logs a warning instead of
  dropping the insert with no record.
- `f4b2616..eb18de7` touches 4 files: `docs/parity-log.md`,
  `docs/scoreboard.md`, `src/lib/ai/prompts-main-b9ae362.template.txt`,
  and `src/lib/ai/prompts.test.ts`.
- The flags-off parity child is its own Vitest project and starts after
  the unit project. It does not run a second copy of the suite beside the
  main one. That child passes `--maxWorkers=2` so it does not run the
  chat and form files at full concurrency. Timeouts stay at 5 seconds.

## 24 Oct 2026: cache columns and the dynamic prompt tail — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production
migration apply and no merge.

- `chat_traces` gains nullable `cache_creation_input_tokens`,
  `cache_read_input_tokens`, and `first_token_ms`. The slots migration is
  already applied, so this is a new additive migration. `call-claude.ts`
  writes Anthropic's usage fields and the time to the first text token.
  A finished message, which is what the tests return, leaves
  `first_token_ms` empty.
- Per-request data sits below `---DYNAMIC---`: an open form, form records,
  person memory, recalled memory, prior coaching, a pinned framework, a
  matched manual section, and few-shot examples. The standing rules above
  the marker do not carry them. The manual title is unchanged.

## 24 Oct 2026: superseded blocklist and global salon ask — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production sync
and no merge.

- While `WOVEN_KNOWLEDGE_SYNC_ENABLED` is on, a knowledge document that is
  already superseded is not re-indexed, by its document id or by the same
  file hash on a new Woven record. Off, the sync does not consult that
  blocklist. Supersession is still only an admin or manual action, or a
  newer edition of the same record. No new table.
- `GLOBAL_SALON_ASK_ENABLED` asks a global non-admin which salon once and
  still builds the draft. Ignoring the question, or answering something
  else, does not ask it again. The card stays ready and the draft can be
  created with no salon. After the salon is given, the question is not
  asked again. A salon named in the same message, an earlier turn, a short
  name, or a one-character typo is filled in and not asked. Off, the draft
  is not blocked and the question is not added.

## 24 Oct 2026: replay each case once — Sunny-only

Ask Bubbles was not attached. The local scoreboard harness now runs each
case once. Pass rules, the 20000 ms latency gate, the card criteria, the
rulebook comparison, and the prompt-cache log stay. The frozen main column
is not re-recorded. No production writes and no merge.

## 24 Oct 2026: prompt cache split — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production writes
and no merge.

- `buildSystemPrompt` keeps sections 1–11 as the static block. The manager's
  name, salon, and today follow `---DYNAMIC---`, in the same sentences.
  `PROMPT_CACHE_ENABLED` puts `cache_control: { type: "ephemeral" }` on the
  static block only. Off, the request is still one string. The local replay
  logs cache creation on the first call and a cache read on later calls.

## 24 Oct 2026: leading Location is not part of the name — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**.

- A field label in front of a real name comes off. s11 "lawrence location
  tanning consultant, corena schardt" is Corena Schardt, not "Location
  Corena Schardt". "Jane Store" still keeps the surname.

## 24 Oct 2026: Woven edition dedupe — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production sync
and no merge.

- A Woven sync groups items by file hash. The newest Woven updated date
  stays indexed. The others are marked superseded and the next scan does
  not ingest them. A document that is already superseded is not chosen,
  even when its date is later. `5c626f3c` stays superseded beside the kept
  manual `ce6b00f1`. Nothing here runs a sync against production.

## 24 Oct 2026: Name labels and a trailing Job — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production writes
and no merge.

- Label words are job, title, position, role, location, salon, and store.
  They reject a candidate only when the candidate is the label itself
  ("Job title", "Store"). A surname that is one of those words still passes
  ("Jane Store", "Jane Salon"). A trailing Job or Title comes off only after
  a full name (s17 "Larissa Venko Job"). The value after "Name:" stays the
  name ("Name: Evangeline Pembury, job title tanning consultant"). s8 still
  does not store "Job title".

## 24 Oct 2026: validation code fixes — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. No production writes
and no merge.

- Plain-language regression cases for round 1 are in
  `research/reports/full-validation-2026-10-24.md` and run in the local
  harness only. Hybrid search is not turned on. `store opened late` maps to
  Late Opening, and `policy acknowledgements` maps to Standards of Conduct.
  Drafts are listed under Not on file and are never called previous coaching.
- Corrective-action questions collapse identical JBA copies at query time
  and stay on the current manual. Other policy questions boost that manual
  and keep the rest of the retrieval behind it. A synonym map sends
  insubordination and acknowledgment to Standards of Conduct, uniform,
  slippers, and leggings to Dress Code, tardy and late to shift to
  Attendance, and opened late to Late Opening. Hybrid search is tested, not
  turned on in production.
- Before create, an open draft for the same employee, template, and incident
  is reopened.
- Drafts are listed under Not on file. Chat does not call them previous coaching.
- A global non-admin is asked for the salon once. The card is still built.
  The form is not filed with no salon. An admin global account is unchanged.


## 24 Oct 2026: Job title is not an employee name — Sunny-only

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The manual title stays **JBA Policy Manual**. Nothing was published.
Do not merge or deploy until Pau says otherwise.

- Field labels (job title, title, position, location, salon, date) are
  stripped from an employee-name candidate. The words after "job title" go
  on the Job Title slot. s8 no longer stores "Job title", and a name does
  not keep the trailing "Job" from that label.

## 24 Oct 2026: Chat data tools in the one-flag replay — Sunny-only

Ask Bubbles was not attached. No chat mechanism changed. The manual title
stays **JBA Policy Manual**. Port is not needed.

- The one-flag replay now includes `CHAT_DATA_TOOLS_ENABLED`. s22 and s23
  are scored from the verbatim turns. The flag does not break the other
  21 cases.

Ask Bubbles (`Glowbrands1/Ask-bubbles`) is a port of this app. Every fix to
chat, forms, Corrective Action, policy citation, access or sync is either
ported to the sibling or listed here as staying one-sided, with the reason.
See `CLAUDE.md`.

## 24 Oct 2026: Round 1 structural name, slot, and salon — Sunny-only

Ask Bubbles was not attached. No new chat mechanism in this round: the
name, slot, and salon behaviour is the flagged code already on this stack.
SELF_CHECK stays off. Nothing was published. The manual title stays
**JBA Policy Manual**. Port is not needed until a later change touches the
chat or form seam.

- The replay's round 1 flag set is intent extraction, grounded entities,
  draft merge, typed name proceeds, and code slots, each `=1`, with
  `SELF_CHECK_ENABLED=false`. It ran on the local harness. A round is
  kept only when it fixes at least one failing case, breaks none, stays
  within 25% of the previous round's latency, and leaks no internal text.

## 24 Oct 2026: Rulebook score, main against this branch — Sunny-only

Ask Bubbles was not attached. No chat mechanism changed in this step, and
nothing was published. The manual title stays **JBA Policy Manual**. The
guide was not pasted over the system prompt. Port is not needed until a
later change touches the chat or form seam.

- The replay scores guide v3 on two columns. OLD is `origin/main` with the
  flags off. NEW is this branch with the rulebook flags on. A case that is
  worse on NEW has to be fixed before the pull request is ready.

## 24 Oct 2026: Self-check must not refuse a typed name — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. No prompt section
was removed. Do not publish templates.

- A name that is not in Woven is not a self-check failure, and the reply does
  not say "I couldn't find **Name** in the Woven roster." Repair text that
  refuses the form, or that scrubs down to nothing, falls back to the last
  good reply and the name stays on the card. The repair instruction tells the
  model to keep the typed name and not to refuse the form.

## 24 Oct 2026: Prompt A/B on the replay — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. No prompt text
was reverted: the last-known-good system prompt is `417e80c` (before the
unified-authority edit), and with the replay flags that section is off, so
the built prompt matches the current one. Code fixes stay in code. Do not
publish templates. `chat_traces.slots` is already applied in production.

- The replay can build either the current system prompt or that saved
  prompt, with the same code and the same flags. A case the old prompt
  passes and the current prompt fails is reverted in the prompt. A tie
  keeps the current prompt.

## 24 Oct 2026: Close-match note under the card — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. The flag defaults
off. Do not publish templates.

- `TYPED_NAME_PROCEEDS_ENABLED` — when a typed name is close to a different
  Woven employee, the card is built in that same turn with the typed spelling.
  A short note sits under the card: "Woven has Jane Doe". Several close people
  read "Woven has Pat Rivera or Pat Jones". The note is not a question and
  does not hold the card. There is no note when nobody is close, and no
  "I didn't find…" line. Off, a close match is still "Did you mean …?" and
  that question holds the card.

## 24 Oct 2026: Code-owned form slots — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. The flag defaults
off. Do not publish templates. `chat_traces.slots` is already applied in
production. This change does not add a migration and does not re-apply one.

- `CODE_SLOTS_ENABLED` — the model does not write Employee. Code takes a
  candidate span, strips salon and city tokens, field labels, and promo
  words, then fuzzy-matches the roster. An exact row uses the directory
  spelling. A close spelling or a person who is not on the roster stays as
  typed. Slots already filled stay until the manager changes them. Empty
  required slots (employee, and the date on a corrective action or coaching
  form) get a non-blocking line. A salon never holds the card: one salon on
  the account, or the roster match, or blank. A stored `pendingConfirmation`
  resolves a bare yes or no before the model runs; a bare yes with nothing
  pending leaves the slots alone. A roster-refusal reply is not shown. A
  failed repair falls back to the last good reply and card. An incident date
  is parsed to ISO in code and replaces the stored date only when this turn
  states a new one. Printed pages for the cited sections are Attendance 14,
  Late Opening 15, Dress Code 15, Cell Phone 19, Standards of Conduct 12
  (the section runs 12–14), Animals 30. Each traced turn can store those
  slots on `chat_traces.slots`.

## 24 Oct 2026: Payroll deduction amount — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. The flag defaults
off. Pau approved the field; the guide-check note below that said no amount
field is superseded for this line only.

- `PAYROLL_AMOUNT_FIELD_ENABLED` — the Corrective Action card and PDF gain
  **Payroll deduction amount** immediately after "Is payroll deduct
  applicable?". The figure is one the manager stated (`payrollDeductAmount`,
  or a figure on that same Yes, or a bare figure answering the question).
  Late Opening's "$25.00 via payroll deduction" does not fill it. The line
  stays blank when payroll is not Yes. When payroll is Yes and no figure was
  given, the chat asks once (including a chat correction) and does not ask
  again. The card and finalize are not held for it. The figure is kept on
  `chat_form_state` and through a redraft merge. It is not a sentence in the
  Action Plan. Off, the document, the ask, and the PDF do not include the
  line. The dpoa seed is revision 7, matching the live library, and
  `ensureTemplateLibrary` still writes revision 6 without this line until
  Pau approves a publish. Do not publish the template to the database.

## 24 Oct 2026: guide code check — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. Every flag
defaults off. Bubbles `self-check.ts` accepting either the printed page or
the PDF sheet (guide item 10 / 20c) is Bubbles-only until that repo is
attached.

- `ACTION_PLAN_SENTENCES_ENABLED` — `correctiveActionPlan` leaves
  `payrollDeductSentence` out of `action_plan`. The field is the review
  sentence and the required closing. Rev 5 "may be subject to" is unchanged.
  Self-check rejects a plan that is not those two sentences, including one
  that still says an amount will be deducted.
- `MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED` — a Yes does not take "$25.00" from
  Late Opening text. The amount is one the manager stated. No amount field
  is added; Pau is deciding that.
- `POLICY_GATE_NONBLOCKING_ENABLED` (browser:
  `NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED`) — a blank Direct policy
  stays blank and does not hold the card or finalize. A policy value
  somebody typed that was never verified still asks for an acknowledgement.
- `TYPED_NAME_PROCEEDS_ENABLED` — see the close-match note at the top of
  this log. The card uses the typed name in that same reply. The note under
  the card is "Woven has Jane Doe", not a question. A name that is not close
  to anyone in Woven gets no note.
- `MANUAL_SECTION_DEDUPE_ENABLED` — retrieval keeps one current-year chunk
  per section heading (nearest match). The three indexed 2025 copies
  (ce6b00f1, 5c626f3c, 94d9810f) are the test fixture, not a keep-list.
  Nothing is deleted.
- `PRINTED_PAGE_CITATION_ENABLED` — a citation uses the printed page. The
  PDF `page` column is not cited when no printed page was stored.

## 24 Oct 2026: prompt rule conflicts — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store. Every flag
defaults off.

- `TYPED_NAME_PROCEEDS_ENABLED` — a name that is not an exact roster match
  stays as typed. "Did you mean" and "Who is this for?" do not hold the
  card. A close roster match is the short note under the card. Two people
  the manager actually named are still a real "Which of them".
- `ATTENDANCE_POLICY_CITATION_ENABLED` — tardiness cites Attendance by name
  and page. A late opening still cites Late Opening. The ticked
  "Tardiness/Leaving Early" box is not the citation.
- `POLICY_PAGE_REQUIRED_ENABLED` — a form that resolves a manual section
  cites that section's name and page on Direct policy, or on the coaching
  or follow-up narrative. A page the manual did not print is not invented.
- `ACTION_PLAN_SENTENCES_ENABLED` — already the two-sentence plan. A payroll
  Yes stays on its own field, including when a plan is rebuilt on a newer
  template version.
- `UNIFIED_AUTHORITY_ORDER_ENABLED` — the employee-performance block and the
  daily-stats block share one order of authority. Off, each list stays.

## 24 Oct 2026: Late Opening, and the current manual at retrieval — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company wording.
The manual title stays **JBA Policy Manual**. Salon ↔ store.

- `readCaPolicy` treats `late opening` and `opened late` as the Late Opening
  policy. The offense box stays tardiness. A late arrival stays unnamed.
  `policy acknowledgement` reads as unfinished required work (Standards of
  Conduct). `wore leggings` reads as the dress code.
- `CURRENT_MANUAL_SCOPE_ENABLED` (default off) asks the match for the SQL
  clamp of 50 rows, drops older JBA editions, and collapses identical
  sections. The 0.78 similarity floor is unchanged. Nothing here writes a
  migration or deletes chunks. Two copies of the same year stay when their
  text differs.

## 24 Oct 2026: backend quality flags (Part A) — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy company
wording. The answering model stays whatever that app already uses; Sunny
stays on Opus. Every flag defaults off.

- `PROMPT_CACHE_ENABLED` — `cache_control: { type: "ephemeral" }` on the
  static system prompt and the pinned policy-manual block. Off, the request
  shape is unchanged.
- `MODEL_RETRY_ENABLED` — 45s timeout, `maxRetries: 2`, and a plain message
  when the model returns 529. Off, the SDK defaults and the existing failure
  text stay.
- `REQUIRED_FIELD_CHECK_ENABLED` — the next reply lists template fields the
  proposal has not filled (Zod against the published template). A typed name
  fills the employee field. Not being in Woven is not a missing field.
- `CONVERSATION_PROPOSAL_DEDUPE_ENABLED` — a second create of the same
  conversation and proposal returns that draft. Off, the existing card
  lookup stays. Sunny's create source is `ask_sunny`.
- `LONG_CONTEXT_ENABLED` — already the long-chat summary path. No second flag.
- `CITATION_VERIFY_ENABLED` — a JBA Policy Manual heading and page is kept
  only when the current manual chunks contain it.
- `CHAT_TRACE_ENABLED` — already writes one row per turn. A no-card turn and
  a turn with at most one retrieved chunk are tagged on `intent`
  (`no_card`, `low_retrieval`) so they can be read back into replay cases.

Part B (streaming, checklist, inline edits, citation chips, quick replies,
resume-draft banner, accessibility) is a separate Sunny branch for Pau to
approve. It is not in this change. Do not port that UI until it is approved
and Ask Bubbles is attached.

## 24 Oct 2026: four low-rated Bubbles chats (b9–b12) — port the mechanism

Ask Bubbles was not attached. Port the mechanism. Do not copy people, store
names, or company wording. Salon ↔ store. The manual title stays **JBA
Policy Manual**.

What Bubbles must port, behind the same default-off flags (no new flag, no
phrase list, no UI change):

- A prior verbal or written step is history. Both words in one account do
  not ask "which warning level" and do not block the card. "do verbal" is a
  verbal corrective action, not a coaching question.
- A roster state abbreviation ("NE") and a name made only of the manual
  title's own words ("JBA Manual") are never offered as the employee.
- A comma plus a roster state ("empire, sd") is that state, not a job title.
- "at Dodge, NE" / "location is Empire, SD" is a place plus a roster state.
  One store in that state whose name contains the place words is that store.
  None is unknown: ask, and list the employee's real stores. Do not file the
  Woven primary, and do not treat a policy phrase ("workplace policy") as a
  store.
- The title they started is filled from the directory when that person's
  title starts with those words. A person who is not in the directory keeps
  only the words they said, not the rest of someone else's title.
- The turn that already describes what happened is the offense on the card.
  With the action-plan flag on, the card carries the two-sentence plan
  (review the cited section, then the required closing). A named manual
  heading, including Animals in the Workplace, is cited with its page.

## 23 Oct 2026: a name not in Woven is not a blocker (Sunny only)

Live replay with the seven flags on refused forms, leaked the repair model's
"I cannot repair this reply", and dropped slots that an earlier turn had
already filled. A typed name stays on the card. Filled slots stay for the
rest of the chat. The salon the manager named wins over the Woven primary.
The retirement "Warning" sheet is not cited as a policy. "Exit plan" is the
Resignation/Exit Form. Ask Bubbles was not attached (`permissions.push` is
false). Port the mechanism. Do not copy salon names, people, or company wording.

## 23 Oct 2026: hybrid rank was burying the nearest chunk (Sunny only)

With both retrieval flags on, reciprocal-rank fusion let an OR keyword hit
on a common word (employee, shift, late) outrank the chunk the question
embedding had already found, and the heading-only Haiku pick then dropped
that neighbor. Ask Bubbles was not attached. Port the cosine-led rank and
the skip-Haiku path. Do not add phrase-to-section glossary lines for
"showed up late" or "late 3 times": the model picks the section by reading
the retrieved manual text. Do not copy salon names or company wording.

`src/lib/knowledge/hybrid-rank-rewrite.test.ts` is a Sunny regression on
this manual's production embeddings. A rewrite that keeps the manager's
"late" wording still places Late Opening ahead of Attendance, and Attendance
stays inside the context passed to the answer. SELF_CHECK, already on main,
drops Late Opening when its own text is the salon opening. Every glossary
line that mapped a phrase onto a manual section title is removed, including
tardy, late opening, and the violation phrases listed in the chat-quality
entry below. Form shorthand stays. "tardy twice this week" still ranks
Attendance first from the rewrite embedding alone. Ask Bubbles was not
attached. Port the cosine rank, the skip-Haiku path, and that glossary
removal. Do not add a phrase-to-section map back. Do not copy salon names
or company wording.

## 22 Oct 2026: both apps brought level (pending QA review)

Every chat/forms fix merged to either `main` from 12–21 Oct was compared. The
gaps below are closed on branch `claude/lucid-shannon-v79zju` in each repo,
**not yet merged to `main`** (QA hold, 22 Oct). Everything else already
existed in both.

### Ported into Ask Sunny from Ask Bubbles

| Bubbles commit | Fix |
|---|---|
| c32eb59 (+ Sunny's own unmerged 0090bef) | The open conversation stays in the address; a reload reopens it |
| fe871f1 | Confirm before deleting a conversation or finalizing a form |
| ab77b14 (+ Reviews/Videos from Sunny's unmerged c2a0e88) | Small links and buttons at least 24px to tap |
| 062e5dc | Browser autofill off on every typed form field |
| 987e4b7 | "Create a form" shown only to an account that may create one |
| 4cbb84c | "write a CA for X" read as a request; the CA leads when asked for |
| 8cdc41b | What an earlier coaching was for stays on the history line |
| ac36870 | HR's 21 Oct wordings: payroll answers, a friend/coworker in the account is not the employee |
| b1047ab | One employee's short answers never land on another's form |
| 9530112 | "verbal, payroll deduct no." read as the level and the payroll answer |
| c25e05c | Possessives, all-caps/lower-case names (capitalised on the card), punctuated salons, Google store codes — cherry-picked from Sunny's own unmerged c52d74c, d616cf4, fa565c0 |
| 8e3e81e | Intake stays open on a salon / "I already told you"; "my employee <name>"; CA offered beside Coaching after a repeat |
| 51e1d5e | Exact title match when a knowledge upload supersedes a document; `/api/health` no longer 500s in demo mode |
| 54b3d42, 6e92b9d | Template sync lists every failure; an interrupted publish is finished, never reported as success |
| bee01d6 (mechanism of Bubbles' store-number collision question) | A salon number that is also another salon's Google store code (306/307/314) is asked between the two for an account covering every salon, never dropped or guessed |

New end-to-end regression suite: `src/app/api/forms/hr-feedback-oct21-e2e.test.ts`
(11 of its 33 HR scenarios fail on `main`; all pass with these ports).

### Ported into Ask Bubbles from Ask Sunny

| Sunny commit | Fix |
|---|---|
| cf1480b | After a Save the card reloads its form; a refused finalize opens the policy dialog instead of a dead-end error |
| 4c15744, b78a497, 5ffa19e | Policy notices say "Woven does not see this policy in the knowledge base" |
| 1d63aeb | A Corrective Action lists the employee's forms already on file as prior actions |
| 7b3edea | Timeout headroom for two slow test suites |

### Staying one-sided (by design)

- Sunny only: EFTs (5b7686a), KS Manhattan district move, Google reviews
  posted-date anchors (76b2b85 — Bubbles already counts by Google's own create
  time).
- Bubbles only: Buff City Soap content, Store/Guest terminology, Forms Register
  name, sidebar order, Bubbles' account provisioning, `entity-facts.ts`
  (efde160), the store resolver and Woven title verification (ffea279), the
  report ask bar's form list (b87431c — Sunny lacks the feature).
- Woven-affiliation designation (Bubbles 6d388ad) is not needed: both apps now
  show a manager the forms at every location Woven assigns them.
- Sunny only: the Woven access local-stack suites delete the store mappings
  they add (b9fe177, QA LS-1). Only Sunny has a later suite (month-to-date
  reviews) that resets a mapped salon; Bubbles has no such suite, so its
  leftover rows break nothing.

### Open decisions (not ported yet)

1. Admins who aren't company-wide limited to granting their own areas (Bubbles 2123821).
2. Asking "which date goes on the form?" when two incident dates are given (Bubbles 9c02dcb).
3. Every form, not only CAs, built only from the turns about that form and person (Bubbles a73ef6c).
4. Two forms from one message, and "which one?" for a correction (Bubbles 01fa914, 8b79a46).
5. Bubbles' store resolver / Woven title verification / chat-side people lookup (ffea279, efde160).
6. A same-origin guard on Sunny's Apify review-sync admin routes.

## 22 Oct 2026: real people and the manual's wording removed (Sunny PR #130)

Ask Sunny's tests, comments and docs now use synthetic people only, the
policy-manual fixture has invented wording, and
`src/lib/security/no-real-people.test.ts` guards company addresses.

**Ported to Ask Bubbles** in Glowbrands1/Ask-bubbles#71, together with the
Corrective Action recipient fix (6b5f897). Bubbles' own company's people were
checked against its own directory and replaced too; it has no copy of the
policy-manual fixture.

## 23 Oct 2026: flagged chat-quality path (Sunny only this session)

Form-tool understanding, form-command routing, hybrid retrieval, Haiku query
rewrite, and the style-prompt rules are behind flags that default off
(`FORM_TOOLS_ENABLED`, `HYBRID_SEARCH_ENABLED`, `QUERY_REWRITE_ENABLED`,
`CHAT_STYLE_RULES_ENABLED`, `CHAT_TRACE_ENABLED`, `RETRIEVAL_RECALL_ENABLED`,
`LONG_CONTEXT_ENABLED`, `CHAT_DATA_TOOLS_ENABLED`,
`PRIOR_COACHING_OPTIONAL_ENABLED`). The house glossary and any-message rewrite
stay on `QUERY_REWRITE_ENABLED`. Recall, the longer history window, and the
read-only review/sales/comp-report tools are the later flags. Violation
phrases (cleaning, a missed deadline, policy acknowledgments, insubordination,
misconduct, must-see behaviors) were briefly on the glossary so recall could
name a section. Those phrase-to-section lines are removed; see the hybrid-rank
entry above. Prior coaching is optional only when its own flag is on.
Ask Bubbles was not attached to this session, so
the mechanism was not ported. It does not rename the JBA Policy Manual and it
does not copy salon names or company wording into a sibling. Port the same
flags and files when Bubbles is in the session.

## 23 Oct 2026: live replay fixes (Sunny only)

Grounded names, a per-conversation form state, incident-matched draft
reopen, coaching citations from the same JBA manual retrieval Corrective
Action uses, review inventory totals, and conversation-scoped memory are
behind `GROUNDED_ENTITIES_ENABLED`, `FORM_STATE_ENABLED`, and the flags
already on main (`POLICY_CITATION_ENABLED`, `DRAFT_DEDUPE_ENABLED`,
`CHAT_DATA_TOOLS_ENABLED`, `CHAT_MEMORY_ENABLED`). "Show draft with edits"
keeps a filled Offense and Action Plan behind `DRAFT_MERGE_ENABLED`. The
Action Plan is two sentences behind `ACTION_PLAN_SENTENCES_ENABLED`.
Each new flag defaults off. The JBA Policy Manual is the approved citation
source: the bot cites the section and printed page and does not ask the
manager to confirm the manual. "JBA Manual" is not an employee. Finalized
forms are unchanged: an edit still opens a new draft. Migration
`20261023200000_chat_form_state.sql` is additive and is not applied.
Ask Bubbles was not attached, so this stays Sunny-only. Port the mechanism
later. Do not copy salon names or company wording, and do not rename the
JBA Policy Manual.

## 23 Oct 2026: form fixes behind more default-off flags (Sunny only)

Slot retention, field accuracy (a month-day and a payroll amount the
existing readers skip), draft reopen, a second or follow-up document, and
a JBA Policy Manual name plus printed page on coaching narrative (and an
empty Corrective Action policy line) are behind `SLOT_RETENTION_ENABLED`,
`FIELD_ACCURACY_ENABLED`, `DRAFT_DEDUPE_ENABLED`, `SECOND_FORM_ENABLED`,
and `POLICY_CITATION_ENABLED`. Each defaults off. The wrappers call the
readers Pau already shipped; they do not replace them. Ask Bubbles was
not attached, so this stays Sunny-only. Port the same flags and files
when Bubbles is in the session. Do not copy salon names or company wording.

Google review star counts, Comp Report and Sales Totals breakdowns, and
per-user memory are behind `REPORT_BREAKDOWN_ENABLED` and
`CHAT_MEMORY_ENABLED`, also default off. Product, category, employee, and
a summed week are not stored and are said to be missing. The memory
migration `20261023150000_user_memory.sql` is not applied. Ask Bubbles was
not attached. Port the mechanism later; do not copy salon names.

## 23 Oct 2026: hybrid retrieval timeout (Sunny only this session)

`match_knowledge_chunks_hybrid` was scanning a materialized copy of every
visible chunk, so the HNSW and GIN indexes were never used (about 4.5s, and
sometimes the 8s statement timeout, which chat shows as "The company
knowledge base could not be searched"). The keyword leg also AND-ed every
word, so a long policy question matched nothing and the Performance
Management Framework outranked the JBA Policy Manual.

The fix is an app fallback to `match_knowledge_chunks` when the hybrid RPC
errors or passes about 5s, plus a new migration
`20261023161000_match_knowledge_chunks_hybrid_index.sql` that reads
candidates through the indexes and ORs significant words (glossary lines
included). Supabase rejected a function-level `SET hnsw.iterative_scan`
(42501), so the function calls `set_config` inside the body and, when that
is denied, reads `k*4` vector neighbors before the visibility filter. Policy-type questions prefer the policy-manual category from the
document's own category and title, not from a new word map. The migration
is not applied. Ask Bubbles was not attached, so this stays Sunny-only.
Port the same mechanism when Bubbles is in the session. Do not copy salon
names or company wording.

## 23 Oct 2026: matcher request store (ported from Ask Bubbles)

The name matcher's `AsyncLocalStorage` moved to `src/lib/forms/kept-typed-names.ts`
(`server-only`), the same mechanism as Ask Bubbles `kept-typed-names.ts`.
`employee-match.ts` no longer imports `node:async_hooks`, so a client chat
page can import the matcher. No salon names or company wording were copied,
and the JBA Policy Manual title is unchanged.

## 23 Oct 2026: self-check and manual-term retrieval (Sunny only)

`SELF_CHECK_ENABLED` defaults off. When it is on, a reply is checked before
it is sent: a cited page must equal the retrieved chunk's own page, a cited
section is dropped when one Claude call reads that chunk's text and says its
conditions do not fit the question, an action plan must be two sentences, and
an employee on a form must be in the Woven roster. The same call repairs a
failure, then a safe fallback drops what is still wrong. There is no
hard-coded list of which section fits which situation. `QUERY_REWRITE_ENABLED` already
defaults off. When it is on, the retrieval query is a manual heading the
account resolves — a person who showed up late searches Attendance, and
Late Opening only when the salon opens late — or a heading the model names
that is actually in the retrieved manual. No new migration. Ask Bubbles
was not attached, so this stays Sunny-only. Port the mechanism later. Do
not copy salon names or company wording, and do not rename the JBA Policy
Manual.

## 23 Oct 2026: feedback replay and few-shot examples (Sunny only)

`npm run export:feedback-replay` reads 1–4 star rows from `ask_sunny_feedback`
and the matching `chat_messages`. It only selects. Personal data is
redacted with patterns and with names from the Woven directory before a
case is written. `src/lib/ai/live-replay.eval.test.ts` checks every case
in `src/lib/ai/__fixtures__/feedback-replay-cases.json`.
`FEWSHOT_EXAMPLES_ENABLED` defaults off. When it is on, similar 5-star
exchanges from this company's scope are added to the prompt. No new
migration. Ask Bubbles was not attached, so this stays Sunny-only. Port
the mechanism later. Do not copy salon names or company wording.

## 23 Oct 2026: intent extraction (Sunny only)

`INTENT_EXTRACTION_ENABLED` defaults off. When it is on, one Claude tool
call reads employee, salon, title, incident type, incident date, payroll
amount, warning level, and form type from the message, the history, and
the stored form state. Each slot is kept only when the Woven roster, the
salon list, or a retrieved JBA manual heading agrees. A missing slot is
asked; an ambiguous person is a numbered choice that shows salon and
title. No new migration. Ask Bubbles was not attached, so this stays
Sunny-only. Port the mechanism later. Do not copy salon names or company
wording, and do not rename the JBA Policy Manual.

## 22 Oct 2026: Corrective Action QA audit (from Ask-bubbles#68)

Ported in this PR (Glowbrands1/ask-sunny#128), one `Port from Ask Bubbles
(<sha>)` commit per fix: the invented-date guard in drafted text, the draft
notice on the chat card, payroll amounts without `$` and "$0" as No, a
cancelled order beside the deduction not read as a waiver, the register
`form_date` kept in step with the Date line, the two-policy question,
autofill off on typed form fields, and the audit's manual fixture with
invented wording. Sunny-only: its payroll Yes is read only when stated, and
the warning level stays on the form.

## 23 Oct 2026: form-card slots and form-turn citations

Live prompts kept asking for a salon Woven already records, dropped a date,
a title, and a payroll amount when the employee was not verified, re-asked
the warning level on a resend, and let a finalized corrective action block a
new coaching card. A form turn also returned no sources. The slots stay on
the proposal. The salon is the employee's Woven primary location when the
manager did not name one. A name that is not in the roster stays, with one
sentence. Citations are the retrieved manual's heading and printed page,
including a heading the intent tool chose from that list. No new migration.
Sibling app: not ported. Ask Bubbles `main` has the same files, and this
session can read them, but the token cannot push (`permissions.push` is
false). Port the mechanism when a writable checkout is attached. Salon ↔
store, Form Monitoring ↔ Forms Register. Do not copy salon names or rename
the JBA Policy Manual.

## 23 Oct 2026: proposal cards instead of the still-need list

With `INTENT_EXTRACTION_ENABLED` on, `applyIntentExtraction` returned
`I still need …` (employee, salon, what happened, date, which form, warning
level) and `answerQuestion` sent that instead of a proposal. A live replay
of 14 chats produced no card. A name missing from Woven, and a missing
warning level, were in that list. `CA`, `coaching`, and `exit` were not
read as the published form. Elin Haskett's Woven primary salon was not used
when she is affiliated with more than one. A salon the manager named
outside those affiliations was dropped.

The missing-slot list no longer replaces the card. A numbered choice still
asks when two people, two salons, or two dates are really open. The next
turn keeps the published form's name, so "1" still proposes. An unverified
name stays on the card with one Woven sentence. Self-check no longer clears
that name. Another conversation from the same business day is not recalled,
and few-shot examples redact roster names and are not narrated as something
this manager said earlier today. No new migration. No flag default changes.

The 14-case harness is `src/lib/ai/priority-replay.test.ts`. It feeds the
verbatim manager turns for s4, s9, s11, s5, s27, s28, s29, s17, s20, s21,
s25, s8, s12, and s16, with Woven rows for the employees in those chats.
Flags on, a card is required once the manager has given enough, under the
name they typed. Flags off, the result is held to the 23 Oct 2026 baseline:
a card the baseline showed still appears, except s5 turns 1–2, which name
no form. The baseline card there was the live reply. The harness does not
invent a coaching form from a complaint.

Sibling app: not ported. Same reason as the form-card note above.

## 24 Oct 2026: remap incident (from Ask Bubbles prod, FORM_FULL_REMAP on)

Ask Bubbles built What happened from what was left of the request ("create a
corrective action form for"), lost "previous coaching: …", read "10-1" out of
"10-15-26", and cited no policy on a remap card. Sunny's `form-full-remap.ts`
is the same code and gets the same fix behind `REMAP_INCIDENT_FIX_ENABLED`
(the date regex is an unflagged bug fix in both apps).

Sunny's live path (intent extraction) had the same failures in its own
readers: the Observation of Offense copied the request and the prior-action
list, the Standards of Conduct the account points at was not cited, "empire,
sd" became Salon Director, and "prior = manual ack 9/01" was not a prior
action and became the form date. Those fixes, behind the same flag, are in
`keep-filled-slots.ts`, `form-card-slots.ts`, `intent-extraction.ts` and one
line of `intent-slots.ts`. They stay Sunny-only: Ask Bubbles has no
`keep-filled-slots.ts` or `form-card-slots.ts`, and its live form path is the
remap path, which is fixed there. Tests: `src/lib/ai/remap-incident-oct24.test.ts`
in both apps.

Follow-up (Ask Bubbles QA step 3 and C-list, 25 Oct 2026): the remap path
gets the same per-turn What happened, new-request reset, bare-yes rule,
manager-only action plan and "as you said" guard. On the intent path, behind
the same flag, the Observation of Offense skips edit, command and complaint
turns and starts at a later create request with its own incident; that
request also starts the proposal's history and the intent read's stored
slots afresh, and a date edit ("change the date to 10/22") is read from the
manager's words, not the intent read's "It happened on …" sentence.

## 24 Oct 2026: a policy phrase is not a place (from Ask-bubbles#102)

`PLACE_SPAN_GUARD_ENABLED` (default off), the same flag as Ask Bubbles PR
102 (conv_mvmcetjw2i4vtwz: "cite animals in the workplace policy", then
"store location is empire, sd", asked about a typed store "workplace
policy"). Sunny's roster salon readers (`salon-mention.ts`, `salon-text.ts`)
match only roster names and numbers, and the conversation's own wording
("salon location is Kearney, NE") already reads Kearney. Two free-text
readers had the same weakness and are guarded at the caller:
`place-state.ts` joined the turns, so "cite animals in the workplace policy"
then "at Kearney, NE" read as a place "the workplace policy at Kearney" and
blanked the salon on the intent slots and the form card; on, each turn is
read on its own and a span naming a policy, manual, section or similar
document is skipped. `employment-change.ts` kept a labelled location as
typed, so "per the new salon policy" printed "Policy" as the new salon; on,
a labelled value naming a document is not a location. No store wording was
copied. Test: `src/lib/forms/place-span-guard.test.ts`.

## 24 Oct 2026: "location st joe" names the salon (QA Round 4)

Same flag, `PLACE_SPAN_GUARD_ENABLED`. In conv_mvmw4hwq292a6vq, "name is
test testyone, location st joe, …" came after "salon is wornall", and the
card stayed on Wornall. The roster reader (`salon-mention.ts`, protected)
counts a short name only behind a place cue, and a field label was not one.
On, `salon-cue.ts` reads "location / salon / store <name>" as "at <name>"
(the roster reader's other rules still apply), and the salon the newest
manager turn names replaces the saved one on the intent slots and the card.
Ported to Ask Bubbles' store reader on the form remap path in the same
session (its "location kearney" / "store kearney" kept the earlier store).
Test: `src/lib/forms/salon-label-cue.test.ts`.

## 25 Oct 2026: edits are applied or answered; dates follow the incident

`FORM_EDIT_DATE_RULES_ENABLED` (default off, same flag in Ask Bubbles). QA's
history replay on prod 20120d7: "change observation of offense to: …",
"clean up my grammar", "change salon location to omaha center", "can you edit
the form I already finalized …" were appended to Observation of Offense;
"the late opening policy INSTEAD of the attendance policy" read as
Attendance; a prior action's date became the Date or a "Follow-up:" line.
Ported to Ask Bubbles' remap path in the same session (replace / add /
instruction for What happened, the Date past a prior step, "today", the
set-aside policy, the finalized-form reopen). Stays Sunny-only: the
Follow-up rule (the remap card has no Follow-up line) and the salon edit on
the card (Ask Bubbles' store edit is a separate fix on its remap path). Test:
`src/app/api/chat/edits-dates-replay-e2e.test.ts`.

## 25 Oct 2026: EPP Store wording in Ask Bubbles — Bubbles-only (brand-specific)

Ask Bubbles pins its Employee Performance Plans to "store" wording with no Sun Tan City name or logo, keeping the PPTA/LPSVA/UPTA/Club Close metrics and the stored `salon_*` keys (Ask Bubbles `src/lib/forms/epp-store-wording.test.ts`); not needed in Ask Sunny because "salon" and Sun Tan City are this app's own brand.

## 25 Oct 2026: a named form that is not published opens no card (from Ask Bubbles b2cb091)

Ask Bubbles ships this unflagged; Ask Sunny ships it behind
`NAMED_FORM_EXACT_ENABLED` (default off) for the staged rollout. On, a form
the manager named is kept only as itself on the intent slots: a named
template that is not published leaves the form unset (the proposal flow says
it is not published), the slot model's or the saved form does not stand in
for it, a named kind of form ("… interview form") keeps only a form of that
kind, and a turn naming two forms together names either of them. Off, the
form is read exactly as on main. Tests: `src/lib/ai/hidden-form-no-card-oct25.test.ts`,
`src/lib/ai/form-choice-stated.test.ts`, `src/lib/ai/form-choice-stated-live-oct25.test.ts`.

## 25 Oct 2026: "$3.25" cut to "$3" in the Issue — Bubbles-only fix (from Ask Bubbles f3e9b83)

Ask Bubbles' Issue reader (`src/lib/forms/incident-issue.ts`) ended a
sentence at the point in "$3.25" (conv_mvofkkrg2ipw28x); it is fixed there
behind `DECIMAL_KEEP_ENABLED`. Not needed in Ask Sunny: it has no Issue line,
and its Observation of Offense (`accountSentences`, `withObservation`) ends a
sentence only at a point followed by a space, so "$3.25" already stays
whole. `src/lib/ai/decimal-keep-lock.test.ts` locks that with the reported
wording.

## 26 Oct 2026: the stored-slot lines are not a new request — Sunny-only (STORED_SLOTS_NOT_A_REQUEST_ENABLED)

`STORED_SLOTS_NOT_A_REQUEST_ENABLED` defaults off (Pau-approved edit to the
protected form-proposal.ts). On this app's intent path the stored slots put
ahead of a slot answer ("The form is the Corrective Action Form. The employee
is … Policy reference: …") made `turnsAboutThisForm` read "no payroll deduct"
as a new request, so the card dropped the prior and its sources were that
turn alone. Not needed in Ask Bubbles: replayed through POST /api/chat on its
main (39f2df1d) with the same three turns, its live form path (the full
remap) never reaches `turnsAboutThisForm`; the card keeps the prior coaching
through "no payroll deduct", and with REMAP_INCIDENT_FIX_ENABLED and
REMAP_DRAFT_SOURCES_ENABLED its sources are every turn. Its intent path does
not draft a card from these turns. Test:
`src/app/api/chat/stored-slots-not-a-request-e2e.test.ts`.

## 26 Oct 2026: an assistant salon director has no Form Monitoring — Sunny-only (NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED)

Requested for Sun Tan City's assistant salon director role only. With the flag
on, that role loses `view_form_monitoring` (sidebar, page, Overview follow-ups,
chat card link and search hits go with it) but still opens and downloads the
forms it created itself. Ask Bubbles' assistant manager keeps the Forms
Register: not requested there; ask Pau if wanted.

## 26 Oct 2026: a job title is never the incident — Sunny-only (JOB_TITLE_NOT_INCIDENT_ENABLED)

"create corrective action form for <name>, Salon Director" drafted "Observed:
Salon Director." here. Ask Bubbles reads the request's clause through
`requestIssueClause` (`incident-issue.ts`); the same shape there, with a
store title, writes no Observation (checked 26 Oct 2026). Not ported.

## 27 Oct 2026: the Action Plan fits the incident — ported from Ask Bubbles (MEETING_NOT_LATENESS_PLAN_ENABLED, PLAN_PAYROLL_SENTENCE_ENABLED)

QA's Sunny baseline (SX1-SX3) found the same two bugs as Ask Bubbles LS-B8 / LS-B6 / LS-B9: a missed meeting got the lateness plan, and a stated deduction was left out of the plan. Same flags, same mechanism (Ask Bubbles #253). The protected `ca-action-plan.ts` is untouched.

## 27 Oct 2026: a pet at work cites Animals in the Workplace — both apps (ANIMAL_ANYWHERE_ENABLED)

Pau reversed the earlier "no" on 27 Oct 2026. With the flag on, an animal word (puppy, kitten, dog, cat, pet, …) anywhere in a sentence about being at work is the Animals in the Workplace incident (service animal, hot dog and guinea pig stay excluded), and a "cite <policy>" line names that policy without the word "cite". Same flag and mechanism in Ask Bubbles (#254).


## 27 Oct 2026: a Corrective Action card with no account asks what happened — Sunny-only (CA_ASKS_WHAT_HAPPENED_ENABLED)

QA P1: "create corrective action form for <name>, <job title>" / "<name>, <job title>" drafted with no account and no question here, because this app's proposal reader counts the job title as an account. Ask Bubbles already asks "You haven't told me what happened yet" on the same turns (checked through POST /api/chat with Bubbles' production flags, flag off), so the flag stays Sunny-only.

## 27 Oct 2026: a step's date is not the incident date — both apps (STEP_DATE_NOT_INCIDENT_ENABLED)

QA SF4: "… for opening salon late on 9-28-26" / "note a verbal ca was given on 9-1-26". Here the step's 9/1 blanked the card's Date and the form was dated today; in Ask Bubbles it dated the card and the form 9/1. With the flag on, a date in a sentence that says a step was given, issued, received or signed is not an incident date, in both apps.

## 27 Oct 2026: the AI reads the form request, the code checks it — both apps (AI_READS_CODE_CHECKS_ENABLED)

Pau's decision, 27 Oct 2026. `AI_READS_CODE_CHECKS_ENABLED` defaults off, same name in both apps. On, one extra Haiku call per form turn (`ai/reader/read.ts`, 2 s limit, no retry) returns each field with the manager's own words it came from; `ai/reader/check.ts` keeps a field only when that quote is in the manager's turns and the roster, the date readers, the location list or the manual agree; `ai/reader/merge.ts` lets a checked field fill only what today's readers left open (no value, a numbered list, a name nobody on the roster has, a prior step's date), never replace what they settled. The Create check (`proposal-currency.ts`) takes "Marlowe" or "quinn" as part of the card's "Quinn Marlowe". A failed, slow or unusable reply runs the turn on today's readers. No protected file is edited. Tests: `src/lib/ai/reader/check.test.ts`, `src/app/api/chat/ai-reads-code-checks-e2e.test.ts`.

## 27 Oct 2026: "$25" after the amount question is read back (AMOUNT_ANSWER_SAVED_ENABLED, Sunny-only)

Not needed in the sibling app: the same turns through its harness ("yes payroll deduct" then "$25") read back "**Payroll deduction amount:** $25".

## 27 Oct 2026: an amount answer is no account text (AMOUNT_ANSWER_NOT_ACCOUNT_ENABLED, Sunny-only)

Not needed in the sibling app: its card shows no Observation of Offense line. The same turns through its chat harness ("yes payroll deduct" then "i dont know the amount") put nothing about the amount into the card's account.

## 27 Oct 2026: the monthly budget counts the AI reader's call, and prices Claude Haiku 5.5 — both apps

The spend guard read only each `chat_traces` row's own model and token columns. The AI reader (`AI_READS_CODE_CHECKS_ENABLED`) records its call in `slots.reader`, so its spend was invisible to the monthly budget (the daily call cap counts answering calls only, by design). `modelUsageSince` now adds a row for `slots.reader.usage` (priced at `slots.reader.model`, or as Haiku 4.5, the dearer Haiku, when the trace has none), counts form turns that had a reader call but no answering model call, and `model-prices.ts` lists Claude Haiku 5.5 ($0.10 in / $0.50 out per MTok, cache read $0.01, cache write $0.125, prompts up to 100K) instead of pricing it as Opus. If the reader-aware read errors (for example the `slots->reader` path is not what the project has), the old read (answering calls only) is used and a warning is logged: never zero, never the guard off. The daily call cap is unchanged (`modelCallsSince` is the same query). It only makes the guard count more, and the guard flags stay default off, so this change has no flag of its own. The existing slot call (`record_intent_slots`) records no usage in the trace and is still not counted. Same change in Ask Bubbles.

## 27 Oct 2026: "Marlowe, Quinn" is read as Quinn Marlowe, without a model — both apps (LAST_FIRST_NAME_READ_ENABLED)

QA's five "Last, First" variants (the AI reader's one measured win, +5 of 60) made today's name reader stop at the comma: "My employee Marlowe, Quinn" was the employee "Marlowe", "employee name is Hollis, Ivy" was "Hollis Ivy", "Marlowe, Quinn was late on 10/20" had no employee, and Create refused the card as out of date. With the flag on, a capitalised "Word, Word" pair in the manager's own turns goes through `ai/reader/check.ts`: it must fit exactly one person on the scoped roster, in either order; `ai/reader/merge.ts` fills only an employee today's readers left open and never replaces a settled one; the Create check takes the part-of-name card. It runs when the AI reader is off (the reader's own answer is used when it is on). No model, no cost, no protected file. Ask Bubbles: ported in its own pull request.
