# CARD_ADDED_FACT_IN_OBSERVATION (+ CARD_CHECKED_AGAINST_WORDS) — Sunny, head b80cf5bd2 (main 24e0fb74)

Status at FREEZE (23:25Z, 13 Nov 2026): **no final verdict**. Probes and eval done; full 1+1 runs stopped unfinished.

## Done
- Eval 63/63 with the new flag.
- 78-row replay probe (`card-added-fact-78-probes.txt`):
  - CARD_CHECKED off (the rollback state): main and PR give the same result in 78/78 rows.
  - Both flags on: every row with an Added note has Observation = "she was late on 11/3/26; <added>". 0 rows worse than main.
  - Pre-existing reader gaps (identical on main), sent to Coding-6 as a follow-up for both apps:
    - 3a: 14 rows
    - 3b: 7 rows
    - 3c: 3 rows (no "; " join)
    - 3d: 2 rows (fact dropped)
    - NEG: 2 rows (negation added as fact)
- Gate-Sunny-2's 92 sentences + the live hedge wording, shown=true/false, CARD_CHECKED + CLOSE_SPELLING on: 186/186 with the new flag off and on (`card-added-fact-92-probes-flag-on.txt`).
  - With the flag on, all 49 Added rows have Observation = "On 11/3/26 Marnie was late; <exactly the Added text>". No raw turn is left in the line.
  - The Added notes are byte-identical with the flag off and on.
  - shown=false never adds (93/93).
- QA's bar: (1) line = note, (2) never worse than rollback, (3) live case fixed. All three met in the probes.

## Remaining (exact resume step)
1. Worktrees: one on main 24e0fb74, one on origin/claude/card-added-fact-replaces-observation b80cf5bd2. Run `npm ci` once.
2. `nohup tools/run.sh m24e <main-wt> >/dev/null 2>&1 &` and `nohup tools/run.sh xcardON <pr-wt> CARD_ADDED_FACT_IN_OBSERVATION_ENABLED >/dev/null 2>&1 &`.
   CARD_CHECKED_AGAINST_WORDS is already in production-flags.json "on", so both flags are on in xcardON. About 40 min.
3. `python3 tools/cmp.py m24e xcardON $GATE_OUT`.
   - Expected: only the nov13-card-added-fact-in-observation arms change, plus card-checked rows whose Observation becomes "<before>; <added>".
   - If so: **GO for CARD_CHECKED + CARD_ADDED_FACT_IN_OBSERVATION together** (QA's ruling). Send it to QA.

## Verdict (14 Nov 2026, ~01:40Z, v2-Gate-Sunny-3): **GO — CARD_CHECKED_AGAINST_WORDS + CARD_ADDED_FACT_IN_OBSERVATION together**
Head b80cf5bd2 + main efc03f03 (#952 in: CARD_CHECKED out of production-flags.json) merged locally, clean, tsc clean.
Main has since moved to 6620c407 (L10/meetings files only, no chat, form or flag files).
Four full runs, production flags (on + assumedOn):
- mefc (main) → xcardOFF (PR, flags off): only the new case's 2 arms (new). Everything else identical; 0 replay text diffs.
- mefc → xcardON (PR + both flags): 2 OPEN arms now hold (nov13-card-added-fact-in-observation = the live case "she yelled at a guest and she maybe forgot"; nov13-17rc-added-detail-kept-on-card). flags-off-parity replay quarters 1 and 4 fail only on those same arms (the child inherits the env flags; INTENDED-HARNESS). 0 regressions. The woven/safety rows are worktree-path renames.
- Replay text: 10 other records (5 cases × 2 arms: nov5-coding3-sfo-a-coworker, nov6-diffemp-guard ×2, nov8-policy-set-aside-stays-off, nov8-proposal-make-it-about-negative). Each one changes the Observation from "<before> <raw turn>" to "<before>; <added>" with the Added line. Nothing else changed; system prompts identical.
- mCC (main + CARD_CHECKED alone = the rolled-back state) → xcardON: the same 10 records + the 2 cases.
- Invariant over every replay record: in rows with an "Added to the Observation of Offense" line, the Observation line ends "; <exactly the note>":
  - main + CARD_CHECKED: 0/24 (the live bug);
  - PR + both flags: 28/28.
- Eval: 63/63 with both flags; 0 of 41 eval rows change outcome.
QA's bar: (1) line = note: 28/28; (2) never worse than the rollback: 0 regressions; (3) live case fixed.
To do before landing: confirm v2-Coding-6's pushed head (main merge) has the same tree as this local merge.
