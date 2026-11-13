#!/bin/bash
S=${GATE_OUT:-/tmp/gate-out}
cd /home/user/gtri
PF=$(node -e 'const f=require("./src/config/production-flags.json");console.log([...f.on,...f.assumedOn].map(n=>n+"=true").join(" "))')
for p in 867 894 872 909 910 914 912 662 899; do
  git checkout -q . ; git clean -fdq src/app/api/chat/replay-pack/
  files=$(cd /home/user/ask-sunny && git diff --name-only --diff-filter=A $(git merge-base origin/main pr/$p) pr/$p -- 'src/app/api/chat/replay-pack/*-cases.ts')
  ids=""; for f in $files; do (cd /home/user/ask-sunny && git show pr/$p:$f) > $f; ids="$ids $(grep -oE 'id: "[^"]+"' $f | sed 's/id: "//;s/"//' | tr '\n' ' ')"; done
  pat=$(echo $ids | tr ' ' '\n' | grep -v '^$' | paste -sd'|')
  env $PF npx vitest run src/app/api/chat/replay-pack/replay-pack-e2e.test.ts -t "($pat):" --reporter=json --outputFile=$S/tri2-$p.json > /dev/null 2>&1
done
git checkout -q . ; git clean -fdq src/app/api/chat/replay-pack/
echo done > $S/tri2.done
