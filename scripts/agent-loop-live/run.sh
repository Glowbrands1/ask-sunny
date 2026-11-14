#!/usr/bin/env bash
# AGENT_LOOP live sample (dev only, never CI): the listed replay cases with the loop ON and the REAL model, in three
# parallel shards, stopped when the run's model cost reaches the cap. Each case writes one REPLAY_RECORD line (replies,
# cards, the loop's calls and tokens). Needs ANTHROPIC_API_KEY (pass it on this command line only; never print it).
#
#   ANTHROPIC_API_KEY="$AI_READER_KEY" scripts/agent-loop-live/run.sh OUT_DIR CAP_DOLLARS CASES_FILE [CASES_FILE ...]
#
# Example (QA's one-go re-run, cap $8):
#   ANTHROPIC_API_KEY="$AI_READER_KEY" scripts/agent-loop-live/run.sh /tmp/loop-live 8 \
#     scripts/agent-loop-live/cases-outcome41.txt scripts/agent-loop-live/cases-passed30.txt
# Then: python3 scripts/agent-loop-live/summary.py /tmp/loop-live
set -euo pipefail
out="$1"; cap="$2"; shift 2
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then echo "ANTHROPIC_API_KEY is not set" >&2; exit 2; fi
mkdir -p "$out"
cat "$@" | grep -v '^\s*$' | sort -u > "$out/cases.txt"
split -n l/3 -d "$out/cases.txt" "$out/part"
for part in 00 01 02; do
  [ -s "$out/part$part" ] || continue
  filter="($(paste -sd'|' "$out/part$part")).*production's flags"
  FLAG_CLASSIFY_ON=AGENT_LOOP_ENABLED AGENT_LOOP_LIVE=1 AGENT_LOOP_LIVE_ALL=1 REPLAY_RECORD="$out/run-$part.jsonl" \
    npx vitest run src/app/api/chat/replay-pack/replay-pack-e2e.test.ts -t "$filter" > "$out/run-$part.log" 2>&1 &
done
python3 "$(dirname "$0")/costcap.py" "$out" "$cap"
wait || true
echo "done: $(cat "$out"/run-*.jsonl 2>/dev/null | wc -l) records in $out"
