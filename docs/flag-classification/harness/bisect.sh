#!/bin/bash
# Solo runs: the OFF env plus one flag at a time, one vitest run per flag.
#   GATE_TREE=<worktree> GATE_SCRATCH=<dir> bisect.sh <base-flags.txt> <flags.txt> [files.txt]
# base-flags.txt: the OFF flags not yet in production-flags.json (CHAT_GLOSSARY + live flips), one per line.
# flags.txt:      the flags to try alone.  files.txt (optional): test files to run; default = the four gate paths.
# Parallel: split flags.txt and start up to 3 copies with different GATE_BISECT dirs, or use xargs -P 3 on one-flag files.
set -u
BASEF=${1:?base flags file}; FLAGS=${2:?flags file}; FILES=${3:-}
S=${GATE_SCRATCH:?set GATE_SCRATCH}; B=${GATE_BISECT:-$S/bisect}; mkdir -p $B/tmp; cd "${GATE_TREE:?set GATE_TREE}"
BASE=$(grep -v '^\s*$' "$BASEF" | tr '\n' ' ')
if [ -n "$FILES" ]; then TARGETS=$(cat "$FILES"); else TARGETS="src/lib/ai src/lib/forms src/app/api/chat src/app/api/forms"; fi
for F in $(grep -v '^\s*$' "$FLAGS"); do
  [ -s $B/$F.json ] && continue
  ENVS=$(for f in $BASE $F; do echo -n "$f=true "; done); ON=$(echo $BASE $F | tr ' ' ',')
  env -i PATH=$PATH HOME=$HOME TMPDIR=$B/tmp LANG=C.UTF-8 NODE_ENV=test $ENVS FLAG_CLASSIFY_ON=$ON REPLAY_RECORD=$B/$F.jsonl.part \
    node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=$B/$F.json.part --maxWorkers=2 \
    --exclude src/lib/ai/flags-off-parity.test.ts --exclude '**/node_modules/**' $TARGETS >/dev/null 2>&1
  mv $B/$F.jsonl.part $B/$F.jsonl; mv $B/$F.json.part $B/$F.json; echo "$(date +%T) $F done" >> $B/progress.log
done
echo ALLDONE >> $B/progress.log
