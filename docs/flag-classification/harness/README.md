# Gate harness (Ask Sunny)

Dev-only helpers for the pre-flip 3+3 gate. Nothing here runs in CI or touches a model, a database or Vercel. Every child run uses a clean env (PATH, HOME, TMPDIR, LANG, NODE_ENV=test).

These scripts come from the Ask Bubbles harness (Glowbrands1/Ask-bubbles#556). Ask Sunny's own round 1–3 scripts were never pushed and were lost with their container. Changes for this app:
- `scan.py` flags the sibling app's company words (Buff City Soap, Ask Bubbles, "store manager"), not this app's. It also lists lost Policy lines: a turn whose OFF reply has `Policy:` and whose ON reply does not.
- `bisect.sh` replaces `bisect5.sh`/`bisect-r3.sh`. It takes the base flags, the flags to try alone and, optionally, the test files as arguments, instead of hard-coded file names.

## Set up
- Make a detached worktree at the exact sha or tree QA names: `git worktree add --detach <dir> <sha>`. Then `ln -s <repo>/node_modules <dir>/node_modules`, after checking that `package-lock.json` matches. If it does not match, run `npm ci` in the worktree.
- `export GATE_TREE=<dir> GATE_SCRATCH=<a scratch dir>`. Run everything from `$GATE_TREE`.
- **Preview tree:** start from the base sha. For each PR in QA's order, run `git fetch origin pull/N/head && git merge --no-edit FETCH_HEAD`. On a conflict, run `git merge --abort` and record the PR and its files. Report `git rev-parse HEAD^{tree}`.
- **Flag check:** for each PR, run `git diff <base>...pr-N -- src/lib/config/chat-quality-flags.ts | grep envFlag`. Also grep non-test `src/` for `_ENABLED`, because some PRs reuse a flag instead of adding one. Every ON flag must exist in `chat-quality-flags.ts`.

## The 3+3 gate
- `flag-classify-gate.ts` is this app's `scripts/flag-classify.ts` plus one addition: `GATE_NAME` sets the output name.
- `flag-classify-reuse.ts` adds `REUSE_OFF=<a kept dir>`. It copies `off-N.json` and `off-N.replay.jsonl` from a run with an identical tree and OFF instead of running OFF again.
- Command:

```bash
GATE_NAME=R4 TMPDIR=$GATE_SCRATCH/tmp-x node <harness>/flag-classify-gate.ts \
  --flag <FIRST> --and <REST,comma> \
  --with CHAT_GLOSSARY_ENABLED[,<live flags not yet in production-flags.json>] \
  --runs 3 --keep src/lib/ai src/lib/forms src/app/api/chat src/app/api/forms
```

- **OFF** = `src/config/production-flags.json` (the replay pack forces its "on" list true) + `--with`. **ON** = OFF + `--flag`/`--and`.
- An env var cannot turn off a flag that the file lists as on. To get an OFF run without that flag, move it to "off" in the worktree's copy of the file, leave the change uncommitted, and say so in the report.
- Seed `docs/flag-classification/<NAME>.classes.json` from earlier gates, without their REGRESSION rows. Seeds are hints: re-read every changed row.
- `--keep` leaves the kept dir (`off-N.json`, `on-N.json`, `*.replay.jsonl`) in TMPDIR. All the scripts below read it.

## Classify, bisect, scan
- **show.py** `<kept dir> <case id …>`: prints the OFF and ON turns of each case, in [production] mode.
- **bisect.sh** `<base-flags.txt> <flags.txt> [files.txt]`: runs each flag alone (the OFF env plus that flag, one run each). Set `GATE_BISECT=<dir>` to choose where the results go. To run 3 at a time, split `flags.txt` and give each copy its own `GATE_BISECT`.
- **attrib5.py** `<kept dir> <bisect dir> <flags file> <NAME.md> <out.json>`: for each changed row, finds the flag or flags whose solo run reproduces it. A row that no single flag reproduces is an interaction: run groups of flags, then minimize.
- **minimize.py** `<test file> <-t pattern> test|record <test substring | "id [mode]"> <off jsonl|-> FLAG,FLAG,…`: removes flags one at a time, keeping the smallest set that still reproduces one change.
- **Solo scan:** compare each shipped flag's solo run against OFF for passed→failed rows that the combined run hides. A partner flag can mask a regression (for example SALES_SHORTFALL_OBJECT without SALES_OBSERVATION_ACCOUNT).
- **scan.py** `<kept dir>`, the record scan, flags:
  - empty replies
  - artifact strings (undefined, null, NaN, `<name>`, `{{`)
  - scrubbed app words, "applicable company policy", 401k or retirement text, streamed envelopes, the other company's words
  - offered names ("use **X**") per run, which must be the same in every run
  - lost Policy lines (OFF vs ON, pair by pair)
- **Also check in the records:**
  - the same question asked twice in a row (is it new in ON?)
  - new "draft … for" names, an Issue that starts with at/on/for
  - a card with no employee and no "who is this for?"
  - the completion check: the off-roster and offer records are ok, an offer with a follow-up ends READY, and no near-miss name is offered with "use"
- **Hang:** if a replay file stops growing, run `kill -USR1 <worker pid>`, attach the inspector (`ws://127.0.0.1:9229/<id>`) and print the stack.

## Classes
- **INTENDED**: an OPEN case that now holds, or a reply that changes the way the flag is meant to change it (read the reply).
- **INTENDED-HARNESS**: a flag's own "off"/"(main)" pin, a byte or prompt identity test, or a test whose "off" half assumes an unset env.
- **REGRESSION**: lost content (a Policy line, an Observation, a card, an answer) or an unrelated suite breaking. Bisect it to the single flag that causes it.
- **FLAKY** is automatic: a result that differs between runs of the same mode. **UNCLASSIFIED**: nothing ships until it is 0.
- Bar: 0 REGRESSION, 0 UNCLASSIFIED, 0 FLAKY, plus a clean solo scan.

## Limits
- A 3+3 takes about 40–45 min on 4 cores. Run one heavy job at a time: two at once caused spawn timeouts.
- The replay pack stubs the models, so a clean gate does not prove the live model path. CA_REQUEST_NOT_PRIOR_COACHING held in replay and was rolled back live. A flag that changes how a request is read, or model-facing routing, needs a live AI check (`LIVE=1`), or a replay case built from the live reply.
- Fixtures and reports use invented names only (see `src/lib/security/no-real-people.test.ts`).
