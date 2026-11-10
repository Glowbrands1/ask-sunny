#!/bin/bash
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
for repo in /home/user/Ask-bubbles /home/user/ask-sunny; do
  out=$($S/gate.sh $repo claude/typo-corrected-same-person); echo "$repo $out"
  if echo "$out" | grep -q "exit=0"; then
    ok=0; for i in 2 4 8 16; do git -C $repo push -u origin claude/typo-corrected-same-person && { echo "PUSHED-TCSP $repo"; ok=1; break; }; sleep $i; done
    [ $ok = 1 ] || echo "TCSP-PUSH-FAIL $repo"
  else echo "TCSP-NOT-PUSHED $repo"; fi
done
