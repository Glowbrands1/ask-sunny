# Gate harness (Ask Sunny)

Dev-only helpers for the pre-flip 3+3 gate. Nothing here runs in CI or touches a model, a database or Vercel. Every child run uses a clean env (PATH, HOME, TMPDIR, LANG, NODE_ENV=test).

These scripts come from the Ask Bubbles harness (Glowbrands1/Ask-bubbles#556). Ask Sunny's own round 1–3 scripts were never pushed and were lost with their container. Changes for this app:
- `scan.py` flags the sibling app's company words (Buff City Soap, Ask Bubbles, "store manager"), not this app's. It also lists lost Policy lines: a turn whose OFF reply has `Policy:` and whose ON reply does not.
- `bisect.sh` replaces `bisect5.sh`/`bisect-r3.sh`. It runs one flag, or one unit (comma-separated flags that ship together), alone on top of the OFF flags.
- Round-4 additions: `run.sh` (one full OFF/ON run), `classify-pair.py` (test-status and replay-record diff of OFF-1 vs ON-1), `solo.py` (attribute every changed row to a solo run), `recdiff.py` (paragraph diff of the changed records per solo run), `classify-confirm.py` (the 3+3: flaky rows and records, changed rows, record diff). They read `GATE_R` (the run dir) and `GATE_TREE`.

## Fast path used for Sunny round 4 (no kept dir)
1. `GATE_TREE=<worktree> GATE_R=<run dir>`. In `$GATE_R` put `off-flags.txt` (OFF flags not in production-flags.json: CHAT_GLOSSARY, flips not yet merged) and `on-flags.txt` (OFF + the candidates), one `_ENABLED` name per line, and copy `run.sh` there.
2. `printf 'off 1\non 1\n' > jobs.txt; (cd $GATE_R; xargs -P 2 -L 1 ./run.sh < jobs.txt)` writes `off-1.json`, `off-1.replay.jsonl`, `on-1.*`. About 12 min per run with `--project unit`.
3. `python3 -I classify-pair.py $GATE_R`, then `bisect.sh <unit>` per flag or unit over the changed files (`files.txt`), then `solo.py` and `recdiff.py`.
4. After dropping the regressors, run the confirm (`on2-flags.txt`, jobs `off 2`, `on2 1`, ...) and `classify-confirm.py`.
- **`--project unit` is required.** The repo has a separate `flags-off-parity` vitest project; the CLI `--exclude` does not reach it, and its nested runs inherit your flags (it fails in OFF too and adds about 16 min).
- **Use absolute paths in run scripts.** A relative `$0` resolves after the `cd` into the tree: the flag lists silently load as empty (OFF and ON both run with no flags) and the output lands in the tree.
- **Check the env of a running worker:** `tr '\0' '\n' < /proc/<pid>/environ | grep -c '_ENABLED=true'` should equal the flag-list length.
- **Keep the session active while a run goes** (a foreground wait loop, not a background job and an idle turn): the container restarted twice while the session was idle.

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
