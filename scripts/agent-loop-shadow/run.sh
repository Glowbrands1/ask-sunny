#!/usr/bin/env bash
# SHADOW REPLAY of the agent loop (QA, 14 Nov 2026; dev only, never CI; Pau approved). Real managers' past chats from a
# PRIVATE JSON-lines file are replayed through the loop with the REAL model, offline: the replay pack's store is in
# memory and nothing is saved. NEVER commit the input or the output; keep both outside the repository.
#
#   ANTHROPIC_API_KEY="$AI_READER_KEY" SHADOW_IN=/private/shadow-in.jsonl SHADOW_OUT=/private/shadow-out.jsonl \
#     [SHADOW_ROSTER=/private/roster.json] [SHADOW_LIMIT=20] [SHADOW_SHARDS=3] scripts/agent-loop-shadow/run.sh CAP_DOLLARS
#   python3 scripts/agent-loop-shadow/summary.py /private/shadow-out.jsonl
#
# The run stops when the model cost reaches CAP_DOLLARS (scripts/agent-loop-live/costcap.py). SHADOW_LIMIT keeps the
# first n conversations. SHADOW_ROSTER is a shared roster (a JSON array of roster rows) for lines with no "roster".
# The loop's calls and tokens go to "${SHADOW_OUT%.jsonl}.records/run-*.jsonl".
# SHADOW_STANDIN=1 runs the scripted stand-in model instead (no API key, no live calls): scripts/agent-loop-shadow/self-test.sh.
set -euo pipefail
cap="${1:?usage: run.sh CAP_DOLLARS (with SHADOW_IN and SHADOW_OUT set)}"
: "${SHADOW_IN:?SHADOW_IN is not set}"
: "${SHADOW_OUT:?SHADOW_OUT is not set}"
standin="${SHADOW_STANDIN:-0}"
if [ "$standin" != "1" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then echo "ANTHROPIC_API_KEY is not set" >&2; exit 2; fi
here="$(cd "$(dirname "$0")" && pwd)"
if [ -n "${SHADOW_ROSTER:-}" ]; then SHADOW_ROSTER="$(cd "$(dirname "$SHADOW_ROSTER")" && pwd)/$(basename "$SHADOW_ROSTER")"; export SHADOW_ROSTER; fi
repo="$(cd "$here/../.." && pwd)"
case "$(cd "$(dirname "$SHADOW_OUT")" && pwd)/" in "$repo"/*) echo "SHADOW_OUT is inside the repository; keep real data outside it" >&2; exit 2;; esac
records="${SHADOW_OUT%.jsonl}.records"
rm -rf "$records" && mkdir -p "$records"
: > "$SHADOW_OUT"
input="$records/input.jsonl"
grep -v '^\s*$' "$SHADOW_IN" | { if [ -n "${SHADOW_LIMIT:-}" ] && [ "${SHADOW_LIMIT}" != "0" ]; then head -n "$SHADOW_LIMIT"; else cat; fi; } > "$input"
shards="${SHADOW_SHARDS:-3}"
split -n "l/$shards" -d "$input" "$records/in-"
live=()
if [ "$standin" != "1" ]; then live=(AGENT_LOOP_LIVE=1 AGENT_LOOP_LIVE_ALL=1); fi
for part in "$records"/in-*; do
  [ -s "$part" ] || continue
  n="${part##*-}"
  # The "-t (shadow-" filter matches every shadow case, and is what costcap.py's pgrep looks for.
  (cd "$repo" && env "${live[@]}" FLAG_CLASSIFY_ON=AGENT_LOOP_ENABLED SHADOW_IN="$part" SHADOW_OUT="$records/out-$n.jsonl" \
    REPLAY_RECORD="$records/run-$n.jsonl" npx vitest run src/app/api/chat/replay-pack/replay-pack-e2e.test.ts -t "(shadow-)" \
    > "$records/run-$n.log" 2>&1) &
done
python3 "$repo/scripts/agent-loop-live/costcap.py" "$records" "$cap"
wait || true
cat "$records"/out-*.jsonl > "$SHADOW_OUT" 2>/dev/null || true
echo "done: $(wc -l < "$SHADOW_OUT") of $(wc -l < "$input") conversations in $SHADOW_OUT; records in $records"
