#!/bin/bash
# Solo runs: the OFF env plus one flag, or one UNIT (comma-separated flags that ship together), per run.
#   GATE_TREE=<worktree> GATE_R=<run dir> bisect.sh <unit>
# Needs in $GATE_R: off-flags.txt (the OFF flags not already in production-flags.json, one per line) and
# files.txt (the test files to run: the changed files from classify-pair.py, without flags-off-parity).
# Writes $GATE_R/bis/<name>.json/.jsonl. Three at a time:
#   (cd $GATE_R; GATE_TREE=... xargs -P 3 -d '\n' -L 1 ./bisect.sh < units.txt)
set -u
R=${GATE_R:?set GATE_R}; U=${1:?unit}; cd "${GATE_TREE:?set GATE_TREE}"
N=$(echo "$U" | tr ',' '\n' | head -1 | sed 's/_ENABLED//')$( [ "$(echo $U | tr ',' '\n' | wc -l)" -gt 1 ] && echo "+unit"); mkdir -p $R/bis $R/tmp-$N
BASE=$(grep -v '^\s*$' $R/off-flags.txt | tr '\n' ' '); UF=$(echo "$U" | tr ',' ' ')
ENVS=$(for f in $BASE $UF; do echo -n "$f=true "; done); ON=$(echo $BASE $UF | tr ' ' ',')
env -i PATH=$PATH HOME=$HOME TMPDIR=$R/tmp-$N LANG=C.UTF-8 NODE_ENV=test $ENVS FLAG_CLASSIFY_ON=$ON REPLAY_RECORD=$R/bis/$N.jsonl \
  node node_modules/vitest/vitest.mjs run --project unit --reporter=json --outputFile=$R/bis/$N.json --maxWorkers=1 --exclude '**/node_modules/**' $(cat $R/files.txt) > $R/bis/$N.log 2>&1
echo "$(date +%T) $N exit $?" >> $R/bis/progress.log
