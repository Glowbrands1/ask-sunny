# Agent loop handoff

Start here: read `CLAUDE.md`, then this file, then `docs/agent-loop/rebuild-plan.md`.
Session starters are in `docs/agent-loop/SESSION_STARTERS.md`. The new QA's first message is in
`docs/agent-loop/NEW_QA_START.md`. Every open agent-loop PR and branch is listed in
`docs/agent-loop/handoff-inventory.md`.

**Scope: the AI agent loop only.** That is `src/lib/ai/agent-loop/`, the chat route's switch into it
(`AGENT_LOOP_ENABLED` + `AGENT_LOOP_USERS`), its replay-pack cases, the replays and live tests of the loop, and
the pilot. The rest of Ask Sunny (today's chat path, forms, the DM L10 pages, the October backlog of default-off
flag PRs) and Ask Bubbles are **not** part of this handoff and are not the new QA's job unless Pau says so.

## QA Success 2 handoff

Written 16 Nov 2026, about 4:30 AM PHT (15 Nov 20:30 UTC), by the outgoing QA ("v2-QA", QA Success 2). The owner
(Pau) is moving to a new Claude account; a new QA on that account takes this job over. During the handoff nothing
was merged, no flag was changed and nothing was redeployed. All times are PHT unless marked UTC.

### 1. The QA role

- **QA is the only session that merges the AI loop's pull requests, changes the loop's Vercel environment variables
  (flags) or redeploys** (`Glowbrands1/ask-sunny`). QA also rolls back, runs live checks of a deploy and writes the
  reports to Pau.
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

Nothing in the agent-loop rebuild is waiting. All 11 rebuild PRs merged today. Open AI-loop items, in order:

| Order | PR | What | Head | CI | Conflicts | Still to check | Blocked by |
|---|---|---|---|---|---|---|---|
| 1 | [ask-sunny#1046](https://github.com/Glowbrands1/ask-sunny/pull/1046) | this handoff (docs only, draft), branch `claude/agent-loop-handoff` | latest on the branch | docs | none | verify against `gh` and `git` (NEW_QA_START.md) | none |
| 2 | (not opened) Fix batch, 7 items, see 7 | loop fixes from tonight's tests | none | none | none | the whole review | Pau's "fix batch go" |
| 3 | (not opened) `fix-name` | `edit_form` intent `correct_name` saves `employee_name` only | none | none | none | the whole review | after the fix batch |
| 4 | [ask-sunny#1015](https://github.com/Glowbrands1/ask-sunny/pull/1015) | docs: terminations in the agent loop | `8cd55154` | docs | check | still accurate after tonight? | none |
| 5 | [ask-sunny#1005](https://github.com/Glowbrands1/ask-sunny/pull/1005) | docs: the loop's Ask Bubbles port list, branch `claude/start-here-oy5rn6` (also holds `rebuild-plan.md`, now copied into #1046) | `af65343d` | docs | check | close or merge after #1046 | none |

Out of scope here (not AI-loop work): every other open PR, including J11 [#1030](https://github.com/Glowbrands1/ask-sunny/pull/1030)
(a default-off flag on today's chat path in `proposal.ts`), Coding-2's paused PRs, the DM L10 pages, the October
backlog and all Ask Bubbles PRs.

### 3. Merged today (15 Nov UTC, which is 15–16 Nov PHT)

Agent loop, merged by QA, in order. Squash SHAs on `main`:

| PR | Merge SHA | What it did |
|---|---|---|
| [#1019](https://github.com/Glowbrands1/ask-sunny/pull/1019) | `e01da172` | G4 follow-up: a description that singles out one form on file opens it |
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
loop itself `6cbf26a4`, then batches A–H: [#996](https://github.com/Glowbrands1/ask-sunny/pull/996) `697b9d1c`,
[#997](https://github.com/Glowbrands1/ask-sunny/pull/997) `4d9478f2`, [#998](https://github.com/Glowbrands1/ask-sunny/pull/998) `1844b2d2`,
[#999](https://github.com/Glowbrands1/ask-sunny/pull/999) `8e913ca5`, [#1000](https://github.com/Glowbrands1/ask-sunny/pull/1000) `60a02ac9`,
[#1001](https://github.com/Glowbrands1/ask-sunny/pull/1001) `37f64f75`, [#1003](https://github.com/Glowbrands1/ask-sunny/pull/1003) `e5691da0`,
[#1002](https://github.com/Glowbrands1/ask-sunny/pull/1002) `fb94ba6b`, [#1009](https://github.com/Glowbrands1/ask-sunny/pull/1009) `f6c3a3ca`,
[#1011](https://github.com/Glowbrands1/ask-sunny/pull/1011) `82d3159f`, [#1016](https://github.com/Glowbrands1/ask-sunny/pull/1016) `e02108c1`.

**Merged into a branch, not into `main` directly:** [#1029](https://github.com/Glowbrands1/ask-sunny/pull/1029)
(PR 1b) was squash-merged into `claude/agent-loop-pr1-evidence-args` (`1485c5b4`), PR 1a's branch, by mistake (its
base was that branch). Its content reached `main` through [#1026](https://github.com/Glowbrands1/ask-sunny/pull/1026)
(`a5deffe5`), so nothing is lost. Verify with `git log origin/main --oneline | grep -i "PR 1a"`.

**Closed without merging:** [#1018](https://github.com/Glowbrands1/ask-sunny/pull/1018) batch J (salvaged as #1028),
[#1007](https://github.com/Glowbrands1/ask-sunny/pull/1007) first-name-close (superseded).

**Loop files changed outside QA's review:** [#1039](https://github.com/Glowbrands1/ask-sunny/pull/1039), merged by
the DM L10 UI session (another account), changed `src/lib/ai/agent-loop/tools.ts` (the CA form key from app config)
and the snapshot fixtures to fix red tests on `main`. It matches the fix in #1034 and #1028, but the new QA should
agree with Pau that other sessions stay out of `src/lib/ai/agent-loop/` and `src/app/api/chat/`. Other merges to
`main` today (L10 pages, today's chat path) are outside this handoff.

### 4. Production state (checked 20:10 UTC, 15 Nov)

- `main` = `020a86043bfe044493285b5334e8ef653d1d5a8d` (an L10 page merged by the UI session during this handoff; it
  was `1882cdb1` when the checks below ran). It contains every loop merge above (last loop merge
  `d57b9fd5`).
- Production deployment `dpl_3hz146q7kEqskx1HDzRW1pFVBDe7`, READY, built from `1882cdb1`, served at
  `https://ask-sunny.vercel.app` (login 200). Runtime errors in the last 2 hours: 0.
- CI on `1882cdb1` (push to main): 14 of 15 jobs green, 1 (`unit-tests`) still running at the time of writing. Check it.
- Vercel project `ask-sunny` (`prj_rhnfXh2VcfnnyMk53MEbyL1yRlkG`, team `team_VMGm91g69rmb8sSWCu6scejJ`). Supabase
  production project `rbkylaavthsjepsczccv`. Never decrypt env values; list names only.

**Loop flags (names only).** Production's on/off list for chat flags is `src/config/production-flags.json` (the
replay pack reads it). The loop's:

| Flag | State |
|---|---|
| `AGENT_LOOP_ENABLED` | on |
| `AGENT_LOOP_USERS` | set to **Pau's own admin account only** (set 14 Nov). No real manager gets the loop. Pilot managers are added here only with Pau's yes. |
| `SELF_CHECK_ENABLED` | off. **Never touch.** |
| `MONTHLY_BUDGET_GUARD_ENABLED` | not a loop flag, but it pauses the loop too: on, org-wide; `MONTHLY_BUDGET_USD` raised from 10 to 75 on 15 Nov with Pau's yes, after the cap paused chat for everyone at 09:17 UTC |
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
9. Each PR's description keeps the repo's "Sibling app" line; Ask Bubbles has no loop yet, so loop PRs add a
   `docs/parity-log/` entry saying so. Porting the loop to Bubbles is not part of this handoff.
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
  config), PR 7c sf-s cases, payroll amount said in words ("twenty dollars").

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
| Coding-8 (`session_016JaKhUrPD6M8v9ZTUHjQVg`) | coding | none | owned #1021, #1022, #1031, all merged | none queued. Notes: payroll-5 "twenty dollars" stays open as TODO(amount-words); keep `reason-codes.test.ts` KNOWN in sync. |
| Coding-5 (`session_016JaKhTsi4LzHDAq4hQhuKW`) | coding | none | #1028, #1037 merged | PR 2b (`reply_claims` + `verifyReply`) **after the pilot**; design notes are in the #1037 thread (about 150 lines in `run.ts`, about 10 replay-case stand-ins, 3 unit test files). Not started in code. |
| Coding-9 (`session_016JaKhXdxBUGeE91FNVtwrJ`) | coding | none | #1035 merged | none. `claude/agent-loop-batch-k-propose` (`a42091e4`) is scrap (regex approach), safe to delete. |
| Coding-10 (`session_016JaKhW5Jcj5Mg2odsGhuQk`) | coding | none | #1024, #1034 merged | when PR 1 items land, remove the matching `OPEN_UNTIL_PR1` entries; make the fix-name case assert the saved name once `fix-name` lands; assert `not_a_saved_form` in the uncreated-card cases. Skipped by QA: PR 7c sf-s cases, D2. |
| Runner (`session_016JaKhXSCk8KBptKjsvrrnz`) | replay runner | none; idle | **WIP `claude/wip-runner-harness`** (`ad36c0e9` on GitHub: harness code only, no data). A second local commit `11698c9` (the export query with test-account ids replaced by placeholders, and the 67 c-ids) was **not pushed**: the session's permission check stopped it and the Runner asked Pau. | holds the real-chat data privately (see 10). Next: the post-fix re-run of the same 67. If `11698c9` never lands, the new Runner rebuilds the export query from the description in its starter (conversations from 15 Oct to 14 Nov 2026 UTC, excluding the owner's admin and the QA tester accounts, numbered by created_at). |
| Coordinator (`session_016JaKhYY41H3epETaYT6Xrn`) | runs the testers, relays QA's GOs | none; idle | none (its event log `coordinator-notes.md` is local only, no names) | the new coordinator relays the new QA's GOs. Rules: cards only, masked names, check the production alias before every send, clear response bodies only on QA's word. |
| Tester-Sunny (`session_016JaKhV8tdxGo6sBSJ1W8UR`) | live tester (via Coordinator) | idle after the 12-scenario re-test (`loop6`) | **WIP `claude/wip-testers`** (in the Ask-bubbles repository, `0ad4b8f3`; Sunny live-test helpers: `testers/sunny-live/`: 46 helper scripts + README; the login comes from `SUNNY_EMAIL`/`SUNNY_PASSWORD` env vars, never a file) | after the fix batch: re-run s2, s6b, s10 and the test draft A undo with `testers/sunny-live/l6.js` on the new account, then the chat cleanup in 11. |

WIP branches pushed for the handoff: `claude/wip-runner-harness` (ask-sunny, `ad36c0e9`) and `claude/wip-testers`
(Ask-bubbles repository, `0ad4b8f3`). Every other session reported a clean tree and pushed nothing. Superseded
local-only leftover: Coding-5's `claude/agent-loop-batch-k-payroll` (K5).

Not listed (outside the loop): Coding-2, Tester-Bubbles, the Gate sessions, Coding-4 and Coding-6.

### 9. Open questions for Pau

1. "Fix batch go" for the 7 fixes (about 4–5 hours, about $9 re-run), or wait for the usage reset.
2. Final warning: keep "ask which level" (recommended), or add a Final Warning option to the Corrective Action form.
3. Live s10: on a card not yet created, may "fix her last name" change the name on the card (with a roster check),
   or must it refuse like a saved draft?
4. Pilot managers (2–3) for `AGENT_LOOP_USERS`, once GO.
5. Delete the Runner's private real-chat data now, or keep it until the pilot GO (needed for the post-fix re-run;
   the new account can rebuild it from the export query instead).
6. Clean up the loop's test chats and drafts on Pau's account (section 11).
7. 🔴🔴 **Change Pau's admin password now**: it was typed inline in Tester-Sunny's command history (it is in no
   file and in nothing pushed). Also change both apps' admin passwords when testing ends.
8. Open items the loop testers found: a future-dated Termination 11/15/2026 in Form Monitoring; the L4 cross-person
   on-file display.
9. Pau's own to-dos: delete stale branches (first-name-close x2, batch-k-propose, batch-k-team,
   pr1b-evidence-gates).

### 10. Risks I am watching

- **Usefulness, not safety, blocks the pilot**: person and form accuracy did not move; the loop gives fewer cards
  than today's chat on hard chats.
- **Speed**: p90 15.6 s in replay, 20.2 s slowest live; managers may give up. PR 6 is the fix.
- **"Did you mean" friction** after ruling A: inconsistent confirmation wording; extra turns on one-letter typos.
- **Parallel PRs on the same loop files** conflict on every merge (tools.ts, run.ts, rules-book, the app-config
  fixtures). Keep the fix batch to two sessions and merge serially.
- **Another session edited loop files** (#1039) and merges its own PRs to `main` at night.
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

Test chats and drafts left by the loop's testers. Nothing here was created for a real employee; the drafts use invented
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

**Local files on the old account's containers (they die with the containers; delete on purpose, Pau decides):**
- Runner: `/root/shadow-private/` (real chats, roster, salon names, results), scratchpad extracts, `/tmp/loop-live*`,
  its tool-result files and transcript.
- Tester-Sunny: response bodies (masked), `pages-0.txt` and 4 local scripts holding Pau's own email.
