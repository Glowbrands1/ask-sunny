#!/bin/bash
# usage: lane.sh <repo> <log> <branch>...
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
repo=$1; log=$2; shift 2
for b in "$@"; do
  r=$($S/gate.sh $repo $b)
  echo "$repo $r" >> $log
  if echo "$r" | grep -q "exit=0" && ! echo "$r" | grep -qE "[0-9]+ failed"; then
    (cd $repo && git push -u origin $b 2>&1 | tail -1) >> $log
    echo "PUSHED $repo $b" >> $log
  else
    echo "NOT-PUSHED $repo $b" >> $log
  fi
done
echo "LANE-DONE $repo" >> $log
