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
