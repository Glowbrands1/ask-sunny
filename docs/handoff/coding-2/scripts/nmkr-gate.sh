#!/bin/bash
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
out=$($S/gate.sh /home/user/Ask-bubbles claude/near-miss-answer-keeps-request); echo "$out"
if echo "$out" | grep -q "exit=0"; then
  for i in 2 4 8 16; do git -C /home/user/Ask-bubbles push -u origin claude/near-miss-answer-keeps-request && { echo PUSHED-NMKR; exit 0; }; sleep $i; done
fi
echo NMKR-NOT-PUSHED
