#!/bin/bash
while pgrep -f "scratchpad/lane.sh" > /dev/null; do sleep 60; done
awk '!seen[$0]++' /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/rerun-queue.txt | while read repo b; do bash /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane.sh /home/user/$repo /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-rerun.log $b; done
echo "RERUN-ALL-DONE" >> /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-rerun.log
