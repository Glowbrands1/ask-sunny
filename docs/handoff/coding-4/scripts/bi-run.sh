#!/bin/bash
# usage: bi-run.sh <mode> <previous-mode or ->
S=/tmp/claude-0/-home-user/8434bb36-e5b0-5e70-a507-3dc0859d7025/scratchpad
m=$1; prev=$2
if [ "$prev" != "-" ]; then until [ -f $S/bi-$prev.done ]; do sleep 20; done; fi
case $m in
  off) E="";;
  timings) E="CHAT_STAGE_TIMINGS_ENABLED=true";;
  loads) E="CHAT_PARALLEL_LOADS_ENABLED=true";;
  rewrite) E="CHAT_PARALLEL_REWRITE_ENABLED=true";;
  all) E="CHAT_STAGE_TIMINGS_ENABLED=true CHAT_PARALLEL_LOADS_ENABLED=true CHAT_PARALLEL_REWRITE_ENABLED=true";;
  memoff) E="FLAG_CLASSIFY_ON=CHAT_MEMORY_ENABLED,FEW_SHOT_EXAMPLES_ENABLED,GOOGLE_REVIEWS_IN_CHAT_ENABLED,CHAT_DATA_TOOLS_ENABLED";;
  memloads) E="FLAG_CLASSIFY_ON=CHAT_MEMORY_ENABLED,FEW_SHOT_EXAMPLES_ENABLED,GOOGLE_REVIEWS_IN_CHAT_ENABLED,CHAT_DATA_TOOLS_ENABLED CHAT_PARALLEL_LOADS_ENABLED=true";;
esac
cd $S/sn-bi && env $E REPLAY_RECORD=$S/bi-$m.jsonl npx vitest run src/app/api/chat/replay-pack/replay-pack-e2e.test.ts > $S/bi-$m.log 2>&1
grep -E "Tests " $S/bi-$m.log | tail -1 > $S/bi-$m.done
