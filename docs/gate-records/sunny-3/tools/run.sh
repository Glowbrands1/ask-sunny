#!/bin/bash
# usage: run.sh <label> [extra flag...]
S=${GATE_OUT:-/tmp/gate-out}
L=$1; shift; D=$1; shift
cd $D
eval "$(node -e 'const f=require("./src/config/production-flags.json");for(const n of [...f.on,...f.assumedOn])console.log(`export ${n}=true`)')"
for x in "$@"; do export $x=true; done
export FLAG_CLASSIFY_ON=$(IFS=,; echo "$*")
rm -f $S/$L.jsonl; export REPLAY_RECORD=$S/$L.jsonl
npx vitest run --reporter=json --outputFile=$S/$L.json > $S/$L.log 2>&1
echo "$L exit $?"
