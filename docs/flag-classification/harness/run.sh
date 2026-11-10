#!/bin/bash
# run.sh off|on N  -> $R/<mode>-N.json + .replay.jsonl
R=$(cd "$(dirname "$0")" && pwd); MODE=$1; N=$2; cd "${GATE_TREE:?}"
FL=$(grep -v '^\s*$' $R/$MODE-flags.txt | tr '\n' ' '); ENVS=$(for f in $FL; do echo -n "$f=true "; done); ON=$(echo $FL | tr ' ' ',')
rm -f $R/$MODE-$N.replay.jsonl
env -i PATH=$PATH HOME=$HOME TMPDIR=$R/tmp LANG=C.UTF-8 NODE_ENV=test $ENVS FLAG_CLASSIFY_ON=$ON REPLAY_RECORD=$R/$MODE-$N.replay.jsonl \
  node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=$R/$MODE-$N.json --project unit --maxWorkers=2 \
  --exclude src/lib/ai/flags-off-parity.test.ts --exclude '**/node_modules/**' src/lib/ai src/lib/forms src/app/api/chat src/app/api/forms > $R/$MODE-$N.log 2>&1
echo "$(date +%T) $MODE-$N exit $?" >> $R/progress.log
