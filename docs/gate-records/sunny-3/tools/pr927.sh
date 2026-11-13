#!/bin/bash
S=${GATE_OUT:-/tmp/gate-out}
D=$1; cd /home/user/$D
eval "$(node -e 'const f=require("./src/config/production-flags.json");for(const n of [...f.on,...f.assumedOn])console.log(`export ${n}=true`)')"
rm -f $S/pr927-$D.jsonl; export REPLAY_RECORD=$S/pr927-$D.jsonl
npx vitest run src/app/api/chat/replay-pack/replay-pack-e2e.test.ts > $S/pr927-$D.log 2>&1
echo done > $S/pr927-$D.done
