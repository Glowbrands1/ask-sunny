# Agent loop handoff

Start here: read `CLAUDE.md`, then this file, then `docs/agent-loop/rebuild-plan.md`.
Session starters are in `docs/agent-loop/SESSION_STARTERS.md`. The new QA's first message is in
`docs/agent-loop/NEW_QA_START.md`. Every open PR and remote branch is listed in
`docs/agent-loop/handoff-inventory.md`.

## QA Success 2 handoff

Written 16 Nov 2026, about 4:30 AM PHT (15 Nov 20:30 UTC), by the outgoing QA ("v2-QA", QA Success 2). The owner
(Pau) is moving to a new Claude account; a new QA on that account takes this job over. During the handoff nothing
was merged, no flag was changed and nothing was redeployed. All times are PHT unless marked UTC.

### 1. The QA role

- **QA is the only session that merges pull requests, changes Vercel environment variables (flags) or redeploys**,
  for Ask Sunny (`Glowbrands1/ask-sunny`) and Ask Bubbles (`Glowbrands1/Ask-bubbles`). QA also rolls back, runs live
  checks of a deploy and writes the reports to Pau.
- **Coding sessions** write code and open **draft** PRs only. They never merge, never mark a PR ready unless QA asks,
  never touch Vercel, Supabase writes or env vars, never put a model id in a commit or PR, and never push to `main`.
- **Testers and the Runner** run replays and live tests and report. Live tests on Pau's account are **cards only**:
  never Create, Finalize or Send for a real employee, never touch a real manager's draft, and mask names in reports.
- **Never touch `SELF_CHECK_ENABLED`.** It is off in production and stays off.
- Pau's standing approval: "Yes on all moving forward, as long as it's the best decision and you QA everything and
  audited the AI loop and code." Ask Pau (mark the message 🔴🔴) for anything that spends real money above the agreed
  caps, changes who gets the loop, or changes production behaviour for real managers.
- Reports to Pau: plain words, PH time, end every report with "What you need to do:" and where we left off.

#### Release recipe (how QA merged today)

1. Confirm the PR's **base is `main`** (one PR today, #1029, merged into a feature branch by mistake; see 3).
2. CI fully green on the current head (`lint-typecheck`, `build`, `unit-tests`, `eval`, every `flags-off-parity (n)`,
   `checks`). A draft PR cannot be merged: mark it ready first (`POST /repos/{o}/{r}/pulls/{n}/ccr/ready_for_review`
   or the MCP `update_pull_request draft:false`).
3. If the PR needs a new env var, create it in Vercel production **before** the merge.
4. Squash-merge with the full 40-character `expectedHeadSha`.
5. Verify: the production deploy for the merge commit is READY, `https://ask-sunny.vercel.app/login` returns 200 and
   serves that deployment id (`dpl_…` in the HTML), and Vercel runtime errors for the last hour are 0.
6. PRs that touch the same loop files must merge one at a time; after each merge the next PR merges `main` in and
   re-runs CI (about 35 minutes; `unit-tests` is the long job). The app-config snapshot fixtures
   (`src/lib/ai/agent-loop/__fixtures__/sunny-*.txt`) are regenerated from the merged result each time.

### 2. Merge queue (everything waiting on QA)

Nothing in the agent-loop rebuild is waiting. All 11 rebuild PRs merged today. What is open, in the order I would
take it:

| Order | PR | What | Head | CI | Conflicts | Still to check | Blocked by |
|---|---|---|---|---|---|---|---|
| 1 | (not opened) Fix batch, 7 items, see 7 | loop fixes from tonight's tests | none | none | none | the whole review | Pau's "fix batch go" |
| 2 | [ask-sunny#1030](https://github.com/Glowbrands1/ask-sunny/pull/1030) | J11 `ACCOUNT_PERSON_NOT_SUBJECT_ENABLED` (default off) | `0aaa8810` | green on its old base | needs `main` merged in (base was a47f4c9b) | re-run CI after the merge; touches `proposal.ts` (protected) | owner (Coding-5) merges main first; draft |
| 3 | [ask-sunny#1013](https://github.com/Glowbrands1/ask-sunny/pull/1013), [#1008](https://github.com/Glowbrands1/ask-sunny/pull/1008), [#1006](https://github.com/Glowbrands1/ask-sunny/pull/1006) | Coding-2's paused PRs (readable names, first-name fit, Termination in Change something) | `dcce0153`, `ec9ddc19`, `b8d54872` | not re-run on current main | likely, main moved a lot | full replay pack on current head; #1013 review NO-GO points (a preferred name equal to another person's; a flag-off change) | paused until after the pilot |
| 4 | [ask-sunny#1017](https://github.com/Glowbrands1/ask-sunny/pull/1017) | business-zone default America/Chicago | `46a31d74` | check | check | owner and purpose | not part of the loop work; ask Pau |
| 5 | [ask-sunny#1015](https://github.com/Glowbrands1/ask-sunny/pull/1015) | docs: terminations in the agent loop | `8cd55154` | docs | check | still accurate after tonight? | none |
| 6 | [ask-sunny#1005](https://github.com/Glowbrands1/ask-sunny/pull/1005) | parity log: the loop's Ask Bubbles port list (docs), branch `claude/start-here-oy5rn6` (also holds `rebuild-plan.md`) | `af65343d` | docs | check | superseded by this handoff PR for `rebuild-plan.md` | none |
| 7 | [ask-sunny#1043](https://github.com/Glowbrands1/ask-sunny/pull/1043), [#1044](https://github.com/Glowbrands1/ask-sunny/pull/1044), [#1045](https://github.com/Glowbrands1/ask-sunny/pull/1045) | DM L10 meeting pages (c), (d), (e) | `5498c0f6`, `dbf6b160`, `575d8869` | check | check | these come from the UI session on another account, which has been merging its own L10 PRs; confirm with Pau who merges them | Pau |
| 8 | Ask Bubbles [#930](https://github.com/Glowbrands1/Ask-bubbles/pull/930), [#931](https://github.com/Glowbrands1/Ask-bubbles/pull/931), [#933](https://github.com/Glowbrands1/Ask-bubbles/pull/933), [#928](https://github.com/Glowbrands1/Ask-bubbles/pull/928), [#923](https://github.com/Glowbrands1/Ask-bubbles/pull/923), [#935](https://github.com/Glowbrands1/Ask-bubbles/pull/935) | Bubbles ports (amount reader, payroll answer case, J11 port, readable names, Termination pick, loop helpers draft) | `328ced53`, `7f2a5c1b`, `ea956dd2`, `26f1bd00`, `8792b98f`, `24f20dc3` | not checked tonight | check against Bubbles main `ae79dec7` | each against its Sunny source; Bubbles has no agent loop yet | after the Sunny pilot |
| — | about 150 older Sunny PRs (#53 to #994) and about 145 older Bubbles PRs | the October rebuild and port backlog, flags default off | see the inventory | stale | most will conflict | each needs a fresh replay on current main | **paused by Pau** (Gate and Coding sessions parked since 14 Nov). Do not merge without Pau. |

Not waiting on QA: [ask-sunny#991](https://github.com/Glowbrands1/ask-sunny/pull/991),
[#959](https://github.com/Glowbrands1/ask-sunny/pull/959), [#956](https://github.com/Glowbrands1/ask-sunny/pull/956),
[#923](https://github.com/Glowbrands1/ask-sunny/pull/923), [#899](https://github.com/Glowbrands1/ask-sunny/pull/899),
[#871](https://github.com/Glowbrands1/ask-sunny/pull/871), [#865](https://github.com/Glowbrands1/ask-sunny/pull/865),
[#861](https://github.com/Glowbrands1/ask-sunny/pull/861), [#840](https://github.com/Glowbrands1/ask-sunny/pull/840),
[#834](https://github.com/Glowbrands1/ask-sunny/pull/834) are stacked on other feature branches (their base is not
`main`); they move only after their base PR.

### 3. Merged today (15 Nov UTC, which is 15–16 Nov PHT)

Agent loop, merged by QA, in order. Squash SHAs on `main`:

| PR | Merge SHA | What it did |
|---|---|---|
| [#1019](https://github.com/Glowbrands1/ask-sunny/pull/1019) | `e01da172` | G4 follow-up: a description that singles out one form on file opens it |
| [#1010](https://github.com/Glowbrands1/ask-sunny/pull/1010) | `8f7039c5` | `TERMINATION_TICK_NOTE_ENABLED`: a termination the app does not tick is the manager's to tick |
| [#1014](https://github.com/Glowbrands1/ask-sunny/pull/1014) | `a47f4c9b` | `TERMINATION_REQUEST_IS_CA_ENABLED`: "create a termination for <A>" is a Corrective Action request |
| [#1023](https://github.com/Glowbrands1/ask-sunny/pull/1023) | `d081e470` | rebuild: `evidence.ts` (`{message_id, quote}` checked against the manager's real turns) and message ids on turns |
| [#1027](https://github.com/Glowbrands1/ask-sunny/pull/1027) | `0abc038f` | K-keep: a near-miss name is never seated; "Did you mean <name>?" with keep-as-typed (Pau's ruling A) |
| [#1022](https://github.com/Glowbrands1/ask-sunny/pull/1022) | `34740705` | PR 4: every refusal carries a `reason_code`; `error_kind` is the code |
| [#1024](https://github.com/Glowbrands1/ask-sunny/pull/1024) | `0dcb4d66` | PR 5: app config (names, place word, staff system, form keys, locations, roster reader); Sunny prompt byte-identical |
| [#1021](https://github.com/Glowbrands1/ask-sunny/pull/1021) | `a30682c9` | batch K gate: "ready" is a fact; CA-only fields stay on a CA |
| [#1034](https://github.com/Glowbrands1/ask-sunny/pull/1034) | `3eccc9e3` | PR 7: phrasing scaffold (8 behaviours x 6 phrasings), runtime switch-off test, uncreated-card cases |
| [#1035](https://github.com/Glowbrands1/ask-sunny/pull/1035) | `757fdd10` | PR 3: tools return exactly what was saved (`saved`, `refused`, `not_on_card`, `revision_draft`) |
| [#1028](https://github.com/Glowbrands1/ask-sunny/pull/1028) | `53aa54f1` | J-keep: J5, J8, J9, J10, isoDate years, amount reader, payroll clause |
| [#1026](https://github.com/Glowbrands1/ask-sunny/pull/1026) | `a5deffe5` | PR 1a + 1b: privacy, exit, name-correction, account, new-request and person checks take evidence instead of word lists |
| [#1037](https://github.com/Glowbrands1/ask-sunny/pull/1037) | `3496add8` | PR 2a: the server-side card record replaces `CARD_REPLY` and the bold-name match |
| [#1031](https://github.com/Glowbrands1/ask-sunny/pull/1031) | `d57b9fd5` | PR 1c + PR 4 part 2: a level or payroll answer is kept only on evidence |

Earlier on 15 Nov UTC (14–15 Nov PHT), also QA: [#992](https://github.com/Glowbrands1/ask-sunny/pull/992) the agent
loop itself `6cbf26a4`, batches A–H ([#996](https://github.com/Glowbrands1/ask-sunny/pull/996) `697b9d1c`,
[#997](https://github.com/Glowbrands1/ask-sunny/pull/997) `4d9478f2`, [#998](https://github.com/Glowbrands1/ask-sunny/pull/998) `1844b2d2`,
[#999](https://github.com/Glowbrands1/ask-sunny/pull/999) `8e913ca5`, [#1000](https://github.com/Glowbrands1/ask-sunny/pull/1000) `60a02ac9`,
[#1001](https://github.com/Glowbrands1/ask-sunny/pull/1001) `37f64f75`, [#1003](https://github.com/Glowbrands1/ask-sunny/pull/1003) `e5691da0`,
[#1002](https://github.com/Glowbrands1/ask-sunny/pull/1002) `fb94ba6b`, [#1009](https://github.com/Glowbrands1/ask-sunny/pull/1009) `f6c3a3ca`,
[#1011](https://github.com/Glowbrands1/ask-sunny/pull/1011) `82d3159f`, [#1016](https://github.com/Glowbrands1/ask-sunny/pull/1016) `e02108c1`),
[#894](https://github.com/Glowbrands1/ask-sunny/pull/894) `228eecdc`, [#1004](https://github.com/Glowbrands1/ask-sunny/pull/1004) fonts `b9092d8a`,
[#1012](https://github.com/Glowbrands1/ask-sunny/pull/1012) Central time `02df3400`.

**Merged into a branch, not into `main` directly:** [#1029](https://github.com/Glowbrands1/ask-sunny/pull/1029)
(PR 1b) was squash-merged into `claude/agent-loop-pr1-evidence-args` (`1485c5b4`), PR 1a's branch, by mistake (its
base was that branch). Its content reached `main` through [#1026](https://github.com/Glowbrands1/ask-sunny/pull/1026)
(`a5deffe5`), so nothing is lost. Verify with `git log origin/main --oneline | grep -i "PR 1a"`.

**Closed without merging:** [#1018](https://github.com/Glowbrands1/ask-sunny/pull/1018) batch J (salvaged as #1028),
[#1007](https://github.com/Glowbrands1/ask-sunny/pull/1007) first-name-close (superseded).

**Merged by the DM L10 UI session (another account, not QA):** #1020, #1025, #1032, #1033, #1036, #1038, #1039,
#1040, #1041, #1042. Note **#1039 changed `src/lib/ai/agent-loop/tools.ts`** (the CA form key from app config, and
fixtures) to fix red tests on main: that is a loop file outside QA's review. It matches the fix in #1034 and #1028,
but the new QA should agree with Pau that the UI session stays out of `src/lib/ai/`, `src/app/api/chat/` and the
forms code.

Ask Bubbles today: #932 (close-spelling guard port), the tick note and termination-CA ports, merged by QA earlier;
the UI session ported L10 pages (latest Bubbles main `ae79dec7`, #944).

### 4. Production state (checked 20:10 UTC, 15 Nov)

- `main` = `1882cdb17342c1e25e76728e6dadea1dad834eeb` (#1040, an L10 page). It contains every loop merge above
  (last loop merge `d57b9fd5`).
- Production deployment `dpl_3hz146q7kEqskx1HDzRW1pFVBDe7`, READY, built from `1882cdb1`, served at
  `https://ask-sunny.vercel.app` (login 200). Runtime errors in the last 2 hours: 0.
- CI on `1882cdb1` (push to main): 14 of 15 jobs green, 1 (`unit-tests`) still running at the time of writing. Check it.
- Vercel project `ask-sunny` (`prj_rhnfXh2VcfnnyMk53MEbyL1yRlkG`, team `team_VMGm91g69rmb8sSWCu6scejJ`). Supabase
  production project `rbkylaavthsjepsczccv`. Never decrypt env values; list names only.

**Flags (names only).** The on/off list for production chat flags is `src/config/production-flags.json` (398 on,
17 off; the replay pack reads it). Flags that matter for the loop:

| Flag | State |
|---|---|
| `AGENT_LOOP_ENABLED` | on |
| `AGENT_LOOP_USERS` | set to **Pau's own admin account only** (set 14 Nov). No real manager gets the loop. Pilot managers are added here only with Pau's yes. |
| `SELF_CHECK_ENABLED` | off. **Never touch.** |
| `TERMINATION_REQUEST_IS_CA_ENABLED`, `TERMINATION_TICK_NOTE_ENABLED`, `TERMINATION_STATED_TICKS_ENABLED`, `NEXT_PUBLIC_TERMINATION_STATED_TICKS_ENABLED` | on |
| `MONTHLY_BUDGET_GUARD_ENABLED` | on, org-wide; `MONTHLY_BUDGET_USD` raised from 10 to 75 on 15 Nov with Pau's yes, after the cap paused chat for everyone at 09:17 UTC |
| `REWORD_REQUEST` / reword path | paused in the loop (code constant, not an env flag); stays paused |

The loop's own behaviour switches are code, not env vars: everything new sits behind `AGENT_LOOP_ENABLED` plus
`AGENT_LOOP_USERS`, and the chat route never imports `agent-loop/run.ts` for anyone else (tested in
`src/app/api/chat/replay-pack/nov15-agent-loop-switch-off-cases.ts`).

### 5. Review checklist and rules (for every loop PR)

1. Everything new stays behind `AGENT_LOOP_ENABLED` + `AGENT_LOOP_USERS`. The old chat path is untouched; the
   switch-off cases and `flags-off-parity` stay green.
2. **No new word or phrase lists** that read the manager's message or the model's reply. Format parsers (dates,
   money, uuids) are fine. A tool argument the model passes is a **claim**, checked against a real manager turn by
   message id + quote (`evidence.ts`) and against the saved form.
3. Code may refuse a write or hand facts back with a `reason_code`. Code never writes the reply, except the last
   fallback built from saved data.
4. A close spelling of a staff name: **"Did you mean <name>?"** with keep-as-typed offered. Never auto-pick (Pau's
   ruling A, 15 Nov, replaces his 14 Nov auto-pick rule).
5. **Rewording stays paused**: `REWORD_REQUEST`, `REWORD_PAUSED` and the reword path are unchanged.
6. **PR 2b** (`reply_claims` + `verifyReply`) comes **after the pilot**.
7. **Every fix needs a test**: a regression test in the manager's or tester's exact wording (names swapped for
   invented ones), and a replay-pack case. A test for an UNSTATED level or payroll carries no evidence.
8. Invented names only in code, tests, fixtures, commits and PR text. Real names only in private local files and in
   live tests on Pau's account.
9. Bubbles parity: each PR says "Sibling app: ported in … / not needed because …" (Bubbles has no loop yet, so
   loop PRs add a `docs/parity-log/` entry).
10. The app-config snapshot fixtures are re-taken only when the rules text changes on purpose; the diff must show
    only that change.
11. Before merging: base is `main`, CI green on the current head, full SHA, then the deploy checks in 1.

### 6. Pilot checklist

**Done**
- The 11 rebuild PRs (Pau's audit: PR 1, PR 2a, PR 3, PR 4, PR 5, PR 7, plus K, K-keep, J-keep) merged and live.
- Full replay of 266 real chats (15 Nov, $24.67): 0 errors; 4 wrong-person and 1 payroll breach found.
- Targeted re-run of 67 chats (47 that were worse + 20 controls) on `main` with all 11 PRs (16 Nov ~3:50 AM,
  59 of 67 ran, $8.06): wrong person 4 → 1, payroll 1 → 1, forms-on-file false refusals fixed, 0 invented levels,
  0 unasked terminations, 0 future CA dates, 0 regressions in the controls. Person accuracy 39/59 and form type
  44/59: **unchanged**. p50 7.8 s, p90 15.6 s (slower).
- Live re-test on Pau's account (16 Nov ~3:40–3:50 AM, 12 scenarios, cards only, drafts 344 → 344): 9 pass,
  2 fail, 1 needs a ruling (see 7). Median reply 11.4 s, slowest 20.2 s.
- Verdict sent to Pau: **NO-GO for the pilot as it stands** (safer, not yet more useful than today's chat).

**Blocked**
- The 7-item fix batch: waiting on Pau's "fix batch go" (he was at 78% weekly usage).
- The "final warning" ruling: keep asking (QA's recommendation) or add a Final Warning option to the form.
- Pilot managers: Pau picks 2–3; QA adds them to `AGENT_LOOP_USERS` only after a GO.

**Not started**
- The fix batch PRs (item 7 list).
- Re-run of the same 67 chats after the fixes (about $9) and a short live check (4 scenarios).
- `fix-name` save (Coding-7's plan: `form-write` allows `employee_name` only under a verified `correct_name`).
- After the pilot: PR 2b, PR 6 speed (p90 is the worst number), PR 5 D2 (remaining Sun Tan City content into app
  config), PR 7c sf-s cases, payroll amount said in words ("twenty dollars"), the Bubbles port of the loop.

**What I would do next, in order**
1. Verify this file against `gh` and `git` (NEW_QA_START.md).
2. Ask Pau for "fix batch go" and the final-warning ruling.
3. Run the fix batch with two coding sessions (split below), review each PR with the checklist in 5, merge one at
   a time.
4. Runner: the same 67 chats on the new `main` (cap $10). Tester: the 4 failed or flagged live scenarios plus the
   "Did you mean" confirmation, cards only.
5. GO/NO-GO report to Pau with the same guards. On GO, Pau names the pilot managers; QA adds them to
   `AGENT_LOOP_USERS` and watches the first day's chats and runtime errors. Rollback = remove them from the list.
6. Then PR 6 (speed) and PR 2b.

### 7. The fix batch (proposed to Pau, not started)

From the targeted re-run (`c…` ids are masked conversation numbers in the Runner's set) and the live re-test:

1. An exit card was built when nobody asked for one ("ugh <D> quit yesterday, short staffed again"): `exit_evidence`
   must quote an ask for the exit form or a resignation told as such.
2. "final warning CA" gave a Written warning and the reply said "as you said". The form's Type of Warning options
   are Verbal Warning, Written Warning and Termination; there is no Final. Ask which, never claim "as you said"
   (Pau, 30 Oct: "final written" ticks Written; a bare "final warning" asks).
3. c137: after "Did you mean X?", the manager pasted an account naming another person in full, and the loop carded
   X. A reply that names someone else is not a yes.
4. "Did you mean" confirmation: one consistent instruction, and accept the full name typed back (c022: 4 turns, no
   card).
5. c219: an explicit exit request became a Corrective Action; `request_evidence_other_person` misfired; the
   termination level promised at T1 was missing.
6. c124: a bare first name answering "Who is it for?" gets no `find_staff` call; c165: a first name read as an
   acronym.
7. c163: a bare "yes" after "Payroll deduct and warning level aren't set" set payroll.

Also flagged, smaller: live s10 "fix her last name" on an uncreated card changed the card's name without a roster
check; replies say "Dated today" or "on 11/14" when the card has no date; "Observation of Offense" label on a
coaching card; c134 hit the step limit once; c009/c015 now ask "Did you mean" on a one-letter typo of the only
match (safer, one more turn; this is ruling A working as written).

Suggested split: session A items 1, 2, 5, 7 (exit and level/payroll evidence); session B items 3, 4, 6 (names).

### 8. Sessions (on the old account, as of the handoff)

None of these can be reached from the new account. Each has reported; **no session has unfinished work**. Start the
ones you need from `SESSION_STARTERS.md`.

| Session (old id) | Role | Current task | Branch / PR | Exact next step |
|---|---|---|---|---|
| Coding-7 (`session_016JaKhXFS6yvC6Jri2jKKEz`) | coding | none; stood down | owned #1023, #1027, #1026 (incl. #1029), all merged | the `fix-name` draft PR (form-write allows `employee_name` only under verified `correct_name`; update the nov15 fix-name phrasing case; form-write unit test). Not started. |
| Coding-8 (`session_016JaKhUrPD6M8v9ZTUHjQVg`) | coding | none | owned #1010, #1014, #1021, #1022, #1031, Bubbles #927, #929, all merged | none queued. Notes: payroll-5 "twenty dollars" stays open as TODO(amount-words); keep `reason-codes.test.ts` KNOWN in sync; Bubbles needs PR 1a/1c ported later. |
| Coding-5 (`session_016JaKhTsi4LzHDAq4hQhuKW`) | coding | none | #1028, #1037 merged; **#1030 open draft** `claude/account-person-not-subject-main` `0aaa8810`; Bubbles #930, #931, #933 open | merge `main` into #1030, re-run lint/tsc/its tests, mark ready for QA; then check Bubbles #930/#931/#933 against Bubbles main. PR 2b design notes are in the #1037 thread (not started in code). |
| Coding-9 (`session_016JaKhXdxBUGeE91FNVtwrJ`) | coding | none | #1035 merged | none. `claude/agent-loop-batch-k-propose` (`a42091e4`) is scrap (regex approach), safe to delete. |
| Coding-10 (`session_016JaKhW5Jcj5Mg2odsGhuQk`) | coding | none | #1024, #1034 merged | when PR 1 items land, remove the matching `OPEN_UNTIL_PR1` entries; make the fix-name case assert the saved name once `fix-name` lands; assert `not_a_saved_form` in the uncreated-card cases. Skipped by QA: PR 7c sf-s cases, D2. |
| Runner (`session_016JaKhXSCk8KBptKjsvrrnz`) | replay runner | none; idle | **WIP `claude/wip-runner-harness`** (`ad36c0e9` on GitHub: harness code only, no data). A second local commit `11698c9` (the export query with test-account ids replaced by placeholders, and the 67 c-ids) was **not pushed**: the session's permission check stopped it and the Runner asked Pau. | holds the real-chat data privately (see 10). Next: the post-fix re-run of the same 67. If `11698c9` never lands, the new Runner rebuilds the export query from the description in its starter (conversations from 15 Oct to 14 Nov 2026 UTC, excluding the owner's admin and the QA tester accounts, numbered by created_at). |
| Coordinator (`session_016JaKhYY41H3epETaYT6Xrn`) | runs the testers, relays QA's GOs | none; idle | none (its event log `coordinator-notes.md` is local only, no names) | the new coordinator relays the new QA's GOs. Rules: cards only, masked names, check the production alias before every send, clear response bodies only on QA's word. |
| Tester-Sunny (`session_016JaKhV8tdxGo6sBSJ1W8UR`) | live tester (via Coordinator) | idle after the 12-scenario re-test (`loop6`) | **WIP `claude/wip-testers` in Ask-bubbles** (`0ad4b8f3`, `testers/sunny-live/`: 46 helper scripts + README; the login comes from `SUNNY_EMAIL`/`SUNNY_PASSWORD` env vars, never a file) | after the fix batch: re-run s2, s6b, s10 and the test draft A undo with `testers/sunny-live/l6.js` on the new account, then the chat cleanup in 11. |
| Tester-Bubbles (`session_016JaKhYUzCNWnCsrwmzYQTC`) | live tester | idle since round 17z-c | none (helper scripts kept local) | clean up its Bubbles test forms and chats (11); after Bubbles #926/#923/#925 merge, run QA's check list. Open bug F1: a store answer becomes the job title (reached Bubbles draft `acecbd55`). |
| Coding-2 (`session_016JaKhWLadBPbNaRymBRmot`) | coding | paused | #1013 `dcce0153` (`READABLE_NAMES_ENABLED`), Bubbles #928 `26f1bd00`, #1008 `ec9ddc19` (`FIRST_NAME_MUST_FIT_ENABLED`), #1006 `b8d54872` and Bubbles #923 `8792b98f` (`NEXT_PUBLIC_FINALIZED_CHANGE_EVERY_WARNING_ENABLED`); all default off | stay paused. On resume: whole replay packs serially on #1013, #928, #1008 (expect only the intended open cases to change); then #1006/#923: close a termination through the card-change PATCH, add a Demotion note, merge main, whole packs; then a pairing test "create a termination for <name>" in both apps. |
| Gate-Sunny, -2, -3, Gate-Bubbles, -2, -3, -4, -5, Coding-4, Coding-6 | October gate and port sessions | parked since 14 Nov by Pau's pause | the October backlog PRs | do not restart without Pau. |

WIP branches pushed for the handoff: `claude/wip-runner-harness` (ask-sunny, `ad36c0e9`) and `claude/wip-testers`
(Ask-bubbles, `0ad4b8f3`). Every other session reported a clean tree and pushed nothing. Local-only leftovers that
are superseded: Coding-2's `11b0b0b2` ("wip rename", replaced by Bubbles #925), Coding-5's
`claude/agent-loop-batch-k-payroll` (K5, superseded).

### 9. Open questions for Pau

1. "Fix batch go" for the 7 fixes (about 4–5 hours, about $9 re-run), or wait for the usage reset.
2. Final warning: keep "ask which level" (recommended), or add a Final Warning option to the Corrective Action form.
3. Live s10: on a card not yet created, may "fix her last name" change the name on the card (with a roster check),
   or must it refuse like a saved draft?
4. Pilot managers (2–3) for `AGENT_LOOP_USERS`, once GO.
5. Delete the Runner's private real-chat data now, or keep it until the pilot GO (needed for the post-fix re-run;
   the new account can rebuild it from the export query instead).
6. Clean up the 11 live test chats on Pau's account (ids in 10).
7. Who merges the DM L10 PRs (#1043–#1045): the UI session or QA?
8. 🔴🔴 **Change Pau's admin password now**: it was typed inline in Tester-Sunny's command history (it is in no
   file and in nothing pushed). Also change both apps' admin passwords when testing ends.
9. Open items the testers found: Bubbles F1 (a store answer becomes the job title); a future-dated Termination
   11/15/2026 in Sunny's Form Monitoring; the L4 cross-person on-file display (Sunny).
10. Pau's own to-dos: delete stale branches (first-name-close x2, batch-k-propose, batch-k-team,
   pr1b-evidence-gates).
11. The October backlog (about 150 Sunny and 145 Bubbles PRs, paused): keep paused, or have the new QA triage and
   close the superseded ones.

### 10. Risks I am watching

- **Usefulness, not safety, blocks the pilot**: person and form accuracy did not move; the loop gives fewer cards
  than today's chat on hard chats.
- **Speed**: p90 15.6 s in replay, 20.2 s slowest live; managers may give up. PR 6 is the fix.
- **"Did you mean" friction** after ruling A: inconsistent confirmation wording; extra turns on one-letter typos.
- **Parallel PRs on the same loop files** conflict on every merge (tools.ts, run.ts, rules-book, the app-config
  fixtures). Keep the fix batch to two sessions and merge serially.
- **The UI session edits loop files** (#1039) and merges its own PRs to `main` at night.
- **Monthly AI cap** ($75) is org-wide: a busy replay or pilot day can pause chat for everyone. Check spend before
  big runs. Runner's own test budget: about $47.3 of $100 used.
- **Private data on the old account**: `/root/shadow-private/` in the Runner's container (real chats, roster,
  salons, results), scratchpad extracts and `/tmp/loop-live*` with real-name test records, and Tester-Sunny's
  local baseline and response files. They vanish when those containers are reclaimed; delete them on purpose
  first (Pau decides).
- **Test chats to clean up on Pau's account** (live re-test, 16 Nov): `conv_mwi8ozvb2sapwjr`, `conv_mwi8pol124gfpvb`,
  `conv_mwi8qpus2zjn6dy`, `conv_mwi8re6f2qpacbk`, `conv_mwi8ux5723k5i96`, `conv_mwi8vko4202ljit`,
  `conv_mwi8w8ti210g4df`, `conv_mwi8wwja2re9ufq`, `conv_mwi8yfh42t703iq`, `conv_mwi8z75q2s993l4`,
  `conv_mwi90vjq2svkegv`. No draft was created.
- **Snapshot fixtures** must be re-taken whenever the rules text changes on purpose, or `app-config.test` goes red
  on `main` (it did once tonight when two PRs crossed).

### 11. Cleanup list

Test chats and drafts left by the testers. Nothing here was created for a real employee; the drafts use invented
names or the test employee. Clean up on QA's word.

**Ask Sunny, Pau's account (chats):**
- Live re-test `loop6` (16 Nov): the 11 listed in 10.
- `loop5`: `conv_mwhmwf3s28dfcbb`, `conv_mwhmx5rg2a4z04c`, `conv_mwhmys2l2lzrdgv`. `loop4`: `conv_mwhmfxn92dm1asu`.
- `loop3` part 2 (18): `conv_mwhjm8s92f93my1`, `conv_mwhjn2sk2vmj18k`, `conv_mwhjnxfi29ydtyh`, `conv_mwhjos7a2yph5y9`,
  `conv_mwhjpkrf2ul43l7`, `conv_mwhjqecv2wravlg`, `conv_mwhjrroy2c223jq`, `conv_mwhjsqwi256jz6p`, `conv_mwhjticm2ho8dbk`,
  `conv_mwhjuauf2hrz2pv`, `conv_mwhjv2hd2tpedqm`, `conv_mwhjw5vo2nwk2fz`, `conv_mwhjwuxv2ckz7z5`, `conv_mwhjxk4r22f1c05`,
  `conv_mwhjyb3e2wzk6bs`, `conv_mwhjz5j02luqxr4`, `conv_mwhjzyaz2njarnu`, `conv_mwhk103r2wrucnt`.
- Loop part 1 (13): `conv_mwhctzni2avjpy7`, `conv_mwhcuni02scnhvl`, `conv_mwhcvb9h2phe56x`, `conv_mwhcw22w2qsutbw`,
  `conv_mwhcxmjq26j9kx1`, `conv_mwhcz0of277xbcc`, `conv_mwhd5exc2bz9ws7`, `conv_mwhd625528wdw6j`, `conv_mwhd6r992tpbp82`,
  `conv_mwhd7jif2p60yhr`, `conv_mwhd8zw7278atxd`, `conv_mwhdd4nx28wy7iv`, `conv_mwhdez6j25dg6fk`.
- Baselines (14–15 Nov): `conv_mwgcjipt2twttas`, `conv_mwgcl0io2amtyb0`, `conv_mwgclxre27qqw46`, `conv_mwgcnea62luz7u2`,
  `conv_mwgcqu222blbwne`, `conv_mwgd47i92da3qki`, `conv_mwgd5qb422oei3z`, `conv_mwgd6g7522dsbwn`, `conv_mwgd81f52fejcoa`,
  `conv_mwgdd4dk2eoqww6`, `conv_mwgdenk52a0v0x2`, `conv_mwgdfyof21i8t5w`, `conv_mwgdgkdq2alkgsa`, `conv_mwgdhp9x2pjd4k0`,
  `conv_mwgdlhpc2r65pln`. No ids were kept for `loop2` and `loop3` part 1: find them in Pau's History by date.
- Test drafts to delete: `87caa026`, `adba280b`, `90c2b817`, `247d9535`, `cb63856c` (s38k); `e73d8cb1`, `8e418bb6`,
  `483d0367` (s38l). Test draft A (`a3e11f25…`) carries test edits and is kept for the undo re-test; test draft B
  (`b5443119…`) matches its snapshot. Form drafts on Pau's account: 344, unchanged by the loop tests.

**Ask Bubbles, Admin account:**
- Forms under invented names: `acecbd55` (draft), `e4b44064` (FINALIZED 31 Oct: archive, do not delete), `1a8678f9`
  (draft).
- Chats: 17z-c `conv_mwgawsdg2n2b63z`, `conv_mwgayqsv230a7sf`, `conv_mwgbe1tn2f46hr0`, `conv_mwgbg9jj2xqgrj9`,
  `conv_mwgbi6xe2wabthp`, `conv_mwgbjasq26yrbti`, `conv_mwgbn1hn29acta9`, `conv_mwgbpz0n2lvrabr`; 17z-b control
  `conv_mwg6uepd232y922` (5 more, ids lost); 14 Nov `conv_mwg1f5rz2rv8wln`, `conv_mwg1ei5v2opyyz9`,
  `conv_mwg1duct2gq8h46`, `conv_mwg1d5yd2mkpcsa`, `conv_mwg1cib32zrzhku`, `conv_mwg1buls21pu6z2`,
  `conv_mwg1al1w2os92fq`, `conv_mwg19v3h2c39g9j`; r17y `conv_mwftkpf82nkrwoa`, `conv_mwftghzw2o2snvg`. The rest: Admin
  chats from 13 Nov on whose first message names Employee A–E or the invented names.
- **Never touch** Pau's own Bubbles chats `conv_mvw9md0l2xg3td7`, `conv_mvw6ycmv2346ts4`, `conv_mvw6vauj2qpc67c`,
  `conv_mvw6swp328tq6xe`, `conv_mvw6gt7x23c8omq`, or drafts `526274c5` and `69e3e05c`.

**Local files on the old account's containers (they die with the containers; delete on purpose, Pau decides):**
- Runner: `/root/shadow-private/` (real chats, roster, salon names, results), scratchpad extracts, `/tmp/loop-live*`,
  its tool-result files and transcript.
- Tester-Sunny: response bodies (masked), `pages-0.txt` and 4 local scripts holding Pau's own email.
- Tester-Bubbles: 6 loose driver-output files (`o2a`, `o2b`, `o2c`, `o3`, `o3b`, `all.txt`) that may hold chat
  titles with real names.
