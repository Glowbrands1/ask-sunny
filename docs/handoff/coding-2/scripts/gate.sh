#!/bin/bash
# usage: gate.sh <repo> <branch>...   (lint, tsc, full npm test per branch in a worktree; never pushes)
S=/tmp/claude-0/-home-user/b97fa10e-6eaa-5e9c-9da6-e819394b0752/scratchpad
repo=$1; shift
for b in "$@"; do
  wt=$S/wt/$(basename $repo)-${b//\//-}
  rm -rf "$wt"; git -C $repo worktree prune
  git -C $repo worktree add -q "$wt" "$b" || { echo "$b WORKTREE-FAIL"; continue; }
  ln -s $repo/node_modules "$wt/node_modules"
  log=$S/gate-$(basename $repo)-${b//\//-}.log
  ( cd "$wt" && echo "== lint" && npm run lint && echo "== tsc" && npx tsc --noEmit -p . && echo "== test" && npm test -- --maxWorkers=2 ) > "$log" 2>&1
  echo "$b exit=$? $(grep -E '^\s+Tests ' "$log" | tail -1)"
done
