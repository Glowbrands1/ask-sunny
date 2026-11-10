#!/bin/bash
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
cd $S/wt/Ask-bubbles-r16c || exit 1
[ -e node_modules ] || ln -s /home/user/Ask-bubbles/node_modules node_modules
npm run lint >$S/r16c-lint.log 2>&1; echo "lint=$? errors=$(grep -c ' error ' $S/r16c-lint.log)"
npx tsc --noEmit -p . >$S/r16c-tsc.log 2>&1; echo "tsc=$?"
npm test -- --maxWorkers=3 >$S/r16c-test.log 2>&1; t=$?; echo "test=$t $(grep -E '^\s+Tests ' $S/r16c-test.log | tail -1)"
npm run eval >$S/r16c-eval.log 2>&1; e=$?; echo "eval=$e $(grep -E '^\s+Tests ' $S/r16c-eval.log | tail -1)"
rm -f node_modules
if [ $t = 0 ] && [ $e = 0 ]; then
  git fetch -q origin claude/gate-bubbles-r16c
  git merge-base --is-ancestor origin/claude/gate-bubbles-r16c HEAD || { echo "R16C-NOT-FF"; exit 1; }
  for i in 2 4 8 16; do git push -u origin claude/gate-bubbles-r16c && { echo "PUSHED-R16C $(git rev-parse --short HEAD)"; exit 0; }; sleep $i; done
fi
echo R16C-NOT-PUSHED
