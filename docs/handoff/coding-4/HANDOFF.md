# coding 4 — handoff (10 Nov 2026, ~18:30Z, session migration)

Role: coding 4 for Ask Sunny (`Glowbrands1/ask-sunny`) and Ask Bubbles (`Glowbrands1/Ask-bubbles`). I build chat and form fixes behind default-off flags, port them between the apps, and run the replay, eval and byte-identity checks and the prod-env readings. QA directs the work. Coding 2 is the only writer of `server-ask.ts` and `ca-policy.ts`. I never merge or flip flags. The rules are in each repo's CLAUDE.md.

## First thing to do

1. Re-gate the D1 pair, then open its PRs. The heads are on `-wip` branches only:
   - Bubbles `claude/correction-plan-keeps-amount-wip` = `e1d8c889`
   - Sunny `claude/correction-plan-keeps-amount-wip` = `18452e82`

   Steps:
   - Check out the head, run `npm run lint && npx tsc --noEmit -p . && npm test`, and run gates **one at a time**.
   - When green, push it to `claude/correction-plan-keeps-amount` (no `-wip`) and open the PR pair.
   - What it is: CORRECTION_PLAN_KEEPS_AMOUNT. After Create, "change the payroll deduction to $5.00" said "The Action Plan now states the payroll deduction" while the saved plan had none. Live data loss in both apps.
2. Then continue with D3 → D2 → D4 → D5 (below).

## Open PRs (pushed, each at a gated head)

| App | PR | Head | What | Waits on |
|---|---|---|---|---|
| Sunny | #766 | b129218b | SECTION_BREAKS_KEPT: "Also observed:" never split | in the round-23 release head |
| Sunny | #768 | 071b3d6b | ADD_NOT_REPEATED_SENTENCES + in-field guard (QA NO-GO fixed; re-gate asked) | QA re-gate |
| Sunny | #774 | c6ebfc90 | MADE_FOR_IS_MADE_ABOUT | |
| Sunny | #781 | c7850196 | route stage marks (timings only) | |
| Sunny | #789 | 91865f97 | LATE_SLOT_READS_ATTENDANCE (combined with coding 6's #786: green) | |
| Bubbles | #690 | 47c7ef9c | ADD_NOT_REPEATED_SENTENCES + in-field guard (re-gate asked) | QA re-gate |
| Bubbles | #695 | 38a61c78 | CITATION_LINE_KEPT_ON_REVISION (Pau: "Ok revision.ts citation line") | QA adds APPROVED_PROTECTED_EDITS at release |
| Bubbles | #697 | 4bf27350 | MADE_FOR_IS_MADE_ABOUT | #647 |
| Bubbles | #700 | 59df7373 | route stage marks + request clock | #658 |
| Bubbles | #705 | ab2bc8f5 | audit: sf-s16/s17/s19 fixes, h18 dropped | |
| Bubbles | #711 | b5683512 | docs: PRODENV-READING-a529c29e.md | QA merges on green CI |

Live tonight: Sunny #747, #762 (CHAT_PARALLEL_LOADS on), #784 (coding 2's early few-shot, which I verified). Bubbles #680 brought #661; #682 merged.

## Backup-only branches (ungated: re-gate before any PR)

| App | Branch | Head | Content |
|---|---|---|---|
| Bubbles | claude/correction-plan-keeps-amount-wip | e1d8c889 | D1 |
| Sunny | claude/correction-plan-keeps-amount-wip | 18452e82 | D1 port |
| Sunny | claude/section-breaks-tightened-case-wip | a3b37f5c | tightened nov10-section-breaks-not-also-observed. **Never push to #766.** After round 23 is on Sunny main, merge main into #768 and add this tightening there. |
| Sunny | claude/not-following-live-case-wip | 4e268731 | QA's live "make it about not following the dress code" case, on coding 2's NOT_FOLLOWING_IS_VIOLATION (84f86253). Open with prod flags, holds with the flag. |
| Bubbles | claude/made-about-policy-line-replaces-wip | 015cc221 | MADE_ABOUT_POLICY_LINE + REPLACES port, on #647, merged with coding 2's 131400e9. Eight cases open with prod flags, hold with their flags. The PR waits on #647. |
| Bubbles/Sunny | claude/add-not-repeated-leading-sentence-wip | 47c7ef9c / 071b3d6b | the same as #690/#768 now (superseded) |
| Sunny | claude/chat-parallel-loads-marks-wip | 7314eaad | my early server-ask marks, superseded by coding 2's commit (old) |
| Sunny | claude/made-about-topic-and-date-section-breaks-wip | 24a0d23d | section-breaks on the old #747 base, superseded by #766 (old) |
| Bubbles | claude/chat-parallel-loads-deferred-wip | 192839e7 | the Bubbles parallel-loads port QA deferred (old) |

## Queue (in order)

1. D1 PR pair (above).
2. D3 INCIDENT_DATE_SHARED_WITH_STEP (both apps). "…gave her a verbal on 10-21 for being late on 10-21" dates the form today. FORM_EDIT_DATE_RULES skips a step's date even when it is also the incident's. Not started.
3. D2 STEP_SHORTHAND_OWN_DATE. "<name> - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26" is dated today. With no full stop, "coaching 7/1" makes stepSentenceDates take every date. It needs CA_SHORTCUT_WORDS + STEP_DATE_NOT_INCIDENT + STEP_DATES_NOT_FORM_DATE together. Not started.
4. D4 METRIC_ALONE_NOT_A_NAME. "Their Club Close is low. Create a corrective action." drafts a CA for "Club Close". Removing "Club Close" from Bubbles' lists is coding 5's brand scan, not part of D4.
5. D5 FORM_NAME_NOT_A_TITLE. "Create an SDIT EPP for <name> at Store 236" sets Job Title to "SDIT" (TYPED_NAME).
6. ATTENDANCE_ACTION_PLAN replay probe ("violating attendance policy" with no lateness gets the lateness plan).
7. The 217 unread prod-env files: method in PRODENV-READING (per-file ddmin over the production flags first; read closely only what doesn't trace to one intended flag).
8. A per-instance cache for few-shot's global roster read (QA's idea; separate; not started).

Each fix: a new default-off flag, a regression case in the reporter's exact wording (invented names), a replay case on production flags (open, then fixed with fixFlags), the sibling-app check (port it, or add a parity-log entry), lint + tsc + the full gate, then the PR. No protected file without Pau's words via QA.

## Gotchas

- **Full gates one at a time.** In parallel they time out (5 s migration/DOM tests), and one was killed (exit 143).
- **Push only after a green gate**, chained to the gate's exit code.
- Bubbles' replay record has replies + claimed keys only (no prompt hashes or rows). Sunny's records `systems` (sha256 per prompt) and `rows` (user_memory, chat_context_summaries).
- **Forcing flags:** in Bubbles, plain env flags listed in CHAT_QUALITY_FLAG_NAMES are cleared by the pack; force them with `FLAG_CLASSIFY_ON=…`. In Sunny, a flag not in the pack's ALL_FLAGS survives as a plain env var.
- **Sunny eval** (`npm run eval`): a flag can't be both production and the step's (`evals/flags.json` "on"). CHAT_PARALLEL_LOADS is production now, so to eval it, drop it from a local copy of production-flags.json.
- **Prod-env reproduction:** `env -i PATH=… HOME=… NODE_ENV=test $(node -e '…production-flags on+assumedOn…=true') npx vitest run <file>`.
- **"make it for":** Bubbles reads it already via POLITE_ABOUT_STAYS_CARD (on). Sunny's reader is MADE_FOR_IS_MADE_ABOUT.
- **Protected:** revision.ts, chat-revision.ts, proposal.ts, form-proposal.ts, ca-action-plan.ts, glossary.ts and others (see flags-off-parity PROTECTED). The auto-mode classifier blocks edits to APPROVED_PROTECTED_EDITS: QA does those.
- **Never** copy one company's content into the other. "tans" (h18) and "Club Close" were Sun Tan City metrics found in Bubbles.

## Files here

- `scripts/cmp.py`: compares two REPLAY_RECORD jsonl files per (case id, mode): ok, error, turns, rows, systems.
- `scripts/bi-run.sh`: replay records for byte-identity modes (off / timings / loads / rewrite / all / memoff / memloads). Paths point at my old sandbox; adapt them.
- `scripts/bisect.py`, `scripts/ci.sh`: older helpers.
- `probes/*.probe.txt`: vitest probe snippets (rename to `*.test.ts` inside `src/` to run them; remove afterwards).
- `gate-logs/*.txt`: summaries (test counts, exit, FAIL lines) of every gate tonight.
- `PRODENV-READING-a529c29e.md`: the reading (the same as #711).
