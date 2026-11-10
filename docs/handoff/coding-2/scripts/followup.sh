#!/bin/bash
until grep -q RERUN-ALL-DONE /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-rerun.log; do sleep 60; done
bash /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane.sh /home/user/ask-sunny /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-follow.log claude/not-following-is-violation
bash /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane.sh /home/user/Ask-bubbles /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-follow.log claude/not-following-is-violation
bash /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane.sh /home/user/ask-sunny /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-follow.log claude/card-ready-needs-employee
echo FOLLOW-DONE >> /tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad/lane-follow.log
