#!/bin/bash
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
for repo in /home/user/ask-sunny /home/user/Ask-bubbles; do
  out=$($S/gate.sh $repo claude/roster-name-set); echo "$repo $out"
  if echo "$out" | grep -q "exit=0"; then
    ok=0; for i in 2 4 8 16; do git -C $repo push -u origin claude/roster-name-set && { echo "PUSHED-B5 $repo"; ok=1; break; }; sleep $i; done
    [ $ok = 1 ] || echo "B5-PUSH-FAIL $repo"
  else echo "B5-NOT-PUSHED $repo"; fi
done
