# Replay eval

`npm run eval` replays every case in `replay_set.json` through the real chat
route (`POST /api/chat`), turn by turn, and scores the card it ends on. CI runs
it on every pull request (`.github/workflows/ci.yml`, job `eval`).

Each case runs twice:

| Column | Flags | Rule |
|---|---|---|
| Flags off | `src/config/production-flags.json` → `on` + `assumedOn` (today's app) | Must equal `baseline.json` exactly, case by case |
| Flags on | the same, plus `flags.json` → `on` (the step's own flag) | No case that passes off may fail on; at most 25% slower in total (+100 ms noise floor) |

Every case runs 3 times per column; each run must judge the same (the replay is
deterministic) and the time is the median run.

## What it can and cannot see

Local and deterministic: an in-memory database (`src/test/fake-supabase.ts`), a
fixed clock, the JBA manual fixture, and neutral model stand-ins (the
extraction model reads nothing, the drafting model writes nothing, the answer
is "A grounded answer."). So it scores **the app's own code** — the answer
cascade, name and salon checks, the card — not a live model, and its
milliseconds are the code's, not a real turn's (a real turn is dominated by the
model call).

## Files

- `replay_set.json` — the cases: `turns` (the manager's words, verbatim),
  `criteria` (the card's employee, salon `loc-<salon number>`, date, `"<heading> p.<page>"`
  policy, and two checks; `null`/`false` is not judged), optional `today`,
  `roster` (people on the Woven-synced directory) and `actor` (role and scope;
  default: owner, global).
- `baseline.json` — the flags-off result of every case on the base branch.
  Failing cases are recorded as failing; that is the baseline, not a pass.
- `flags.json` — `on`: the step's flag(s). Today's production flags are read
  from `src/config/production-flags.json`, which QA keeps in step with Vercel.
- `replay-harness.ts` — the judge, baseline comparison and timing (pure);
  `judge.eval.ts` tests it.
- `results/latest.json`, `results/latest.md` — the last local run (git-ignored).

## Changing the baseline

`EVAL_UPDATE_BASELINE=1 npm run eval` rewrites `baseline.json`. Only when a
flags-off result is meant to change (a new case, or a fix that is already live),
and the pull request says why.
