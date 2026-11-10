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
  from `src/config/production-flags.json` (`on` + `assumedOn`), which QA keeps
  in step with Vercel. `assumedOn` is QA's reading of flags Vercel shows
  encrypted — taken as on, not confirmed — so a baseline change after QA edits
  that file is a change in what production is believed to run, not in code.
- `replay-harness.ts` — the judge, baseline comparison and timing (pure);
  `judge.eval.ts` tests it.
- `results/latest.json`, `results/latest.md` — the last local run (git-ignored).

## Changing the baseline

`EVAL_UPDATE_BASELINE=1 npm run eval` rewrites `baseline.json`. Only when a
flags-off result is meant to change (a new case, or a fix that is already live),
and the pull request says why.

### Baseline changes

- **10 Nov 2026, s25, b9, n1, n3: criteria follow Pau's 5 Nov 2026 rulings (changed on purpose; QA, the roster-name
  set ask-sunny #741).** `flags.json` lists the set's flags that are not yet in production, so the flags-on column is the
  set. s25 ("create a corrective action form for Dasiley Veklo", then "Yes"): the card takes the roster's spelling,
  **"Daisley Veklo"**, not the typo. b9 and n1 ("Test Employee", a name with "employee" in it) and n3 ("name is TT …",
  bare initials): no employee on the card, and the reply asks **"Who is this form for?"** (`replyIncludes`; the
  question is expected, so `noBlockingQuestion` is false). With production's flags (the flags-off column) all four now
  fail, which is what `baseline.json` records; with the set on all four pass. Their 23–25 Oct criteria are superseded by
  those rulings. The priority replay fixture (`src/lib/ai/__fixtures__/replay_set.json`) keeps the old criteria: it
  measures production's flags (`judge.eval.ts` lists the four as ruled). Every other case is as it was.
- **7 Nov 2026, s9: card employee null, "employee" and "blocking question" misses (changed on purpose; judge
  unchanged).** QA's flips of 5 and 6 Nov are now in `production-flags.json` (ask-sunny #609), and
  METRIC_GUARD_ENABLED (#570) runs the lowercase-nobody guard (`forms/answer-not-a-name.ts`) with FORM_NAME off too.
  So "create a CA form for ima employee, …", where "ima" is nobody on s9's roster, no longer puts "Ima" on the card;
  the reply asks who the form is for. That is Pau's 5 Nov 2026 ruling: only roster people go on the card, and "ima
  employee" with no roster match asks who (replay `nov5-roster-only-ima-*`). **s9's criteria from 23 Oct (employee
  "Ima", no blocking question) are superseded** by that ruling. s9 is the only changed row; every other case is as it
  was. With FORM_NAME on later, the off-roster "use <name>" offer follows.
- **3 Nov 2026, s20 and s28: "blocking question" added (judge unchanged).**
  SAME_ASK_NO_REPEAT is on in production. When a card repeats an unanswered
  question, it now begins "I still need to know who this is for …" (s20, after
  "Who is it for?") or "… which location this is about …" (s28, after "Which
  salon is this about?"). Both replies already ended on that unanswered
  question; the judge's regex did not match those wordings and does match
  "^I still need". The cards are unchanged (needs_employee, needs_location).
  b10 and b12 (a card shown again that asks nothing) get no note and still
  pass. See ask-sunny #486.
