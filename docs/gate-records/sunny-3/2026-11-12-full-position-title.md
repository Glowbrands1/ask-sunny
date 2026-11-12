# Gate-Sunny-3 — FULL_POSITION_TITLE_ENABLED (flag only) — GO

- Base: Sunny main `a5b96f4d` (the code is on main; flag-only gate)
- Flag: `FULL_POSITION_TITLE_ENABLED`
- Method: 1 OFF + 1 ON, full `npx vitest run`, with production's flags (`src/config/production-flags.json`
  `on` + `assumedOn`) in the env, so unit tests that assume default-off flags fail in both arms. The ON arm adds the
  flag to the env and to `FLAG_CLASSIFY_ON`, so the replay pack and flags-off-parity's child runs carry it.
  Replay text recorded with `REPLAY_RECORD`.

## Results

| | tests | passed | failed |
|---|---|---|---|
| OFF | 21,797 | 20,404 | 1,259 |
| ON  | 21,797 | 20,402 | 1,261 |

Test status changes OFF → ON: 2 real changes (the other 12 are the same Woven safety test titled by worktree path).

| Test | OFF → ON | Class |
|---|---|---|
| replay pack `nov6-coding3-full-position-title-negative` — OPEN in production (`it.fails`) | passed → failed | INTENDED: the case now holds, so its `it.fails` arm fails. Move it to `status: "fixed"` when QA flips the flag. |
| flags-off-parity: replay pack, first half of the cases by id | passed → failed | INTENDED-HARNESS: the same case, in parity's child run (it carries `FLAG_CLASSIFY_ON`) |

Replay text, OFF vs ON (1,585 records): **1 differs**, `nov6-coding3-full-position-title-negative` (open arm), and
the system prompts are the same. The one change is that the exit card gains `- **Job Title:** Tanning Consultant`
("Tanning Consultant Weekends Only" is read as the position, not as the title's owner). INTENDED. Nothing else
changed: 0 REGRESSION.

Eval (`npm run eval`, `evals/flags.json` on = `FULL_POSITION_TITLE_ENABLED`): 63/63, and no case changes outcome off
vs on (the same 8 baseline failures in both columns). Latency p50/p95: off 168/930 ms, on 160/889 ms.

## Verdict

**GO.** The open case that now holds is `nov6-coding3-full-position-title-negative`.
