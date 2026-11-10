#!/bin/bash
# usage: evalone.sh <worktree> <FLAG> <out>
cd "$1" || exit 1
cp evals/flags.json /tmp/claude-0/sp/ef-$(basename $1).bak
python3 -c "
import json,sys;p='evals/flags.json';d=json.load(open(p));d['on'].append(sys.argv[1]);json.dump(d,open(p,'w'),indent=2)" "$2"
timeout 3000 npm run eval > "$3" 2>&1
cp /tmp/claude-0/sp/ef-$(basename $1).bak evals/flags.json
echo "== $1 $2: $(grep -E 'Tests ' $3) diffs: $(grep -E '^\| ' $3 | awk -F'|' '{a=$3;b=$4;gsub(/ [0-9]+ms/,"",a);gsub(/ [0-9]+ms/,"",b); if(a!=b) print $2}' | grep -v Case | tr '\n' ' ') fails: $(grep -c FAIL $3)"
